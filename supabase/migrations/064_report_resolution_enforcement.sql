-- =============================================================================
-- 064 — Founder-only report resolution and enforcement
--
-- This migration is additive. Report decisions are append-only and terminal;
-- an administrator cannot edit or silently reopen a completed decision. The
-- decision RPC composes the existing Day 10B/10C secured RPCs in the same
-- transaction, so a failed enforcement or audit rolls the complete decision
-- back.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.report_decision_history (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id                  uuid NOT NULL,
  sequence_no                integer NOT NULL CHECK (sequence_no > 0),
  previous_status            text NOT NULL CHECK (previous_status IN ('pending', 'reviewing')),
  new_status                 text NOT NULL CHECK (new_status IN ('resolved', 'dismissed')),
  resolution_outcome         text NOT NULL CHECK (resolution_outcome IN (
    'no_violation', 'duplicate_or_invalid', 'content_violation',
    'account_violation', 'other'
  )),
  internal_decision_note     text NOT NULL CHECK (char_length(btrim(internal_decision_note)) BETWEEN 3 AND 2000),
  public_category            text,
  public_explanation         text,
  enforcement_action         text NOT NULL CHECK (enforcement_action IN (
    'none', 'post_remove', 'event_remove', 'suspend', 'block', 'schedule_deletion'
  )),
  enforcement_target_type    text CHECK (enforcement_target_type IS NULL OR enforcement_target_type IN ('post', 'event', 'user')),
  enforcement_target_id      uuid,
  enforcement_status          text NOT NULL CHECK (enforcement_status IN ('not_requested', 'applied', 'unavailable')),
  enforcement_correlation_id uuid,
  notification_status        text NOT NULL CHECK (notification_status IN ('not_required', 'pending')),
  actor_user_id              uuid NOT NULL,
  actor_email                text,
  correlation_id              uuid NOT NULL,
  supersedes_decision_id     uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_decision_public_copy_chk CHECK (
    (enforcement_action = 'none' AND public_category IS NULL AND public_explanation IS NULL)
    OR (enforcement_action <> 'none' AND public_category IS NOT NULL
        AND char_length(btrim(public_explanation)) BETWEEN 10 AND 500)
  ),
  CONSTRAINT report_decision_target_chk CHECK (
    (enforcement_action = 'none' AND enforcement_target_type IS NULL AND enforcement_target_id IS NULL)
    OR (enforcement_action <> 'none' AND enforcement_target_type IS NOT NULL AND enforcement_target_id IS NOT NULL)
  ),
  CONSTRAINT report_decision_sequence_unique UNIQUE (report_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS report_decision_history_report_idx
  ON public.report_decision_history (report_id, sequence_no DESC);
CREATE INDEX IF NOT EXISTS report_decision_history_correlation_idx
  ON public.report_decision_history (correlation_id);
CREATE INDEX IF NOT EXISTS report_decision_history_created_idx
  ON public.report_decision_history (created_at DESC);

ALTER TABLE public.report_decision_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_decision_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_decision_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.report_decision_history TO service_role;

CREATE TABLE IF NOT EXISTS public.report_notification_deliveries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id        uuid NOT NULL,
  outbox_id          uuid,
  state              text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'sent', 'failed', 'retry_pending', 'permanently_failed', 'reconciliation_required')),
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error         text,
  sent_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_notification_delivery_unique UNIQUE (decision_id)
);

CREATE INDEX IF NOT EXISTS report_notification_delivery_state_idx
  ON public.report_notification_deliveries (state, created_at DESC);
