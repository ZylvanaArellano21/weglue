--
-- 061 -- Day 10B restriction reasons, application-access invalidation, and
--       durable account deletion
--
-- Additive follow-up to 058/060.  Do not renumber or edit either migration.
-- Migration 051 remains intentionally absent.  The unmerged Day 10C migration
-- that currently uses 061 MUST be renumbered before it is ever merged.
--

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- The public category is deliberately a stable database value.  The label is
-- produced only by my_access_state(), which is scoped to auth.uid().
ALTER TABLE public.account_restrictions
  ADD COLUMN IF NOT EXISTS violation_category text,
  ADD COLUMN IF NOT EXISTS public_reason text;

ALTER TABLE public.account_restrictions
  DROP CONSTRAINT IF EXISTS account_restrictions_violation_category_check,
  DROP CONSTRAINT IF EXISTS account_restrictions_public_reason_check,
  ADD CONSTRAINT account_restrictions_violation_category_check CHECK (
    violation_category IS NULL OR violation_category IN (
      'targeted_harassment', 'threats_or_violence', 'hate_speech',
      'sexual_harassment', 'impersonation', 'spam_or_scams',
      'privacy_violation', 'inappropriate_content',
      'repeated_guidelines_violations', 'fraudulent_or_deceptive_behavior',
      'safety_concern', 'other'
    )
  ),
  ADD CONSTRAINT account_restrictions_public_reason_check CHECK (
    public_reason IS NULL OR char_length(public_reason) BETWEEN 10 AND 500
  );

COMMENT ON COLUMN public.account_restrictions.violation_category IS
  'Stable, student-displayable category. NULL only for pre-061 legacy history.';
COMMENT ON COLUMN public.account_restrictions.public_reason IS
  'Specific student-displayable explanation. Never substitute for internal_reason.';

-- No FK to auth.users/profiles: enforcement and deletion history must survive
-- deletion of the affected account just as the existing restriction history
-- does.  This is a case record, not a Day 10D evidence-management system.
CREATE TABLE IF NOT EXISTS public.account_deletion_cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL,
  mode                  text NOT NULL CHECK (mode IN ('scheduled','immediate')),
  state                 text NOT NULL CHECK (state IN (
                          'pending','processing','cancelled','voluntarily_deleted',
                          'finalized','reconciliation_required')),
  scheduled_deletion_at timestamptz NOT NULL,
  appeal_deadline       timestamptz NOT NULL,
  violation_category    text NOT NULL CHECK (violation_category IN (
                          'targeted_harassment', 'threats_or_violence', 'hate_speech',
                          'sexual_harassment', 'impersonation', 'spam_or_scams',
                          'privacy_violation', 'inappropriate_content',
                          'repeated_guidelines_violations', 'fraudulent_or_deceptive_behavior',
                          'safety_concern', 'other')),
  public_reason         text NOT NULL CHECK (char_length(public_reason) BETWEEN 10 AND 500),
  internal_reason       text NOT NULL CHECK (char_length(internal_reason) BETWEEN 3 AND 500),
  basis                 text NOT NULL CHECK (basis IN (
                          'student_reports','multiple_complaints','administrator_observation',
                          'safety_concern','legal_or_institutional_request',
                          'repeated_violations','fraud_or_impersonation_concern','other')),
  evidence_references   text,
  no_evidence_confirmed boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  correlation_id        uuid NOT NULL,
  cancelled_at          timestamptz,
  cancelled_by          uuid,
  cancellation_reason   text CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) BETWEEN 3 AND 500),
  finalized_at          timestamptz,
  finalization_error    text,
  CONSTRAINT adc_evidence_confirmation CHECK (
    NULLIF(btrim(COALESCE(evidence_references, '')), '') IS NOT NULL OR no_evidence_confirmed
  ),
  CONSTRAINT adc_cancellation_consistency CHECK (
    (state = 'cancelled') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_deletion_cases_pending
  ON public.account_deletion_cases (user_id) WHERE state IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_account_deletion_cases_due
  ON public.account_deletion_cases (scheduled_deletion_at) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_account_deletion_cases_correlation
  ON public.account_deletion_cases (correlation_id);

CREATE TABLE IF NOT EXISTS public.account_deletion_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          uuid NOT NULL UNIQUE,
  run_at           timestamptz NOT NULL,
  state            text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','completed','cancelled','retry_pending','reconciliation_required')),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claimed_at       timestamptz,
  claimed_by       text,
  lease_expires_at timestamptz,
  last_error       text,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_deletion_jobs_due
  ON public.account_deletion_jobs (run_at) WHERE state IN ('pending','retry_pending');

-- Recipient is captured before auth.users is deleted.  Payload contains only
-- email-safe public copy; internal notes, evidence and audit data never enter
-- this table.
CREATE TABLE IF NOT EXISTS public.transactional_email_outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN (
                     'admin_deletion_scheduled','admin_deletion_cancelled',
                     'admin_deletion_finalized','voluntary_deletion_completed')),
  recipient_email  text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key  text NOT NULL UNIQUE,
  correlation_id   uuid NOT NULL,
  state            text NOT NULL DEFAULT 'pending' CHECK (state IN (
                     'pending','processing','sent','failed','retry_pending',
                     'permanently_failed','reconciliation_required')),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at       timestamptz,
  claimed_by       text,
  lease_expires_at timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);