ALTER TABLE public.report_notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_notification_deliveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_notification_deliveries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.report_notification_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.complete_report_notification_delivery(
  p_decision_id uuid, p_outbox_id uuid, p_sent boolean, p_error text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.report_notification_deliveries
     SET state = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
         outbox_id = coalesce(outbox_id, p_outbox_id),
         sent_at = CASE WHEN p_sent THEN now() ELSE NULL END,
         last_error = CASE WHEN p_sent THEN NULL ELSE left(coalesce(p_error, 'delivery_failed'), 240) END
   WHERE decision_id = p_decision_id AND (outbox_id IS NULL OR outbox_id = p_outbox_id);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_report_notification_delivery(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_report_notification_delivery(uuid, uuid, boolean, text) TO service_role;

-- Existing outbox workers remain the delivery mechanism. Day 10D adds one
-- public-safe kind; no evidence, reporter identity, or internal notes enter it.
ALTER TABLE public.transactional_email_outbox
  DROP CONSTRAINT IF EXISTS transactional_email_outbox_kind_check;
ALTER TABLE public.transactional_email_outbox
  ADD CONSTRAINT transactional_email_outbox_kind_check CHECK (kind IN (
    'admin_deletion_scheduled', 'admin_deletion_cancelled',
    'admin_deletion_finalized', 'voluntary_deletion_completed',
    'admin_report_resolution'
  ));

INSERT INTO public.admin_audit_actions (action, target_type, sensitivity, requires_reason, description) VALUES
  ('report.review', 'report', 'sensitive', true, 'Move a report into the founder review queue.'),
  ('report.resolve', 'report', 'sensitive', true, 'Record a terminal report resolution and any enforcement.'),
  ('report.dismiss', 'report', 'sensitive', true, 'Record a terminal dismissal for a report.'),
  ('report.supersede', 'report', 'sensitive', true, 'Create an explicit superseding correction without editing report history.'),
  ('report.viewEvidence', 'report', 'sensitive', true, 'View retained report evidence in the private Dashboard.')
ON CONFLICT (action) DO NOTHING;

CREATE OR REPLACE FUNCTION private.report_decision_history_block_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'report decision history is append-only' USING ERRCODE = '55006';
END;
$$;

DROP TRIGGER IF EXISTS report_decision_history_immutable ON public.report_decision_history;
CREATE TRIGGER report_decision_history_immutable
  BEFORE UPDATE OR DELETE ON public.report_decision_history
  FOR EACH ROW EXECUTE FUNCTION private.report_decision_history_block_mutation();

CREATE OR REPLACE FUNCTION private.report_decision_lock(p_report_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('we_glue_report_decision:' || p_report_id::text, 0));
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_report_set_status(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_report_id uuid, p_next_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_status text;
BEGIN
  IF p_next_status <> 'reviewing' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.review', 'report', p_report_id,
      jsonb_build_object('reportId', p_report_id, 'nextStatus', p_next_status), p_correlation_id, 'terminal_decision_required');
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.review', 'report', p_report_id,
      jsonb_build_object('reportId', p_report_id), p_correlation_id, 'invalid_reason');
  END IF;
  PERFORM private.report_decision_lock(p_report_id);
  SELECT jsonb_build_object('id', r.id, 'status', r.status, 'entity_type', r.entity_type, 'entity_id', r.entity_id), r.status
    INTO v_before, v_status FROM public.reports r WHERE r.id = p_report_id;
  IF v_before IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.review', 'report', p_report_id,
      jsonb_build_object('reportId', p_report_id), p_correlation_id, 'not_found');
  END IF;
  IF v_status <> 'pending' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.review', 'report', p_report_id,
      jsonb_build_object('reportId', p_report_id), p_correlation_id, 'invalid_transition');
  END IF;
  UPDATE public.reports SET status = 'reviewing' WHERE id = p_report_id;
  SELECT jsonb_build_object('id', r.id, 'status', r.status, 'entity_type', r.entity_type, 'entity_id', r.entity_id)
    INTO v_after FROM public.reports r WHERE r.id = p_report_id;
  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'report.review', 'report', p_report_id,
    btrim(p_reason), v_before, v_after, jsonb_build_object('reportId', p_report_id, 'newStatus', 'reviewing'), p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_report_decide(
  p_actor_id uuid,
  p_actor_email text,
  p_internal_reason text,
  p_correlation_id uuid,
  p_report_id uuid,
  p_new_status text,
  p_resolution_outcome text,
  p_internal_decision_note text,
  p_public_category text,
  p_public_explanation text,
  p_enforcement_action text,
  p_suspended_until timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_report public.reports%ROWTYPE;
  v_decision_id uuid;
  v_sequence integer;
  v_target_user uuid;
  v_target_type text;
  v_enforcement jsonb;
  v_enforcement_status text := 'not_requested';
  v_notification_status text := 'not_required';
  v_before jsonb;
  v_after jsonb;
  v_outbox_id uuid;
  v_email text;
  v_action text;
BEGIN
  IF p_new_status NOT IN ('resolved', 'dismissed') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.resolve', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'invalid_status');
  END IF;
  IF p_resolution_outcome NOT IN ('no_violation', 'duplicate_or_invalid', 'content_violation', 'account_violation', 'other') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.resolve', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'invalid_outcome');
  END IF;
  IF char_length(btrim(coalesce(p_internal_reason, ''))) NOT BETWEEN 3 AND 500
     OR char_length(btrim(coalesce(p_internal_decision_note, ''))) NOT BETWEEN 3 AND 2000 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.resolve', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'invalid_reason');
  END IF;
  IF p_new_status = 'dismissed' AND p_resolution_outcome NOT IN ('duplicate_or_invalid', 'other') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.dismiss', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'invalid_outcome');
  END IF;
  IF p_new_status = 'resolved' AND p_resolution_outcome = 'duplicate_or_invalid' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.resolve', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'invalid_outcome');
  END IF;
  IF p_enforcement_action NOT IN ('none', 'post_remove', 'event_remove', 'suspend', 'block', 'schedule_deletion') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.resolve', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'invalid_enforcement');
  END IF;
  IF p_new_status = 'dismissed' AND p_enforcement_action <> 'none' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.dismiss', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'invalid_enforcement');
  END IF;
  IF p_enforcement_action <> 'none' AND (char_length(btrim(coalesce(p_public_category, ''))) < 2 OR char_length(btrim(coalesce(p_public_explanation, ''))) NOT BETWEEN 10 AND 500) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.resolve', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'public_explanation_required');
  END IF;

  PERFORM private.report_decision_lock(p_report_id);
  SELECT * INTO v_report FROM public.reports WHERE id = p_report_id FOR UPDATE;
  IF v_report.id IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.resolve', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'not_found');
  END IF;
  IF v_report.status NOT IN ('pending', 'reviewing') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.resolve', 'report', p_report_id, jsonb_build_object('status', v_report.status), p_correlation_id, 'terminal_decision');
  END IF;
  IF p_enforcement_action <> 'none' THEN
    IF p_enforcement_action IN ('post_remove', 'event_remove') AND v_report.entity_type <> replace(p_enforcement_action, '_remove', '') THEN
      RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.resolve', 'report', p_report_id, jsonb_build_object('entityType', v_report.entity_type), p_correlation_id, 'enforcement_unavailable');
    END IF;
    IF p_enforcement_action IN ('suspend', 'block', 'schedule_deletion') AND v_report.entity_type <> 'user' THEN
      RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.resolve', 'report', p_report_id, jsonb_build_object('entityType', v_report.entity_type), p_correlation_id, 'enforcement_unavailable');
    END IF;
  END IF;

  v_before := jsonb_build_object('id', v_report.id, 'status', v_report.status, 'entity_type', v_report.entity_type, 'entity_id', v_report.entity_id);
  v_target_type := CASE WHEN p_enforcement_action IN ('post_remove', 'event_remove') THEN replace(p_enforcement_action, '_remove', '') WHEN p_enforcement_action IN ('suspend', 'block', 'schedule_deletion') THEN 'user' ELSE NULL END;
  v_target_user := CASE
    WHEN v_report.entity_type = 'user' THEN v_report.entity_id
    WHEN v_report.entity_type = 'post' THEN (SELECT author_id FROM public.posts WHERE id = v_report.entity_id)
    WHEN v_report.entity_type = 'event' THEN (SELECT created_by FROM public.events WHERE id = v_report.entity_id)
    ELSE NULL END;
  IF p_enforcement_action <> 'none' THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_target_user;
    IF v_email IS NULL THEN v_notification_status := 'not_required'; END IF;
  END IF;

  IF p_enforcement_action <> 'none' THEN
    v_action := CASE p_enforcement_action WHEN 'post_remove' THEN 'post.remove' WHEN 'event_remove' THEN 'event.remove' WHEN 'suspend' THEN 'restriction.suspend' WHEN 'block' THEN 'restriction.block' ELSE 'deletion.schedule' END;
    BEGIN
      IF p_enforcement_action = 'post_remove' THEN
        v_enforcement := public.admin_tx_post_remove(p_actor_id, p_actor_email, p_internal_reason, p_correlation_id, v_report.entity_id);
      ELSIF p_enforcement_action = 'event_remove' THEN
        v_enforcement := public.admin_tx_event_remove(p_actor_id, p_actor_email, p_internal_reason, p_correlation_id, v_report.entity_id);
      ELSIF p_enforcement_action = 'suspend' THEN
        v_enforcement := public.admin_tx_restriction_suspend_v2(p_actor_id, p_actor_email, p_internal_reason, p_correlation_id, v_report.entity_id, p_suspended_until, p_public_category, p_public_explanation);
      ELSIF p_enforcement_action = 'block' THEN
        v_enforcement := public.admin_tx_restriction_block_v2(p_actor_id, p_actor_email, p_internal_reason, p_correlation_id, v_report.entity_id, p_public_category, p_public_explanation);
      ELSE
        v_enforcement := public.admin_tx_schedule_account_deletion(p_actor_id, p_actor_email, p_internal_reason, p_correlation_id, v_report.entity_id, p_public_category, p_public_explanation, 'student_reports', p_report_id::text, false);
      END IF;
      IF coalesce(v_enforcement->>'status', '') <> 'ok' THEN
        RAISE EXCEPTION 'enforcement_failed' USING ERRCODE = 'P0001';
      END IF;
      v_enforcement_status := 'applied';
    EXCEPTION WHEN OTHERS THEN
      RETURN private.admin_tx_fail(p_actor_id, p_actor_email, v_action, coalesce(v_target_type, v_report.entity_type), coalesce(v_report.entity_id, p_report_id), jsonb_build_object('reportId', p_report_id, 'enforcementAction', p_enforcement_action), p_correlation_id, 'enforcement_failed');
    END;
    v_notification_status := 'pending';
  END IF;

  SELECT coalesce(max(sequence_no), 0) + 1 INTO v_sequence FROM public.report_decision_history WHERE report_id = p_report_id;
  INSERT INTO public.report_decision_history (
    report_id, sequence_no, previous_status, new_status, resolution_outcome,
    internal_decision_note, public_category, public_explanation,
    enforcement_action, enforcement_target_type, enforcement_target_id,
    enforcement_status, enforcement_correlation_id, notification_status,
    actor_user_id, actor_email, correlation_id
  ) VALUES (
    p_report_id, v_sequence, v_report.status, p_new_status, p_resolution_outcome,
    btrim(p_internal_decision_note), nullif(btrim(p_public_category), ''), nullif(btrim(p_public_explanation), ''),
    p_enforcement_action, v_target_type, CASE WHEN p_enforcement_action <> 'none' THEN v_report.entity_id ELSE NULL END,
    v_enforcement_status, CASE WHEN p_enforcement_action <> 'none' THEN p_correlation_id ELSE NULL END, v_notification_status,
    p_actor_id, p_actor_email, p_correlation_id
  ) RETURNING id INTO v_decision_id;

  UPDATE public.reports SET status = p_new_status WHERE id = p_report_id;

  IF p_enforcement_action <> 'none' THEN
    IF v_email IS NOT NULL THEN
      IF p_enforcement_action = 'schedule_deletion' THEN
        SELECT id INTO v_outbox_id FROM public.transactional_email_outbox WHERE correlation_id = p_correlation_id AND kind = 'admin_deletion_scheduled' ORDER BY created_at DESC LIMIT 1;
        IF v_outbox_id IS NOT NULL THEN
          UPDATE public.transactional_email_outbox SET payload = payload || jsonb_build_object('report_decision_id', v_decision_id) WHERE id = v_outbox_id;
        END IF;
      ELSE
        INSERT INTO public.transactional_email_outbox (kind, recipient_email, payload, idempotency_key, correlation_id)
        VALUES ('admin_report_resolution', v_email, jsonb_build_object('report_decision_id', v_decision_id, 'violation_category', p_public_category, 'public_reason', p_public_explanation), 'report-resolution:' || v_decision_id::text, p_correlation_id)
        RETURNING id INTO v_outbox_id;
      END IF;
      INSERT INTO public.report_notification_deliveries (decision_id, outbox_id) VALUES (v_decision_id, v_outbox_id);
    END IF;
  END IF;

  v_after := jsonb_build_object('id', v_report.id, 'status', p_new_status, 'decisionId', v_decision_id, 'enforcementAction', p_enforcement_action, 'enforcementStatus', v_enforcement_status);
  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, CASE WHEN p_new_status = 'dismissed' THEN 'report.dismiss' ELSE 'report.resolve' END, 'report', p_report_id, btrim(p_internal_reason), v_before, v_after, jsonb_build_object('reportId', p_report_id, 'decisionId', v_decision_id, 'resolutionOutcome', p_resolution_outcome, 'enforcementAction', p_enforcement_action), p_correlation_id);