CREATE INDEX IF NOT EXISTS idx_transactional_email_outbox_due
  ON public.transactional_email_outbox (next_attempt_at) WHERE state IN ('pending','retry_pending');

ALTER TABLE public.account_deletion_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.transactional_email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactional_email_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_cases FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.account_deletion_jobs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.transactional_email_outbox FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.account_deletion_cases, public.account_deletion_jobs, public.transactional_email_outbox TO service_role;

-- Audit vocabulary is additive.  Historical restriction.revokeSessions events
-- remain immutable; all new work uses accessInvalidation and deletion actions.
INSERT INTO public.admin_audit_actions (action, target_type, sensitivity, requires_reason, description) VALUES
  ('restriction.accessInvalidation', 'user', 'sensitive', TRUE, 'Database-enforced application access invalidation after a restriction.'),
  ('deletion.schedule', 'user', 'destructive', TRUE, 'Schedule permanent account deletion after a seven-day appeal period.'),
  ('deletion.cancel', 'user', 'sensitive', TRUE, 'Cancel a pending administrator account deletion.'),
  ('deletion.immediate', 'user', 'destructive', TRUE, 'Queue an emergency immediate account deletion.'),
  ('deletion.finalize', 'user', 'destructive', TRUE, 'Finalize a due administrator account deletion.'),
  ('deletion.voluntary', 'user', 'destructive', FALSE, 'A student deleted their account while an administrator deletion was pending.')
ON CONFLICT (action) DO NOTHING;

-- Deletion pending is intentionally highest priority.  All 058/060 policies
-- already call current_student_can_access_app(), so this one canonical change
-- extends every guarded direct SQL/RPC path without weakening an existing rule.
CREATE OR REPLACE FUNCTION public.get_account_access_state(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT 'deletion_pending'
       FROM public.account_deletion_cases dc
      WHERE dc.user_id = p_user AND dc.state IN ('pending','processing')
      LIMIT 1),
    (SELECT ar.restriction_type
       FROM public.account_restrictions ar
      WHERE ar.user_id = p_user
        AND ar.status = 'active'
        AND (ar.restriction_type = 'platform_blocked' OR ar.suspended_until IS NULL OR ar.suspended_until > now())
      ORDER BY (ar.restriction_type = 'platform_blocked') DESC, ar.created_at DESC
      LIMIT 1),
    'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_account_restricted(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.get_account_access_state(p_user) <> 'active';
$$;

CREATE OR REPLACE FUNCTION public.can_student_access_app(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_user IS NOT NULL AND public.get_account_access_state(p_user) = 'active';
$$;

CREATE OR REPLACE FUNCTION public.current_student_can_access_app()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM auth.users u
        WHERE u.id = (SELECT auth.uid()) AND public.is_platform_admin_auth(u.raw_app_meta_data)
     )
     AND public.get_account_access_state((SELECT auth.uid())) = 'active';
$$;