END;
$$;

-- Explicit correction path. It never edits the original row, changes report
-- status, or reapplies enforcement; it records a new superseding decision that
-- preserves the original outcome and enforcement outcome for audit clarity.
CREATE OR REPLACE FUNCTION public.admin_tx_report_supersede(
  p_actor_id uuid, p_actor_email text, p_internal_reason text, p_correlation_id uuid,
  p_report_id uuid, p_supersedes_decision_id uuid, p_internal_decision_note text,
  p_public_category text DEFAULT NULL, p_public_explanation text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_report public.reports%ROWTYPE; v_old public.report_decision_history%ROWTYPE; v_id uuid; v_seq integer;
BEGIN
  IF char_length(btrim(coalesce(p_internal_reason, ''))) NOT BETWEEN 3 AND 500 OR char_length(btrim(coalesce(p_internal_decision_note, ''))) NOT BETWEEN 3 AND 2000 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.supersede', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'invalid_reason');
  END IF;
  PERFORM private.report_decision_lock(p_report_id);
  SELECT * INTO v_report FROM public.reports WHERE id = p_report_id FOR UPDATE;
  SELECT * INTO v_old FROM public.report_decision_history WHERE id = p_supersedes_decision_id AND report_id = p_report_id;
  IF v_report.id IS NULL OR v_old.id IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.supersede', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'not_found');
  END IF;
  IF v_report.status NOT IN ('resolved', 'dismissed') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.supersede', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'invalid_transition');
  END IF;
  IF v_old.enforcement_action <> 'none' AND char_length(btrim(coalesce(p_public_explanation, ''))) NOT BETWEEN 10 AND 500 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'report.supersede', 'report', p_report_id, '{}'::jsonb, p_correlation_id, 'public_explanation_required');
  END IF;
  SELECT coalesce(max(sequence_no), 0) + 1 INTO v_seq FROM public.report_decision_history WHERE report_id = p_report_id;
  INSERT INTO public.report_decision_history (
    report_id, sequence_no, previous_status, new_status, resolution_outcome,
    internal_decision_note, public_category, public_explanation,
    enforcement_action, enforcement_target_type, enforcement_target_id,
    enforcement_status, enforcement_correlation_id, notification_status,
    actor_user_id, actor_email, correlation_id, supersedes_decision_id
  ) VALUES (
    p_report_id, v_seq, v_old.previous_status, v_old.new_status, v_old.resolution_outcome,
    btrim(p_internal_decision_note), nullif(btrim(coalesce(p_public_category, v_old.public_category)), ''), nullif(btrim(coalesce(p_public_explanation, v_old.public_explanation)), ''),
    v_old.enforcement_action, v_old.enforcement_target_type, v_old.enforcement_target_id,
    v_old.enforcement_status, v_old.enforcement_correlation_id, v_old.notification_status,
    p_actor_id, p_actor_email, p_correlation_id, p_supersedes_decision_id
  ) RETURNING id INTO v_id;
  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'report.supersede', 'report', p_report_id, btrim(p_internal_reason), jsonb_build_object('supersedesDecisionId', p_supersedes_decision_id), jsonb_build_object('decisionId', v_id, 'supersedesDecisionId', p_supersedes_decision_id), jsonb_build_object('reportId', p_report_id), p_correlation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_tx_report_set_status(uuid, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tx_report_decide(uuid, text, text, uuid, uuid, text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tx_report_supersede(uuid, text, text, uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_report_set_status(uuid, text, text, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_tx_report_decide(uuid, text, text, uuid, uuid, text, text, text, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_tx_report_supersede(uuid, text, text, uuid, uuid, uuid, text, text, text) TO service_role;

COMMIT;