CREATE OR REPLACE FUNCTION private.violation_category_label(p_category text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_category
    WHEN 'targeted_harassment' THEN 'Targeted harassment'
    WHEN 'threats_or_violence' THEN 'Threats or violence'
    WHEN 'hate_speech' THEN 'Hate speech'
    WHEN 'sexual_harassment' THEN 'Sexual harassment'
    WHEN 'impersonation' THEN 'Impersonation'
    WHEN 'spam_or_scams' THEN 'Spam or scams'
    WHEN 'privacy_violation' THEN 'Privacy violation'
    WHEN 'inappropriate_content' THEN 'Inappropriate content'
    WHEN 'repeated_guidelines_violations' THEN 'Repeated Community Guidelines violations'
    WHEN 'fraudulent_or_deceptive_behavior' THEN 'Fraudulent or deceptive behavior'
    WHEN 'safety_concern' THEN 'Safety concern'
    WHEN 'other' THEN 'Other'
    ELSE 'Community Guidelines violation'
  END;
$$;

-- The only student-readable access payload.  It has no parameter and contains
-- no internal note, actor, evidence, delivery status, correlation id or raw
-- platform_blocked value.  The legacy fallback avoids rewriting old history.
CREATE OR REPLACE FUNCTION public.my_access_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS (SELECT auth.uid() AS user_id), pending AS (
    SELECT dc.* FROM public.account_deletion_cases dc, me
     WHERE dc.user_id = me.user_id AND dc.state IN ('pending','processing')
     ORDER BY dc.created_at DESC LIMIT 1
  ), restriction AS (
    SELECT ar.* FROM public.account_restrictions ar, me
     WHERE ar.user_id = me.user_id AND ar.status = 'active'
       AND (ar.restriction_type = 'platform_blocked' OR ar.suspended_until IS NULL OR ar.suspended_until > now())
     ORDER BY (ar.restriction_type = 'platform_blocked') DESC, ar.created_at DESC LIMIT 1
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM pending) THEN jsonb_build_object(
      'state','deletion_pending',
      'violation_category', private.violation_category_label((SELECT violation_category FROM pending)),
      'public_reason', (SELECT public_reason FROM pending),
      'suspended_until', NULL,
      'scheduled_deletion_at', (SELECT scheduled_deletion_at FROM pending),
      'appeal_deadline', (SELECT appeal_deadline FROM pending),
      'support_email', 'zylvana.arellano.campos@gmail.com'
    )
    WHEN EXISTS (SELECT 1 FROM restriction) THEN jsonb_build_object(
      'state', CASE WHEN (SELECT restriction_type FROM restriction) = 'suspended' THEN 'suspended' ELSE 'restricted' END,
      'violation_category', private.violation_category_label((SELECT violation_category FROM restriction)),
      'public_reason', COALESCE(
         (SELECT public_reason FROM restriction),
         'Your account was suspended because activity associated with it violated the We Glue Community Guidelines. Contact support for more information.'
      ),
      'suspended_until', (SELECT suspended_until FROM restriction),
      'scheduled_deletion_at', NULL,
      'appeal_deadline', NULL,
      'support_email', 'zylvana.arellano.campos@gmail.com'
    )
    ELSE jsonb_build_object(
      'state','active','violation_category',NULL,'public_reason',NULL,
      'suspended_until',NULL,'scheduled_deletion_at',NULL,'appeal_deadline',NULL,
      'support_email','zylvana.arellano.campos@gmail.com'
    ) END;
$$;

-- New restriction RPCs preserve 058's atomic mutation + audit implementation,
-- then add the separate public fields in the same transaction.  Old clients
-- continue to resolve the old signatures; the new dashboard exclusively uses
-- these v2 signatures and therefore cannot create another legacy row.
CREATE OR REPLACE FUNCTION private.assert_public_restriction_input(p_category text, p_public_reason text, p_internal_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_category NOT IN ('targeted_harassment','threats_or_violence','hate_speech','sexual_harassment','impersonation','spam_or_scams','privacy_violation','inappropriate_content','repeated_guidelines_violations','fraudulent_or_deceptive_behavior','safety_concern','other')
     OR char_length(btrim(COALESCE(p_public_reason,''))) NOT BETWEEN 10 AND 500
     OR char_length(btrim(COALESCE(p_internal_reason,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid restriction reason input' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_restriction_suspend_v2(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_user_id uuid, p_suspended_until timestamptz, p_violation_category text, p_public_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.assert_public_restriction_input(p_violation_category,p_public_reason,p_reason);
  v_result := public.admin_tx_restriction_suspend(p_actor_id,p_actor_email,p_reason,p_correlation_id,p_user_id,p_suspended_until);
  IF v_result->>'status' = 'ok' THEN
    UPDATE public.account_restrictions SET violation_category=p_violation_category, public_reason=btrim(p_public_reason)
     WHERE user_id=p_user_id AND status='active' AND correlation_id=p_correlation_id;
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_restriction_block_v2(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_user_id uuid, p_violation_category text, p_public_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM private.assert_public_restriction_input(p_violation_category,p_public_reason,p_reason);
  v_result := public.admin_tx_restriction_block(p_actor_id,p_actor_email,p_reason,p_correlation_id,p_user_id);
  IF v_result->>'status' = 'ok' THEN
    UPDATE public.account_restrictions SET violation_category=p_violation_category, public_reason=btrim(p_public_reason)
     WHERE user_id=p_user_id AND status='active' AND correlation_id=p_correlation_id;
  END IF;
  RETURN v_result;
END;
$$;

-- Administrator deletion cases and jobs.  This intentionally has no automatic
-- evidence requirement: a written basis is mandatory, evidence is optional.
CREATE OR REPLACE FUNCTION public.admin_tx_schedule_account_deletion(
  p_actor_id uuid, p_actor_email text, p_internal_reason text, p_correlation_id uuid,
  p_user_id uuid, p_violation_category text, p_public_reason text, p_basis text,
  p_evidence_references text, p_no_evidence_confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_case public.account_deletion_cases%ROWTYPE; v_email text; v_code text; v_after jsonb;
BEGIN
  PERFORM private.assert_public_restriction_input(p_violation_category,p_public_reason,p_internal_reason);
  IF p_basis NOT IN ('student_reports','multiple_complaints','administrator_observation','safety_concern','legal_or_institutional_request','repeated_violations','fraud_or_impersonation_concern','other') THEN
    RAISE EXCEPTION 'invalid deletion basis' USING ERRCODE='22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_evidence_references,'')), '') IS NULL AND NOT p_no_evidence_confirmed THEN
    RAISE EXCEPTION 'no-evidence acknowledgement is required' USING ERRCODE='22023';
  END IF;
  v_code := private.admin_restriction_reject_target(p_actor_id,p_user_id);
  IF v_code IS NOT NULL THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'deletion.schedule','user',p_user_id,jsonb_build_object('userId',p_user_id),p_correlation_id,v_code);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account_deletion:'||p_user_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.account_deletion_cases WHERE user_id=p_user_id AND state IN ('pending','processing')) THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'deletion.schedule','user',p_user_id,jsonb_build_object('userId',p_user_id),p_correlation_id,'already_deletion_pending');
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id=p_user_id;
  IF v_email IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'deletion.schedule','user',p_user_id,jsonb_build_object('userId',p_user_id),p_correlation_id,'user_not_found');
  END IF;
  INSERT INTO public.account_deletion_cases (user_id,mode,state,scheduled_deletion_at,appeal_deadline,violation_category,public_reason,internal_reason,basis,evidence_references,no_evidence_confirmed,created_by,correlation_id)
  VALUES (p_user_id,'scheduled','pending',now()+interval '7 days',now()+interval '7 days',p_violation_category,btrim(p_public_reason),btrim(p_internal_reason),p_basis,NULLIF(btrim(p_evidence_references),''),p_no_evidence_confirmed,p_actor_id,p_correlation_id)
  RETURNING * INTO v_case;
  INSERT INTO public.account_deletion_jobs (case_id,run_at) VALUES (v_case.id,v_case.scheduled_deletion_at);
  INSERT INTO public.transactional_email_outbox (kind,recipient_email,payload,idempotency_key,correlation_id)
  VALUES ('admin_deletion_scheduled',v_email,jsonb_build_object('violation_category',private.violation_category_label(v_case.violation_category),'public_reason',v_case.public_reason,'scheduled_deletion_at',v_case.scheduled_deletion_at,'appeal_deadline',v_case.appeal_deadline,'support_email','zylvana.arellano.campos@gmail.com'),'deletion-scheduled:'||v_case.id::text,p_correlation_id);
  v_after := jsonb_build_object('id',v_case.id,'state',v_case.state,'scheduled_deletion_at',v_case.scheduled_deletion_at);
  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,'deletion.schedule','user',p_user_id,p_internal_reason,NULL,v_after,jsonb_build_object('userId',p_user_id,'scheduledDeletionAt',v_case.scheduled_deletion_at),p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_cancel_account_deletion(
  p_actor_id uuid, p_actor_email text, p_internal_reason text, p_correlation_id uuid, p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_case public.account_deletion_cases%ROWTYPE; v_email text;
BEGIN
  IF char_length(btrim(COALESCE(p_internal_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'invalid cancellation reason' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account_deletion:'||p_user_id::text, 0));
  SELECT * INTO v_case FROM public.account_deletion_cases WHERE user_id=p_user_id AND state='pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_case.id IS NULL THEN RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'deletion.cancel','user',p_user_id,jsonb_build_object('userId',p_user_id),p_correlation_id,'not_deletion_pending'); END IF;
  UPDATE public.account_deletion_cases SET state='cancelled',cancelled_at=now(),cancelled_by=p_actor_id,cancellation_reason=btrim(p_internal_reason) WHERE id=v_case.id;
  UPDATE public.account_deletion_jobs SET state='cancelled' WHERE case_id=v_case.id AND state IN ('pending','retry_pending');
  SELECT email INTO v_email FROM auth.users WHERE id=p_user_id;
  IF v_email IS NOT NULL THEN
    INSERT INTO public.transactional_email_outbox (kind,recipient_email,payload,idempotency_key,correlation_id)
    VALUES ('admin_deletion_cancelled',v_email,jsonb_build_object('support_email','zylvana.arellano.campos@gmail.com'),'deletion-cancelled:'||v_case.id::text,p_correlation_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,'deletion.cancel','user',p_user_id,p_internal_reason,NULL,jsonb_build_object('id',v_case.id,'state','cancelled'),jsonb_build_object('userId',p_user_id),p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_delete_account_immediately(
  p_actor_id uuid, p_actor_email text, p_internal_reason text, p_correlation_id uuid,
  p_user_id uuid, p_violation_category text, p_public_reason text, p_basis text,
  p_evidence_references text, p_no_evidence_confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_case public.account_deletion_cases%ROWTYPE; v_code text;
BEGIN
  PERFORM private.assert_public_restriction_input(p_violation_category,p_public_reason,p_internal_reason);
  IF p_basis NOT IN ('student_reports','multiple_complaints','administrator_observation','safety_concern','legal_or_institutional_request','repeated_violations','fraud_or_impersonation_concern','other') THEN RAISE EXCEPTION 'invalid deletion basis' USING ERRCODE='22023'; END IF;
  IF NULLIF(btrim(COALESCE(p_evidence_references,'')), '') IS NULL AND NOT p_no_evidence_confirmed THEN RAISE EXCEPTION 'no-evidence acknowledgement is required' USING ERRCODE='22023'; END IF;
  v_code := private.admin_restriction_reject_target(p_actor_id,p_user_id);
  IF v_code IS NOT NULL THEN RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'deletion.immediate','user',p_user_id,jsonb_build_object('userId',p_user_id),p_correlation_id,v_code); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account_deletion:'||p_user_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.account_deletion_cases WHERE user_id=p_user_id AND state IN ('pending','processing')) THEN RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'deletion.immediate','user',p_user_id,jsonb_build_object('userId',p_user_id),p_correlation_id,'already_deletion_pending'); END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'deletion.immediate','user',p_user_id,jsonb_build_object('userId',p_user_id),p_correlation_id,'user_not_found'); END IF;
  INSERT INTO public.account_deletion_cases (user_id,mode,state,scheduled_deletion_at,appeal_deadline,violation_category,public_reason,internal_reason,basis,evidence_references,no_evidence_confirmed,created_by,correlation_id)
  VALUES (p_user_id,'immediate','pending',now(),now(),p_violation_category,btrim(p_public_reason),btrim(p_internal_reason),p_basis,NULLIF(btrim(p_evidence_references),''),p_no_evidence_confirmed,p_actor_id,p_correlation_id) RETURNING * INTO v_case;
  INSERT INTO public.account_deletion_jobs (case_id,run_at) VALUES (v_case.id,now());
  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,'deletion.immediate','user',p_user_id,p_internal_reason,NULL,jsonb_build_object('id',v_case.id,'state','pending'),jsonb_build_object('userId',p_user_id),p_correlation_id);
END;
$$;

-- The reviewed 052 deletion sequence is reused, not replaced.  The helper is
-- deliberately private and accepts a target only after a server-only caller
-- has claimed a durable job; public delete_own_account_atomic() still uses
-- auth.uid() and exposes no target parameter to a student.
CREATE OR REPLACE FUNCTION private.delete_account_atomic_for(
  p_user_id uuid, p_email_kind text, p_case_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE
  v_email text; v_avatars text[] := ARRAY[]::text[]; v_posts text[] := ARRAY[]::text[];
  v_club_photos text[] := ARRAY[]::text[]; v_attachments text[] := ARRAY[]::text[];
  v_case public.account_deletion_cases%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id=p_user_id FOR UPDATE;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Account not found' USING ERRCODE='P0002'; END IF;
  IF p_case_id IS NOT NULL THEN SELECT * INTO v_case FROM public.account_deletion_cases WHERE id=p_case_id FOR UPDATE; END IF;

  SELECT COALESCE(array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL),ARRAY[]::text[]) INTO v_avatars FROM (SELECT public.storage_path_from_public_url(pr.avatar_url,'avatars') p FROM public.profiles pr WHERE pr.id=p_user_id AND pr.avatar_url IS NOT NULL AND COALESCE(pr.avatar_type,'') <> 'text') s;
  SELECT COALESCE(array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL),ARRAY[]::text[]) INTO v_posts FROM (SELECT public.storage_path_from_public_url(po.image_url,'posts') p FROM public.posts po WHERE po.author_id=p_user_id AND po.image_url IS NOT NULL) s;
  SELECT COALESCE(array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL),ARRAY[]::text[]) INTO v_club_photos FROM (SELECT public.storage_path_from_public_url(cp.url,'club-photos') p FROM public.club_photos cp WHERE cp.uploaded_by=p_user_id AND cp.url IS NOT NULL) s;
  SELECT COALESCE(array_agg(DISTINCT m.attachment_url),ARRAY[]::text[]) INTO v_attachments FROM public.messages m WHERE m.sender_id=p_user_id AND m.attachment_url IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.conversation_participants cp WHERE cp.conversation_id=m.conversation_id AND cp.user_id <> p_user_id);

  UPDATE public.events SET specific_user_ids=array_remove(specific_user_ids,p_user_id) WHERE specific_user_ids IS NOT NULL AND p_user_id=ANY(specific_user_ids);
  UPDATE public.notifications SET group_actors=array_remove(group_actors,p_user_id),group_count=GREATEST(COALESCE(array_length(array_remove(group_actors,p_user_id),1),0),0) WHERE group_actors IS NOT NULL AND p_user_id=ANY(group_actors);
  DELETE FROM public.deletion_requests WHERE lower(email)=lower(v_email);
  UPDATE public.reports SET reporter_id=NULL,reporter_email=NULL,reporter_username=NULL WHERE reporter_id=p_user_id;
  DELETE FROM public.club_officers WHERE user_id=p_user_id;
  DELETE FROM public.chat_invitations WHERE created_by=p_user_id;
  DELETE FROM public.channel_posters WHERE user_id=p_user_id;
  DELETE FROM public.club_photos cp WHERE cp.uploaded_by=p_user_id OR cp.post_id IN (SELECT id FROM public.posts WHERE author_id=p_user_id);
  DELETE FROM public.messages m WHERE m.sender_id=p_user_id AND NOT EXISTS (SELECT 1 FROM public.conversation_participants cp WHERE cp.conversation_id=m.conversation_id AND cp.user_id <> p_user_id);
  UPDATE public.messages SET sender_id=NULL WHERE sender_id=p_user_id;
  UPDATE public.messages SET deleted_by=NULL WHERE deleted_by=p_user_id;
  UPDATE public.messages m SET shared_post_id=NULL WHERE m.shared_post_id IN (SELECT id FROM public.posts WHERE author_id=p_user_id);
  UPDATE public.messages m SET shared_event_id=NULL WHERE m.shared_event_id IN (SELECT id FROM public.events WHERE created_by=p_user_id);
  UPDATE public.conversations SET created_by=NULL WHERE created_by=p_user_id;
  UPDATE public.conversation_channels SET created_by=NULL WHERE created_by=p_user_id;
  UPDATE public.channel_posters SET added_by=NULL WHERE added_by=p_user_id;

  IF p_email_kind = 'voluntary_deletion_completed' THEN
    SELECT * INTO v_case FROM public.account_deletion_cases WHERE user_id=p_user_id AND state IN ('pending','processing') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    UPDATE public.account_deletion_cases SET state='voluntarily_deleted',finalized_at=now() WHERE id=v_case.id;
    UPDATE public.account_deletion_jobs SET state='cancelled' WHERE case_id=v_case.id AND state IN ('pending','processing','retry_pending');
    INSERT INTO public.transactional_email_outbox(kind,recipient_email,payload,idempotency_key,correlation_id)
    VALUES ('voluntary_deletion_completed',v_email,jsonb_build_object('support_email','zylvana.arellano.campos@gmail.com'),'voluntary-deletion:'||p_user_id::text,COALESCE(v_case.correlation_id,gen_random_uuid())) ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF p_email_kind = 'admin_deletion_finalized' THEN
    UPDATE public.account_deletion_cases SET state='finalized',finalized_at=now() WHERE id=p_case_id;
    INSERT INTO public.transactional_email_outbox(kind,recipient_email,payload,idempotency_key,correlation_id)
    VALUES ('admin_deletion_finalized',v_email,jsonb_build_object('violation_category',private.violation_category_label(v_case.violation_category),'public_reason',v_case.public_reason,'support_email','zylvana.arellano.campos@gmail.com'),'deletion-finalized:'||p_case_id::text,v_case.correlation_id) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  DELETE FROM auth.users WHERE id=p_user_id;
  RETURN jsonb_build_object('avatars',to_jsonb(v_avatars),'posts',to_jsonb(v_posts),'club-photos',to_jsonb(v_club_photos),'chat-attachments',to_jsonb(v_attachments));
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_own_account_atomic()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  RETURN private.delete_account_atomic_for(v_uid,'voluntary_deletion_completed',NULL);
END;
$$;

-- A worker receives short leases.  SKIP LOCKED makes concurrent ticks safe;
-- expired leases are retryable rather than silently forgotten.
CREATE OR REPLACE FUNCTION public.claim_account_deletion_jobs(p_worker_id text, p_limit integer DEFAULT 10)
RETURNS TABLE(job_id uuid, case_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF char_length(COALESCE(p_worker_id,'')) < 8 OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'invalid worker claim' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  WITH due AS (
    SELECT j.id FROM public.account_deletion_jobs j
     JOIN public.account_deletion_cases c ON c.id=j.case_id
    WHERE ((j.state IN ('pending','retry_pending') AND j.run_at <= now()) OR (j.state='processing' AND j.lease_expires_at < now()))
      AND c.state='pending'
    ORDER BY j.run_at FOR UPDATE OF j SKIP LOCKED LIMIT p_limit
  )
  UPDATE public.account_deletion_jobs j SET state='processing',attempts=j.attempts+1,claimed_at=now(),claimed_by=p_worker_id,lease_expires_at=now()+interval '10 minutes'
   FROM due WHERE j.id=due.id RETURNING j.id,j.case_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_claimed_account_deletion(p_worker_id text, p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $$
DECLARE v_job public.account_deletion_jobs%ROWTYPE; v_case public.account_deletion_cases%ROWTYPE; v_paths jsonb;
BEGIN
  SELECT * INTO v_job FROM public.account_deletion_jobs WHERE id=p_job_id FOR UPDATE;
  IF v_job.id IS NULL OR v_job.state <> 'processing' OR v_job.claimed_by <> p_worker_id OR v_job.lease_expires_at < now() THEN RAISE EXCEPTION 'job is not held by this worker' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_case FROM public.account_deletion_cases WHERE id=v_job.case_id FOR UPDATE;
  IF v_case.state <> 'pending' THEN UPDATE public.account_deletion_jobs SET state='cancelled' WHERE id=v_job.id; RETURN jsonb_build_object('status','cancelled'); END IF;
  UPDATE public.account_deletion_cases SET state='processing' WHERE id=v_case.id;
  PERFORM private.admin_tx_ok(v_case.created_by,NULL,'deletion.finalize','user',v_case.user_id,v_case.internal_reason,NULL,jsonb_build_object('id',v_case.id,'state','finalizing'),jsonb_build_object('userId',v_case.user_id),v_case.correlation_id);
  v_paths := private.delete_account_atomic_for(v_case.user_id,'admin_deletion_finalized',v_case.id);
  UPDATE public.account_deletion_jobs SET state='completed',completed_at=now(),lease_expires_at=NULL WHERE id=v_job.id;
  RETURN jsonb_build_object('status','finalized','paths',v_paths);
EXCEPTION WHEN OTHERS THEN
  -- Do not swallow a worker failure.  Persist an explicit retry/reconciliation
  -- state, then re-raise so the caller records the failed tick.
  UPDATE public.account_deletion_jobs SET state=CASE WHEN attempts >= 5 THEN 'reconciliation_required' ELSE 'retry_pending' END,last_error=left(SQLERRM,240),lease_expires_at=NULL,run_at=now()+interval '5 minutes' WHERE id=p_job_id;
  UPDATE public.account_deletion_cases SET state=CASE WHEN (SELECT attempts FROM public.account_deletion_jobs WHERE id=p_job_id) >= 5 THEN 'reconciliation_required' ELSE 'pending' END,finalization_error=left(SQLERRM,240) WHERE id=(SELECT case_id FROM public.account_deletion_jobs WHERE id=p_job_id);
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_transactional_email_outbox(p_worker_id text, p_limit integer DEFAULT 25)
RETURNS TABLE(outbox_id uuid, kind text, recipient_email text, payload jsonb, idempotency_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF char_length(COALESCE(p_worker_id,'')) < 8 OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid worker claim' USING ERRCODE='22023'; END IF;
  RETURN QUERY WITH due AS (
    SELECT id FROM public.transactional_email_outbox
     WHERE (state IN ('pending','retry_pending') AND next_attempt_at <= now()) OR (state='processing' AND lease_expires_at < now())
     ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT p_limit
  ) UPDATE public.transactional_email_outbox o SET state='processing',attempts=o.attempts+1,claimed_at=now(),claimed_by=p_worker_id,lease_expires_at=now()+interval '10 minutes'
      FROM due WHERE o.id=due.id RETURNING o.id,o.kind,o.recipient_email,o.payload,o.idempotency_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_transactional_email_outbox(p_worker_id text, p_outbox_id uuid, p_sent boolean, p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_attempts integer;
BEGIN
  SELECT attempts INTO v_attempts FROM public.transactional_email_outbox WHERE id=p_outbox_id AND state='processing' AND claimed_by=p_worker_id AND lease_expires_at >= now() FOR UPDATE;
  IF v_attempts IS NULL THEN RAISE EXCEPTION 'outbox row is not held by this worker' USING ERRCODE='42501'; END IF;
  UPDATE public.transactional_email_outbox SET
    state=CASE WHEN p_sent THEN 'sent' WHEN v_attempts >= 5 THEN 'permanently_failed' ELSE 'retry_pending' END,
    sent_at=CASE WHEN p_sent THEN now() ELSE NULL END,
    next_attempt_at=CASE WHEN p_sent THEN next_attempt_at ELSE now()+make_interval(mins => LEAST(60, 2 ^ LEAST(v_attempts,5))) END,
    last_error=CASE WHEN p_sent THEN NULL ELSE left(COALESCE(p_error,'delivery_failed'),240) END,
    lease_expires_at=NULL
  WHERE id=p_outbox_id;
END;
$$;

-- A strict installer, intentionally not invoked by the migration: Production
-- must first provide an authenticated worker URL + secret in Vault.  It raises
-- if either dependency is missing and therefore can never claim a silent cron.
CREATE OR REPLACE FUNCTION public.install_account_deletion_worker_schedule(p_worker_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='account_deletion_worker_secret';
  IF v_secret IS NULL OR char_length(btrim(COALESCE(p_worker_url,''))) < 16 THEN RAISE EXCEPTION 'account deletion worker URL or Vault secret is not configured' USING ERRCODE='P0001'; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='weglue-account-deletion-worker';
  -- Run every minute: scheduled/cancelled notices are durable outbox work and
  -- should be dispatched promptly, while finalization remains due-date gated.
  PERFORM cron.schedule('weglue-account-deletion-worker','* * * * *',format($job$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-weglue-worker-secret',%L), body := '{}'::jsonb);$job$,p_worker_url,v_secret));
END;
$$;

DO $grants$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'admin_tx_restriction_suspend_v2(uuid,text,text,uuid,uuid,timestamptz,text,text)',
    'admin_tx_restriction_block_v2(uuid,text,text,uuid,uuid,text,text)',
    'admin_tx_schedule_account_deletion(uuid,text,text,uuid,uuid,text,text,text,text,boolean)',
    'admin_tx_cancel_account_deletion(uuid,text,text,uuid,uuid)',
    'admin_tx_delete_account_immediately(uuid,text,text,uuid,uuid,text,text,text,text,boolean)',
    'claim_account_deletion_jobs(text,integer)',
    'finalize_claimed_account_deletion(text,uuid)',
    'claim_transactional_email_outbox(text,integer)',
    'complete_transactional_email_outbox(text,uuid,boolean,text)',
    'install_account_deletion_worker_schedule(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated;',fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role;',fn);
  END LOOP;
END
$grants$;

REVOKE ALL ON FUNCTION private.delete_account_atomic_for(uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_public_restriction_input(text,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.violation_category_label(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.my_access_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_access_state() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_own_account_atomic() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_own_account_atomic() TO authenticated;

COMMENT ON TABLE public.account_deletion_cases IS 'Day 10B administrator deletion cases. Evidence references are optional; internal fields are server-only.';
COMMENT ON TABLE public.transactional_email_outbox IS 'Day 10B durable transactional email outbox. Payload is public-safe email data only.';
COMMENT ON FUNCTION public.my_access_state() IS 'Self-only sanitized restriction/deletion state. No parameter; safe for restricted shells.';
COMMENT ON FUNCTION public.install_account_deletion_worker_schedule(text) IS 'Production installer. Requires Vault account_deletion_worker_secret and fails loudly when absent.';

COMMIT;
