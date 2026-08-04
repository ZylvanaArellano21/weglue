-- =============================================================================
-- 067 — Day 10F deleted-message privacy
--
-- This migration deliberately starts at 067. Production has 001–050 and
-- 052–066 applied; the historical 051 implementation was never deployed and
-- must not be replayed.
--
-- Privacy model
--   * `messages` remains the conversation-integrity record, but a deletion
--     atomically scrubs every ordinary content/attachment reference.
--   * private operational rows retain only the minimum 365-day structural
--     metadata. A separately protected cleanup job may hold an object path only
--     until Storage deletion is verified; it is never student-readable and is
--     nulled on completion.
--   * report evidence is private, immutable, founder-gated in the application,
--     and is never stored in the reporter-readable `reports` row.
--   * Storage work is necessarily outside PostgreSQL. A scrub therefore commits
--     fail-closed for ordinary readers first; the worker does not report an
--     attachment deletion as complete until the original object is removed.
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- ── Canonical message state ─────────────────────────────────────────────────

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deletion_kind text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deletion_correlation_id uuid;

-- Push rows need an immutable structural source id so delete can suppress a
-- queued preview. No message body/path enters the new column or worker payload.
ALTER TABLE public.push_queue ADD COLUMN IF NOT EXISTS source_message_id uuid;
CREATE INDEX IF NOT EXISTS push_queue_source_message_pending_idx
  ON public.push_queue (source_message_id)
  WHERE source_message_id IS NOT NULL AND status IN ('pending', 'processing');

-- Existing pre-067 soft-deletions do not record an authoritative deletion
-- action. Do not mislabel them as sender or administrator deletion: preserve a
-- distinct legacy state while the row is brought under this privacy lifecycle.
-- New operations always record the exact actor/action type.
UPDATE public.messages
   SET deletion_kind = 'legacy_deleted_unknown'
 WHERE deleted_at IS NOT NULL
   AND deletion_kind = 'active';

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_deletion_kind_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_deletion_kind_check
  CHECK (deletion_kind IN ('active', 'sender_deleted', 'officer_removed', 'group_admin_removed', 'legacy_deleted_unknown'));

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_active_deletion_consistency;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_active_deletion_consistency
  CHECK (
    (deletion_kind = 'active' AND deleted_at IS NULL)
    OR (deletion_kind <> 'active' AND deleted_at IS NOT NULL)
  ) NOT VALID;

-- The retained row contains no message text, attachment reference, or report
-- evidence. It exists only so conversation ordering and immutable IDs remain
-- structurally sound until the metadata expiry policy permits its purge.
CREATE TABLE IF NOT EXISTS private.message_deletion_operations (
  id                    uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  message_id            uuid NOT NULL UNIQUE,
  conversation_id       uuid NOT NULL,
  sender_id             uuid,
  message_created_at    timestamptz,
  deleted_at            timestamptz NOT NULL DEFAULT now(),
  actor_id              uuid,
  action_type           text NOT NULL CHECK (action_type IN ('sender_delete', 'officer_moderation', 'group_admin_moderation', 'account_deletion', 'legacy_deleted_unknown')),
  attachment_existed    boolean NOT NULL DEFAULT false,
  reconciliation_state  text NOT NULL DEFAULT 'completed' CHECK (reconciliation_state IN ('pending_attachment_cleanup', 'completed', 'reconciliation_required', 'purged')),
  purge_status          text NOT NULL DEFAULT 'scheduled' CHECK (purge_status IN ('scheduled', 'processing', 'purged', 'reconciliation_required')),
  purge_after           timestamptz NOT NULL,
  audit_correlation_id  uuid NOT NULL,
  purged_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_deletion_operations_purge_idx
  ON private.message_deletion_operations (purge_after)
  WHERE purge_status = 'scheduled' AND reconciliation_state = 'completed';

-- This is intentionally NOT deleted-message metadata. It is a transient,
-- server-only reconciliation envelope that contains the sole object path needed
-- to retry physical Storage deletion. `original_object_path` is nulled after a
-- verified delete, and cannot be selected by any client role.
CREATE TABLE IF NOT EXISTS private.message_attachment_cleanup_jobs (
  id                    uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  operation_id          uuid NOT NULL UNIQUE REFERENCES private.message_deletion_operations(id) ON DELETE CASCADE,
  original_bucket       text NOT NULL DEFAULT 'chat-attachments',
  original_object_path  text,
  -- Kept for an audit-safe join only. A single copied object is applied to
  -- EVERY evidence row for source_message_id, never just one report.
  report_evidence_id    uuid,
  requires_evidence_copy boolean NOT NULL DEFAULT false,
  state                 text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'retry_pending', 'completed', 'reconciliation_required')),
  retry_count           integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at         timestamptz NOT NULL DEFAULT now(),
  claimed_by            text,
  claim_token           uuid,
  claim_expires_at      timestamptz,
  last_error_code       text,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_attachment_cleanup_claim_idx
  ON private.message_attachment_cleanup_jobs (next_retry_at, created_at)
  WHERE state IN ('pending', 'retry_pending');

-- ── Founder-only report evidence ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS private.report_message_evidence (
  id                         uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  report_id                  uuid NOT NULL UNIQUE,
  source_message_id          uuid NOT NULL,
  content_snapshot           text,
  attachment_name            text,
  attachment_size            bigint,
  attachment_mime            text,
  -- Source path may exist only before a deleted message's worker has copied it
  -- to the dedicated private evidence bucket. It is never exposed to students.
  source_attachment_path     text,
  retained_attachment_bucket text,
  retained_attachment_path   text,
  attachment_state           text NOT NULL DEFAULT 'none' CHECK (attachment_state IN ('none', 'source_pending', 'retained', 'unavailable', 'purged')),
  captured_at                timestamptz NOT NULL DEFAULT now(),
  terminal_decision_at       timestamptz,
  retention_expires_at       timestamptz,
  retention_basis            text NOT NULL DEFAULT 'open_review' CHECK (retention_basis IN ('open_review', 'terminal_30_days', 'enforcement_180_days', 'appeal_90_days', 'legal_or_safety_hold')),
  purge_state                text NOT NULL DEFAULT 'scheduled' CHECK (purge_state IN ('scheduled', 'processing', 'reconciliation_required')),
  claimed_by                 text,
  claim_token                uuid,
  claim_expires_at           timestamptz,
  retry_count                integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_retry_at              timestamptz NOT NULL DEFAULT now(),
  last_error_code            text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_message_evidence_has_payload CHECK (
    content_snapshot IS NOT NULL OR attachment_name IS NOT NULL OR source_attachment_path IS NOT NULL OR retained_attachment_path IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS report_message_evidence_expiry_idx
  ON private.report_message_evidence (retention_expires_at, next_retry_at)
  WHERE purge_state = 'scheduled';
CREATE INDEX IF NOT EXISTS report_message_evidence_message_idx
  ON private.report_message_evidence (source_message_id);

-- A SECURITY DEFINER function executes as its owner, so current_user is NOT a
-- caller-role test. PostgREST retains the verified JWT role in this request
-- setting; only the service-role Edge worker has this value.
CREATE OR REPLACE FUNCTION private.is_service_role_request()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';
$$;

CREATE TABLE IF NOT EXISTS private.report_evidence_holds (
  id                  uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  report_id           uuid NOT NULL,
  hold_type           text NOT NULL CHECK (hold_type IN ('legal', 'safety')),
  internal_reason     text NOT NULL CHECK (char_length(btrim(internal_reason)) BETWEEN 3 AND 500),
  applied_by          uuid NOT NULL,
  applied_at          timestamptz NOT NULL DEFAULT now(),
  released_by         uuid,
  released_at         timestamptz,
  release_reason      text CHECK (release_reason IS NULL OR char_length(btrim(release_reason)) BETWEEN 3 AND 500),
  correlation_id      uuid NOT NULL,
  CONSTRAINT report_evidence_hold_release_consistency CHECK (
    (released_at IS NULL AND released_by IS NULL AND release_reason IS NULL)
    OR (released_at IS NOT NULL AND released_by IS NOT NULL AND release_reason IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS report_evidence_one_active_hold
  ON private.report_evidence_holds (report_id)
  WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS private.report_evidence_appeals (
  id                  uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  report_id           uuid NOT NULL,
  status              text NOT NULL CHECK (status IN ('active', 'resolved')),
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  resolved_by         uuid,
  internal_note       text CHECK (internal_note IS NULL OR char_length(btrim(internal_note)) BETWEEN 3 AND 2000),
  correlation_id      uuid NOT NULL,
  CONSTRAINT report_evidence_appeal_resolution_consistency CHECK (
    (status = 'active' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status = 'resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS report_evidence_one_active_appeal
  ON private.report_evidence_appeals (report_id)
  WHERE status = 'active';

ALTER TABLE private.message_deletion_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.message_deletion_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE private.message_attachment_cleanup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.message_attachment_cleanup_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE private.report_message_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.report_message_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE private.report_evidence_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.report_evidence_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE private.report_evidence_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.report_evidence_appeals FORCE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
-- RLS policies which call a private helper need schema USAGE at execution time.
-- This does not confer table access; direct table grants remain absent. Only
-- narrowly scoped predicate functions receive an explicit EXECUTE grant below.
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT SELECT ON private.message_deletion_operations TO service_role;
GRANT SELECT ON private.message_attachment_cleanup_jobs TO service_role;
GRANT SELECT ON private.report_message_evidence TO service_role;

-- Explicit private-table policies make the trusted service worker usable while
-- keeping every anonymous/authenticated request at zero rows. `postgres` is
-- the SECURITY DEFINER owner used by these fixed database entry points; it is
-- not a PostgREST role. The service-role branch additionally requires the
-- verified JWT role setting, preventing a connection role name from becoming a
-- substitute for the service credential.
CREATE POLICY "private deletion operations server only" ON private.message_deletion_operations
  FOR ALL TO postgres, service_role
  USING (current_user = 'postgres' OR private.is_service_role_request())
  WITH CHECK (current_user = 'postgres' OR private.is_service_role_request());
CREATE POLICY "private attachment cleanup server only" ON private.message_attachment_cleanup_jobs
  FOR ALL TO postgres, service_role
  USING (current_user = 'postgres' OR private.is_service_role_request())
  WITH CHECK (current_user = 'postgres' OR private.is_service_role_request());
CREATE POLICY "private report evidence server only" ON private.report_message_evidence
  FOR ALL TO postgres, service_role
  USING (current_user = 'postgres' OR private.is_service_role_request())
  WITH CHECK (current_user = 'postgres' OR private.is_service_role_request());
CREATE POLICY "private report evidence holds server only" ON private.report_evidence_holds
  FOR ALL TO postgres, service_role
  USING (current_user = 'postgres' OR private.is_service_role_request())
  WITH CHECK (current_user = 'postgres' OR private.is_service_role_request());
CREATE POLICY "private report evidence appeals server only" ON private.report_evidence_appeals
  FOR ALL TO postgres, service_role
  USING (current_user = 'postgres' OR private.is_service_role_request())
  WITH CHECK (current_user = 'postgres' OR private.is_service_role_request());

-- A dedicated private bucket prevents a remembered chat object path from being
-- sufficient to retrieve retained report evidence.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('deleted-message-evidence', 'deleted-message-evidence', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Existing evidence must leave the reporter-readable reports record before any
-- new sender-deletion path exists. Invalid/legacy external paths remain honest
-- `unavailable` evidence rather than becoming a new copy of user content.
INSERT INTO private.report_message_evidence (
  report_id, source_message_id, content_snapshot,
  attachment_name, attachment_size, attachment_mime,
  source_attachment_path, attachment_state
)
SELECT
  r.id,
  COALESCE(r.message_id, r.entity_id),
  r.content_snapshot,
  r.attachment_snapshot ->> 'name',
  CASE WHEN COALESCE(r.attachment_snapshot ->> 'size', '') ~ '^[0-9]+$'
       THEN (r.attachment_snapshot ->> 'size')::bigint END,
  r.attachment_snapshot ->> 'mime',
  CASE
    WHEN COALESCE(r.attachment_snapshot ->> 'url', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/.+' THEN r.attachment_snapshot ->> 'url'
    ELSE NULL
  END,
  CASE
    WHEN r.attachment_snapshot IS NULL THEN 'none'
    WHEN COALESCE(r.attachment_snapshot ->> 'url', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/.+' THEN 'source_pending'
    ELSE 'unavailable'
  END
FROM public.reports r
WHERE r.entity_type IN ('message', 'chat')
  AND COALESCE(r.message_id, r.entity_id) IS NOT NULL
  AND (r.content_snapshot IS NOT NULL OR r.attachment_snapshot IS NOT NULL)
ON CONFLICT (report_id) DO NOTHING;

UPDATE public.reports
   SET content_snapshot = NULL,
       attachment_snapshot = NULL
 WHERE entity_type IN ('message', 'chat')
   AND (content_snapshot IS NOT NULL OR attachment_snapshot IS NOT NULL);

-- Existing terminal reports must not become indefinite evidence merely because
-- their historical rows predate Day 10F. Decision history is authoritative
-- when present. For an older terminal row with no decision timestamp, retain
-- conservatively for 180 days from this migration rather than inventing a past
-- terminal date or retaining the content forever.
ALTER TABLE private.report_message_evidence
  DROP CONSTRAINT IF EXISTS report_message_evidence_retention_basis_check;
ALTER TABLE private.report_message_evidence
  ADD CONSTRAINT report_message_evidence_retention_basis_check CHECK (
    retention_basis IN ('open_review', 'terminal_30_days', 'enforcement_180_days', 'appeal_active', 'appeal_90_days', 'legal_or_safety_hold', 'legacy_conservative_180_days')
  );
WITH latest AS (
  SELECT DISTINCT ON (d.report_id) d.report_id, d.created_at, d.enforcement_action
    FROM public.report_decision_history d
   ORDER BY d.report_id, d.sequence_no DESC
)
UPDATE private.report_message_evidence e
   SET terminal_decision_at = l.created_at,
       retention_expires_at = l.created_at + CASE WHEN l.enforcement_action = 'none' THEN interval '30 days' ELSE interval '180 days' END,
       retention_basis = CASE WHEN l.enforcement_action = 'none' THEN 'terminal_30_days' ELSE 'enforcement_180_days' END,
       updated_at = now()
  FROM latest l
 WHERE e.report_id = l.report_id
   AND EXISTS (SELECT 1 FROM public.reports r WHERE r.id = e.report_id AND r.status IN ('resolved', 'dismissed'));
UPDATE private.report_message_evidence e
   SET terminal_decision_at = now(), retention_expires_at = now() + interval '180 days',
       retention_basis = 'legacy_conservative_180_days', updated_at = now()
  FROM public.reports r
 WHERE r.id = e.report_id AND r.status IN ('resolved', 'dismissed')
   AND e.retention_expires_at IS NULL;

-- Earlier releases represented deleted messages as a soft-delete only. RLS
-- hid those records from students, but their body and attachment references
-- must not remain readable to privileged Dashboard queries or any accidental
-- service-side path. Bring every legacy deleted row into the same structural
-- lifecycle before installing the new policies. A legacy action remains
-- explicitly unknown rather than being conflated with sender deletion or
-- moderation. Only a validated chat object path enters the short-lived cleanup
-- envelope; every ordinary content/attachment field is scrubbed immediately.
INSERT INTO private.message_deletion_operations (
  message_id, conversation_id, sender_id, message_created_at, deleted_at,
  actor_id, action_type, attachment_existed, reconciliation_state, purge_status,
  purge_after, audit_correlation_id
)
SELECT
  m.id, m.conversation_id, m.sender_id, m.created_at, m.deleted_at,
  m.deleted_by, 'legacy_deleted_unknown', m.attachment_url IS NOT NULL,
  CASE
    WHEN m.attachment_url ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/.+' THEN 'pending_attachment_cleanup'
    WHEN m.attachment_url IS NOT NULL THEN 'reconciliation_required'
    ELSE 'completed'
  END,
  CASE WHEN m.attachment_url IS NOT NULL AND m.attachment_url !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/.+' THEN 'reconciliation_required' ELSE 'scheduled' END,
  m.deleted_at + interval '365 days', extensions.gen_random_uuid()
FROM public.messages m
WHERE m.deleted_at IS NOT NULL
ON CONFLICT (message_id) DO NOTHING;

INSERT INTO private.message_attachment_cleanup_jobs (
  operation_id, original_object_path, report_evidence_id, requires_evidence_copy
)
SELECT
  o.id,
  m.attachment_url,
  (SELECT e.id FROM private.report_message_evidence e WHERE e.source_message_id = m.id ORDER BY e.captured_at ASC LIMIT 1),
  EXISTS (SELECT 1 FROM private.report_message_evidence e WHERE e.source_message_id = m.id)
FROM public.messages m
JOIN private.message_deletion_operations o ON o.message_id = m.id
WHERE m.deleted_at IS NOT NULL
  AND m.attachment_url ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/.+'
ON CONFLICT (operation_id) DO NOTHING;

DELETE FROM public.polls p
USING public.messages m
WHERE m.id = p.message_id
  AND m.deleted_at IS NOT NULL;

UPDATE public.messages
   SET content = NULL,
       attachment_url = NULL,
       attachment_name = NULL,
       attachment_size = NULL,
       attachment_mime = NULL,
       shared_post_id = NULL,
       shared_event_id = NULL,
       deletion_correlation_id = COALESCE(
         deletion_correlation_id,
         (SELECT o.audit_correlation_id FROM private.message_deletion_operations o WHERE o.message_id = messages.id)
       )
 WHERE deleted_at IS NOT NULL;

-- ── Visibility predicates: fixed search_path and no attacker-selected lookup ─

CREATE OR REPLACE FUNCTION private.message_is_active_for_policy(p_message_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.messages m
     WHERE m.id = p_message_id
       AND m.deleted_at IS NULL
       AND m.deletion_kind = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION private.active_chat_attachment_readable(p_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.messages m
     WHERE m.attachment_url = p_name
       AND m.deleted_at IS NULL
       AND m.deletion_kind = 'active'
       AND public.is_conversation_participant(m.conversation_id)
  );
$$;

-- A message may bind only the caller's just-uploaded object for its own
-- conversation.  This prevents a modified client from reusing a remembered
-- path belonging to another participant or conversation.  It also prevents a
-- second active message from sharing an object that a deletion worker might
-- later remove, and prevents a pending-cleanup object from being rebound.
CREATE OR REPLACE FUNCTION private.chat_attachment_available_to_sender(
  p_name text,
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT p_name ~ ('^' || p_conversation_id::text || '/.+')
     AND EXISTS (
       SELECT 1
         FROM storage.objects o
        WHERE o.bucket_id = 'chat-attachments'
          AND o.name = p_name
          AND o.owner = auth.uid()
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.messages m
        WHERE m.attachment_url = p_name
     )
     AND NOT EXISTS (
      SELECT 1
        FROM private.message_attachment_cleanup_jobs j
        WHERE j.original_object_path = p_name
          AND j.state IN ('pending', 'processing', 'retry_pending', 'reconciliation_required')
     );
$$;

-- Push dispatch uses this server-only wrapper immediately before a provider
-- payload is assembled. It is not an authenticated client RPC, so message IDs
-- cannot become an existence oracle.
CREATE OR REPLACE FUNCTION public.message_is_active(p_message_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$ SELECT private.message_is_active_for_policy(p_message_id); $$;

REVOKE ALL ON FUNCTION public.message_is_active(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.message_is_active(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION private.message_is_active_for_policy(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.active_chat_attachment_readable(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.chat_attachment_available_to_sender(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_is_active(uuid) TO service_role;
-- Do not grant this helper to students: a direct UUID probe would become an
-- active-message existence oracle. Poll policies below use inline predicates.
GRANT EXECUTE ON FUNCTION private.message_is_active_for_policy(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.active_chat_attachment_readable(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.chat_attachment_available_to_sender(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "chat-attachments: participants can read" ON storage.objects;
DROP POLICY IF EXISTS "chat-attachments: active message participants can read" ON storage.objects;
CREATE POLICY "chat-attachments: active message participants can read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND private.active_chat_attachment_readable(name)
  );

-- Keep the original client upload route, but reject malformed paths and users
-- whose account may no longer use student messaging.  Object ownership is
-- verified again when a message binds the object above, after Storage has
-- recorded the uploader as owner.
DROP POLICY IF EXISTS "chat-attachments: participants can upload" ON storage.objects;
CREATE POLICY "chat-attachments: participants can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND public.current_student_can_access_app()
    AND CASE
      WHEN name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/.+'
      THEN public.is_conversation_participant((storage.foldername(name))[1]::uuid)
      ELSE false
    END
  );

-- This is restrictive so it composes with the existing sender/participant
-- message policy without broadening any normal message semantics.
DROP POLICY IF EXISTS "messages: sender-owned chat attachment" ON public.messages;
CREATE POLICY "messages: sender-owned chat attachment"
  ON public.messages AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    attachment_url IS NULL
    OR private.chat_attachment_available_to_sender(attachment_url, conversation_id)
  );

-- Day 10E's opaque synchronization pattern. Message clients deliberately do
-- not consume Postgres-change payloads: an UPDATE stream can otherwise retain
-- a pre-scrub OLD row while the canonical row is being deleted. Both topics
-- and every payload are structural-only and never carry a message id, body,
-- attachment path, deletion type, actor, or audit correlation id.
CREATE OR REPLACE FUNCTION private.can_receive_message_sync(p_topic text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ '^sync:message:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.current_student_can_access_app()
       AND public.is_conversation_participant(pg_catalog.substr(p_topic, 14)::uuid)
    WHEN p_topic ~ '^sync:message-inbox:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.current_student_can_access_app()
       AND auth.uid() = pg_catalog.substr(p_topic, 20)::uuid
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION private.broadcast_message_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;
  v_participant record;
BEGIN
  -- Every message lifecycle event uses the same opaque ping. The UI must
  -- refetch under RLS; duplicate / out-of-order pings are intentionally safe.
  PERFORM realtime.send('{}'::jsonb, 'invalidate', 'sync:message:' || v_conversation_id::text, true);
  FOR v_participant IN
    SELECT cp.user_id
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = v_conversation_id
  LOOP
    PERFORM realtime.send('{}'::jsonb, 'invalidate', 'sync:message-inbox:' || v_participant.user_id::text, true);
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Canonical scrub has already committed or will commit. Focus/reconnect and
  -- normal RLS refetch remain the recovery path if Realtime is unavailable.
  RAISE WARNING 'broadcast_message_sync failed';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_message_deletion_sync ON public.messages;
DROP TRIGGER IF EXISTS trg_broadcast_message_sync ON public.messages;
DROP FUNCTION IF EXISTS private.broadcast_message_deletion_sync();
CREATE TRIGGER trg_broadcast_message_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_message_sync();

DROP POLICY IF EXISTS "weglue_receive_message_sync" ON realtime.messages;
CREATE POLICY "weglue_receive_message_sync"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND private.can_receive_message_sync(realtime.topic())
  );

REVOKE ALL ON FUNCTION private.is_service_role_request() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.can_receive_message_sync(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.broadcast_message_sync() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_receive_message_sync(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_service_role_request() TO service_role;

-- Ensure all direct reads, preview helpers, and the message-content search use
-- a database boundary, not a client-side deleted-row filter.
DROP POLICY IF EXISTS "messages: participants can read active" ON public.messages;
CREATE POLICY "messages: participants can read active"
  ON public.messages FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND deletion_kind = 'active'
    AND public.is_conversation_participant(conversation_id)
  );
DROP POLICY IF EXISTS "messages: non-member club preview" ON public.messages;
CREATE POLICY "messages: non-member club preview"
  ON public.messages FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND deletion_kind = 'active'
    AND NOT public.is_conversation_participant(conversation_id)
    AND EXISTS (
      SELECT 1 FROM public.conversations c
       WHERE c.id = messages.conversation_id AND c.type = 'club_group'
    )
    AND messages.id IN (SELECT public.recent_club_preview_message_ids(messages.conversation_id))
  );

-- There is no supported client-side message edit feature. The legacy broad
-- sender UPDATE policy would let a modified client set deleted_at back to NULL,
-- reinsert text, or mark an active row deleted without the scrub transaction.
-- Server-side SECURITY DEFINER lifecycle/account-deletion functions retain the
-- required maintenance capability; students have no direct UPDATE route.
DROP POLICY IF EXISTS "messages: senders can update" ON public.messages;
DROP POLICY IF EXISTS "messages: senders can update own" ON public.messages;

-- Keep the deployed enqueue_push signature untouched for unrelated callers.
-- A distinct message-only helper avoids overload ambiguity for legacy triggers
-- that invoke enqueue_push with its historical optional parameters. The
-- immutable source id lets deletion suppress queued previews without parsing
-- user-visible content.
CREATE OR REPLACE FUNCTION public.enqueue_message_push(
  p_user uuid, p_notification_id uuid, p_type text, p_title text, p_body text,
  p_route jsonb, p_collapse_key text DEFAULT NULL, p_dedupe_key text DEFAULT NULL,
  p_min_gap_minutes integer DEFAULT 0, p_source_type text DEFAULT NULL,
  p_source_message_id uuid DEFAULT NULL, p_source_conversation_id uuid DEFAULT NULL,
  p_source_channel_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_reg public.notification_types%ROWTYPE; v_cap integer; v_sent_hour integer;
BEGIN
  SELECT * INTO v_reg FROM public.notification_types WHERE type = p_type;
  IF NOT FOUND OR NOT v_reg.enabled OR NOT v_reg.push THEN RETURN; END IF;
  IF NOT public.user_wants_push(p_user, v_reg.category) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.push_tokens WHERE user_id = p_user AND status = 'active') THEN RETURN; END IF;
  v_cap := COALESCE((SELECT (value ->> v_reg.category)::integer FROM public.notification_config WHERE key = 'push.hourly_caps'), 30);
  IF v_cap <= 0 THEN RETURN; END IF;
  SELECT count(*) INTO v_sent_hour FROM public.push_queue
   WHERE user_id = p_user AND category = v_reg.category AND created_at > now() - interval '1 hour'
     AND status IN ('pending', 'processing', 'sent');
  IF v_sent_hour >= v_cap THEN RETURN; END IF;
  IF p_collapse_key IS NOT NULL AND p_min_gap_minutes > 0 AND EXISTS (
    SELECT 1 FROM public.push_queue WHERE user_id = p_user AND collapse_key = p_collapse_key
      AND status = 'sent' AND sent_at > now() - make_interval(mins => p_min_gap_minutes)
  ) THEN RETURN; END IF;
  IF p_collapse_key IS NOT NULL THEN
    UPDATE public.push_queue SET title = p_title, body = p_body, route = COALESCE(p_route, '{}'::jsonb),
      notification_id = COALESCE(p_notification_id, notification_id),
      source_message_id = COALESCE(p_source_message_id, source_message_id), created_at = now()
    WHERE user_id = p_user AND collapse_key = p_collapse_key AND status = 'pending';
    IF FOUND THEN RETURN; END IF;
  END IF;
  INSERT INTO public.push_queue (user_id, notification_id, category, title, body, route, collapse_key, dedupe_key, source_message_id)
  VALUES (p_user, p_notification_id, v_reg.category, p_title, p_body, COALESCE(p_route, '{}'::jsonb),
          p_collapse_key, p_dedupe_key, p_source_message_id)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_message_push(uuid, uuid, text, text, text, jsonb, text, text, integer, text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- The original trigger exposed message previews only through push_queue. This
-- replacement has the same notification copy but stamps source_message_id so
-- a sender deletion can suppress it and the dispatcher can revalidate it.
CREATE OR REPLACE FUNCTION public.handle_message_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conv public.conversations%ROWTYPE; v_sender text; v_channel text; v_is_channel boolean := false;
  v_club text; v_preview text; v_title text; v_body text; v_type text; v_recipient record;
BEGIN
  BEGIN
    IF NEW.deleted_at IS NOT NULL OR NEW.deletion_kind <> 'active' THEN RETURN NEW; END IF;
    SELECT * INTO v_conv FROM public.conversations WHERE id = NEW.conversation_id;
    IF NOT FOUND OR v_conv.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    SELECT COALESCE(NULLIF(full_name, ''), username) INTO v_sender FROM public.profiles WHERE id = NEW.sender_id;
    v_sender := COALESCE(v_sender, 'Someone');
    v_preview := CASE
      WHEN NEW.message_type = 'image' THEN COALESCE(NULLIF(NEW.content, ''), '📷 Photo')
      WHEN NEW.message_type = 'video' THEN COALESCE(NULLIF(NEW.content, ''), '🎬 Video')
      WHEN NEW.message_type = 'file' THEN COALESCE(NULLIF(NEW.content, ''), '📎 File')
      WHEN NEW.message_type = 'poll' THEN '📊 Started a poll'
      WHEN NEW.message_type = 'shared_event' THEN '📅 Shared an event'
      WHEN NEW.message_type = 'shared_post' THEN '🖼️ Shared a post'
      ELSE COALESCE(NEW.content, 'New message') END;
    v_preview := left(v_preview, 140);
    IF v_conv.type = 'direct' THEN
      v_type := 'dm_message'; v_title := v_sender; v_body := v_preview;
    ELSIF v_conv.type = 'group' THEN
      v_type := 'group_message'; v_title := COALESCE(v_conv.name, 'Group chat'); v_body := v_sender || ': ' || v_preview;
    ELSE
      v_type := 'club_chat_message';
      SELECT name INTO v_club FROM public.clubs WHERE id = v_conv.club_id;
      IF NEW.channel_id IS NOT NULL THEN
        SELECT CASE WHEN ch.kind = 'channel' THEN ch.name END, ch.kind = 'channel'
          INTO v_channel, v_is_channel FROM public.conversation_channels ch WHERE ch.id = NEW.channel_id;
      END IF;
      v_title := COALESCE(v_club, 'Club chat') || CASE WHEN v_conv.type = 'officer_chat' THEN ' Officers' ELSE '' END;
      v_body := CASE WHEN v_channel IS NOT NULL THEN '#' || ltrim(v_channel, '#') || ' · ' || v_sender || ': ' || v_preview ELSE v_sender || ': ' || v_preview END;
    END IF;
    FOR v_recipient IN SELECT cp.user_id FROM public.conversation_participants cp
      WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id <> NEW.sender_id AND cp.muted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.channel_mutes chm WHERE NEW.channel_id IS NOT NULL AND chm.channel_id = NEW.channel_id AND chm.user_id = cp.user_id)
    LOOP
      PERFORM public.enqueue_message_push(v_recipient.user_id, NULL, v_type, v_title, v_body,
        jsonb_strip_nulls(jsonb_build_object('screen', 'chat', 'chatId', NEW.conversation_id,
          'channelId', CASE WHEN v_is_channel THEN NEW.channel_id END)),
        'msg:' || NEW.conversation_id || ':' || CASE WHEN v_is_channel THEN NEW.channel_id::text ELSE 'main' END,
        'msg:' || NEW.id || ':' || v_recipient.user_id, 0, 'message', NEW.id, NEW.conversation_id, NEW.channel_id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Do not let a message-derived database error reach server logs.
    RAISE WARNING 'handle_message_push failed';
  END;
  RETURN NEW;
END;
$$;

-- Poll rows are content too. Hiding the message without these predicates would
-- leave the question, options, votes, and totals recoverable through modified
-- clients.
DROP POLICY IF EXISTS "polls: participants can read" ON public.polls;
DROP POLICY IF EXISTS "polls: conversation participants can read" ON public.polls;
CREATE POLICY "polls: conversation participants can read"
  ON public.polls FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.messages m
     WHERE m.id = polls.message_id
       AND m.deleted_at IS NULL
       AND m.deletion_kind = 'active'
       AND public.is_conversation_participant(m.conversation_id)
  ));
DROP POLICY IF EXISTS "poll_options: participants can read" ON public.poll_options;
CREATE POLICY "poll_options: participants can read active"
  ON public.poll_options FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.polls p
    JOIN public.messages m ON m.id = p.message_id
     WHERE p.id = poll_options.poll_id
       AND m.deleted_at IS NULL
       AND m.deletion_kind = 'active'
       AND public.is_conversation_participant(m.conversation_id)
  ));
DROP POLICY IF EXISTS "poll_votes: participants can read" ON public.poll_votes;
CREATE POLICY "poll_votes: participants can read active"
  ON public.poll_votes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.polls p
    JOIN public.messages m ON m.id = p.message_id
     WHERE p.id = poll_votes.poll_id
       AND m.deleted_at IS NULL
       AND m.deletion_kind = 'active'
       AND public.is_conversation_participant(m.conversation_id)
  ));

-- ── Secure sender/moderation deletion ───────────────────────────────────────

CREATE OR REPLACE FUNCTION private.message_delete_backoff(p_retry_count integer)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT now() + make_interval(secs => LEAST(3600, 30 * (2 ^ LEAST(GREATEST(p_retry_count, 0), 7))::integer));
$$;

CREATE OR REPLACE FUNCTION public.begin_message_deletion(
  p_message_id uuid,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_message public.messages%ROWTYPE;
  v_conversation public.conversations%ROWTYPE;
  v_operation private.message_deletion_operations%ROWTYPE;
  v_action text;
  v_has_evidence boolean;
  v_path text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_message_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_message FROM public.messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Deliberately no existence oracle for arbitrary direct IDs.
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;
  IF v_message.deleted_at IS NOT NULL OR v_message.deletion_kind <> 'active' THEN
    RETURN jsonb_build_object('state', 'already_deleted');
  END IF;

  SELECT * INTO v_conversation FROM public.conversations WHERE id = v_message.conversation_id;
  IF v_message.sender_id = auth.uid() THEN
    v_action := 'sender_delete';
  ELSIF NOT public.current_student_can_access_app() THEN
    -- A restricted/deletion-pending actor may still remove only their OWN
    -- content for privacy, but cannot use the moderator branch on another
    -- participant's message.
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  ELSIF v_conversation.type IN ('club_group', 'officer_chat') AND public.is_club_officer(v_conversation.club_id) THEN
    v_action := 'officer_moderation';
  ELSIF v_conversation.type = 'group' AND v_conversation.created_by = auth.uid() THEN
    v_action := 'group_admin_moderation';
  ELSE
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM private.report_message_evidence e WHERE e.source_message_id = v_message.id
  ) INTO v_has_evidence;
  v_path := CASE
    WHEN v_message.attachment_url ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/.+' THEN v_message.attachment_url
    ELSE NULL
  END;

  INSERT INTO private.message_deletion_operations (
    message_id, conversation_id, sender_id, message_created_at, deleted_at,
    actor_id, action_type, attachment_existed, reconciliation_state, purge_status,
    purge_after, audit_correlation_id
  ) VALUES (
    v_message.id, v_message.conversation_id, v_message.sender_id, v_message.created_at, now(),
    auth.uid(), v_action, v_message.attachment_url IS NOT NULL,
    CASE
      WHEN v_message.attachment_url IS NULL THEN 'completed'
      WHEN v_path IS NULL THEN 'reconciliation_required'
      ELSE 'pending_attachment_cleanup'
    END,
    CASE WHEN v_message.attachment_url IS NOT NULL AND v_path IS NULL THEN 'reconciliation_required' ELSE 'scheduled' END,
    now() + interval '365 days', p_idempotency_key
  ) RETURNING * INTO v_operation;

  IF v_path IS NOT NULL THEN
    INSERT INTO private.message_attachment_cleanup_jobs (
      operation_id, original_object_path, report_evidence_id, requires_evidence_copy
    ) VALUES (
      v_operation.id,
      v_path,
      (SELECT e.id FROM private.report_message_evidence e WHERE e.source_message_id = v_message.id ORDER BY e.captured_at ASC LIMIT 1),
      v_has_evidence
    );
  END IF;

  -- The canonical row is scrubbed inside the same transaction as the operation
  -- record. No worker or Storage failure can restore ordinary visibility.
  DELETE FROM public.polls WHERE message_id = v_message.id;
  UPDATE public.messages
     SET content = NULL,
         attachment_url = NULL,
         attachment_name = NULL,
         attachment_size = NULL,
         attachment_mime = NULL,
         shared_post_id = NULL,
         shared_event_id = NULL,
         deleted_at = now(),
         deleted_by = auth.uid(),
         deletion_kind = CASE v_action
           WHEN 'sender_delete' THEN 'sender_deleted'
           WHEN 'officer_moderation' THEN 'officer_removed'
           ELSE 'group_admin_removed'
         END,
         deletion_correlation_id = p_idempotency_key,
         updated_at = now()
   WHERE id = v_message.id;

  -- A queued push is the one remaining notification surface that can contain a
  -- body preview. Linked rows are suppressed before a dispatcher can claim them.
  UPDATE public.push_queue
     SET source_message_id = v_message.id,
         status = 'suppressed', body = NULL, route = '{}'::jsonb
   WHERE (source_message_id = v_message.id
          OR (source_message_id IS NULL AND dedupe_key LIKE ('msg:' || v_message.id::text || ':%')))
     AND status IN ('pending', 'processing');

  RETURN jsonb_build_object(
    'state', CASE WHEN v_message.attachment_url IS NULL THEN 'deleted' ELSE 'deletion_pending_attachment_cleanup' END
  );
END;
$$;

-- Existing clients call this legacy RPC. Keep its signature so old builds get
-- immediate privacy, while new clients use the Edge Function to perform the
-- physical object deletion synchronously.
CREATE OR REPLACE FUNCTION public.unsend_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.begin_message_deletion(p_message_id, extensions.gen_random_uuid());
END;
$$;

REVOKE ALL ON FUNCTION private.message_delete_backoff(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_message_deletion(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unsend_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_message_deletion(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unsend_message(uuid) TO authenticated;

-- ── Report capture: never make evidence after a deletion ─────────────────────

CREATE OR REPLACE FUNCTION public.report_message(
  p_message_id uuid,
  p_reason text,
  p_details text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_msg record;
  v_conv record;
  v_reporter record;
  v_report_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.current_student_can_access_app() THEN RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501'; END IF;
  SELECT m.*, p.question AS poll_question INTO v_msg
    FROM public.messages m
    LEFT JOIN public.polls p ON p.message_id = m.id
   WHERE m.id = p_message_id
     AND m.deleted_at IS NULL
     AND m.deletion_kind = 'active'
   FOR UPDATE OF m;
  IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.is_conversation_participant(v_msg.conversation_id) THEN RAISE EXCEPTION 'not_a_participant' USING ERRCODE = '42501'; END IF;
  IF v_msg.sender_id = auth.uid() THEN RAISE EXCEPTION 'cannot_report_own' USING ERRCODE = '42501'; END IF;

  SELECT type, club_id INTO v_conv FROM public.conversations WHERE id = v_msg.conversation_id;
  SELECT username, id INTO v_reporter FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.reports (
    reporter_id, reporter_username, entity_type, entity_id, club_id, reason, details, status,
    message_id, conversation_id, conversation_type, message_type, message_sender_id,
    content_snapshot, attachment_snapshot
  ) VALUES (
    auth.uid(), v_reporter.username, 'message', p_message_id, v_conv.club_id, p_reason, p_details, 'pending',
    p_message_id, v_msg.conversation_id, v_conv.type, v_msg.message_type, v_msg.sender_id,
    NULL, NULL
  ) RETURNING id INTO v_report_id;

  INSERT INTO private.report_message_evidence (
    report_id, source_message_id, content_snapshot, attachment_name,
    attachment_size, attachment_mime, source_attachment_path, attachment_state
  ) VALUES (
    v_report_id, v_msg.id, COALESCE(v_msg.content, v_msg.poll_question), v_msg.attachment_name,
    v_msg.attachment_size, v_msg.attachment_mime,
    CASE WHEN v_msg.attachment_url ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/.+' THEN v_msg.attachment_url ELSE NULL END,
    CASE WHEN v_msg.attachment_url IS NULL THEN 'none'
         WHEN v_msg.attachment_url ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/.+' THEN 'source_pending'
         ELSE 'unavailable' END
  );
  RETURN v_report_id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_message(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_message(uuid, text, text) TO authenticated;

-- Preserve the existing bounded search contract, but make the newly explicit
-- state machine part of the server-side predicate as well. Client filtering is
-- never trusted for deleted content.
CREATE OR REPLACE FUNCTION public.search_message_content(
  p_query text, p_conversation_id uuid DEFAULT NULL, p_limit integer DEFAULT 30
)
RETURNS TABLE (message_id uuid, conversation_id uuid, channel_id uuid, content text, message_type text, created_at timestamptz, sender_id uuid, username text, full_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_me uuid := (SELECT auth.uid()); v_raw text := btrim(COALESCE(p_query, '')); v_query text := public.safe_like_fragment(p_query);
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT public.current_student_can_access_app() OR length(v_raw) < 3 OR v_query = '' THEN RETURN; END IF;
  RETURN QUERY
  SELECT m.id, m.conversation_id, m.channel_id, m.content, m.message_type, m.created_at, m.sender_id, p.username, p.full_name
    FROM public.messages m LEFT JOIN public.profiles p ON p.id = m.sender_id
   WHERE m.deleted_at IS NULL AND m.deletion_kind = 'active'
     AND public.is_conversation_participant(m.conversation_id)
     AND (p_conversation_id IS NULL OR m.conversation_id = p_conversation_id)
     AND m.content ILIKE '%' || v_query || '%' ESCAPE '\'
   ORDER BY m.created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 50));
END;
$$;
REVOKE ALL ON FUNCTION public.search_message_content(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_message_content(text, uuid, integer) TO authenticated;

-- ── Retention transitions ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.set_report_evidence_retention_from_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE private.report_message_evidence e
     SET terminal_decision_at = NEW.created_at,
         retention_expires_at = NEW.created_at + CASE
           WHEN NEW.new_status = 'dismissed' OR NEW.enforcement_action = 'none' THEN interval '30 days'
           ELSE interval '180 days'
         END,
         retention_basis = CASE
           WHEN NEW.new_status = 'dismissed' OR NEW.enforcement_action = 'none' THEN 'terminal_30_days'
           ELSE 'enforcement_180_days'
         END,
         updated_at = now()
   WHERE e.report_id = NEW.report_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_report_evidence_retention_decision ON public.report_decision_history;
CREATE TRIGGER trg_report_evidence_retention_decision
  AFTER INSERT ON public.report_decision_history
  FOR EACH ROW EXECUTE FUNCTION private.set_report_evidence_retention_from_decision();

CREATE OR REPLACE FUNCTION private.set_report_evidence_retention_from_appeal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE private.report_message_evidence e
     SET retention_expires_at = CASE
       WHEN NEW.status = 'active' THEN NULL
       ELSE NEW.resolved_at + interval '90 days'
     END,
         retention_basis = CASE WHEN NEW.status = 'active' THEN 'appeal_active' ELSE 'appeal_90_days' END,
         updated_at = now()
   WHERE e.report_id = NEW.report_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_report_evidence_retention_appeal ON private.report_evidence_appeals;
CREATE TRIGGER trg_report_evidence_retention_appeal
  AFTER INSERT OR UPDATE OF status, resolved_at ON private.report_evidence_appeals
  FOR EACH ROW EXECUTE FUNCTION private.set_report_evidence_retention_from_appeal();

-- Founder-only server actions call these service-role RPCs only after the Day
-- 10D private gateway, AAL2, and recent-MFA checks. The durable audit insert is
-- in the same transaction as the hold mutation.
CREATE OR REPLACE FUNCTION public.admin_tx_apply_report_evidence_hold(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_report_id uuid, p_hold_type text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 OR p_hold_type NOT IN ('legal', 'safety') THEN
    RAISE EXCEPTION 'invalid_hold_input' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.report_message_evidence WHERE report_id = p_report_id) THEN
    RAISE EXCEPTION 'evidence_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO private.report_evidence_holds (report_id, hold_type, internal_reason, applied_by, correlation_id)
  VALUES (p_report_id, p_hold_type, btrim(p_reason), p_actor_id, p_correlation_id)
  RETURNING id INTO v_id;
  PERFORM public.admin_audit_log(
    p_actor_id, p_actor_email, 'report.evidenceHoldApply', 'report', p_report_id,
    btrim(p_reason), NULL, NULL, jsonb_build_object('reportId', p_report_id, 'holdType', p_hold_type),
    true, NULL, p_correlation_id, 'success'
  );
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_release_report_evidence_hold(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_hold_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_report_id uuid;
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'invalid_release_reason' USING ERRCODE = '22023'; END IF;
  UPDATE private.report_evidence_holds
     SET released_by = p_actor_id, released_at = now(), release_reason = btrim(p_reason)
   WHERE id = p_hold_id AND released_at IS NULL
   RETURNING report_id INTO v_report_id;
  IF v_report_id IS NULL THEN RAISE EXCEPTION 'active_hold_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.admin_audit_log(
    p_actor_id, p_actor_email, 'report.evidenceHoldRelease', 'report', v_report_id,
    btrim(p_reason), NULL, NULL, jsonb_build_object('holdId', p_hold_id),
    true, NULL, p_correlation_id, 'success'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_set_report_evidence_appeal(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_report_id uuid, p_status text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 500 OR p_status NOT IN ('active', 'resolved') THEN
    RAISE EXCEPTION 'invalid_appeal_input' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'active' THEN
    INSERT INTO private.report_evidence_appeals (report_id, status, internal_note, correlation_id)
    VALUES (p_report_id, 'active', btrim(p_reason), p_correlation_id) RETURNING id INTO v_id;
  ELSE
    UPDATE private.report_evidence_appeals
       SET status = 'resolved', resolved_at = now(), resolved_by = p_actor_id, internal_note = btrim(p_reason), correlation_id = p_correlation_id
     WHERE report_id = p_report_id AND status = 'active'
     RETURNING id INTO v_id;
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'appeal_transition_invalid' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.admin_audit_log(
    p_actor_id, p_actor_email, 'report.evidenceAppeal', 'report', p_report_id,
    btrim(p_reason), NULL, NULL, jsonb_build_object('reportId', p_report_id, 'status', p_status),
    true, NULL, p_correlation_id, 'success'
  );
  RETURN v_id;
END;
$$;

-- A sensitive evidence read must be recorded before a server loader can return
-- any content. This function returns no evidence and is service-role only.
CREATE OR REPLACE FUNCTION public.admin_record_report_evidence_view(
  p_actor_id uuid, p_actor_email text, p_report_id uuid, p_correlation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.report_message_evidence WHERE report_id = p_report_id) THEN RETURN false; END IF;
  PERFORM public.admin_audit_log(
    p_actor_id, p_actor_email, 'report.viewEvidence', 'report', p_report_id,
    'Founder evidence review', NULL, NULL, jsonb_build_object('reportId', p_report_id),
    true, NULL, p_correlation_id, 'success'
  );
  RETURN true;
END;
$$;

INSERT INTO public.admin_audit_actions (action, target_type, sensitivity, requires_reason, description) VALUES
  ('report.evidenceHoldApply', 'report', 'destructive', true, 'Apply a private legal or safety hold to retained report evidence.'),
  ('report.evidenceHoldRelease', 'report', 'sensitive', true, 'Release a private legal or safety hold from retained report evidence.'),
  ('report.evidenceAppeal', 'report', 'sensitive', true, 'Record an evidence-retention appeal state.'),
  ('message.delete', 'message', 'sensitive', false, 'Record sanitized message deletion metadata.'),
  ('message.purge', 'message', 'sensitive', false, 'Record automated deleted-message purge metadata.')
ON CONFLICT (action) DO NOTHING;

REVOKE ALL ON FUNCTION private.set_report_evidence_retention_from_decision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.set_report_evidence_retention_from_appeal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tx_apply_report_evidence_hold(uuid, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tx_release_report_evidence_hold(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tx_set_report_evidence_appeal(uuid, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_record_report_evidence_view(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_apply_report_evidence_hold(uuid, text, text, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_tx_release_report_evidence_hold(uuid, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_tx_set_report_evidence_appeal(uuid, text, text, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_record_report_evidence_view(uuid, text, uuid, uuid) TO service_role;

-- ── Server-only attachment cleanup / evidence purge leases ──────────────────

CREATE OR REPLACE FUNCTION public.claim_message_attachment_cleanup_jobs(p_worker_id text, p_limit integer DEFAULT 10)
RETURNS TABLE(job_id uuid, operation_id uuid, original_bucket text, original_object_path text, report_evidence_id uuid, requires_evidence_copy boolean, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT j.id
      FROM private.message_attachment_cleanup_jobs j
     WHERE j.state IN ('pending', 'retry_pending')
       AND j.next_retry_at <= now()
       AND (j.claim_expires_at IS NULL OR j.claim_expires_at < now())
     ORDER BY j.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 25))
  ), claimed AS (
    UPDATE private.message_attachment_cleanup_jobs j
       SET state = 'processing', claimed_by = left(p_worker_id, 120), claim_token = extensions.gen_random_uuid(),
           claim_expires_at = now() + interval '5 minutes', updated_at = now()
      FROM candidates c WHERE j.id = c.id
      RETURNING j.*
  )
  SELECT c.id, c.operation_id, c.original_bucket, c.original_object_path, c.report_evidence_id, c.requires_evidence_copy, c.claim_token
    FROM claimed c;
END;
$$;

-- The interactive endpoint asks for this one operation immediately after the
-- canonical scrub. It uses exactly the same lease as the scheduled worker, so
-- racing request retries or cron executions cannot delete/copy twice.
CREATE OR REPLACE FUNCTION public.claim_message_attachment_cleanup_for_message(p_worker_id text, p_message_id uuid)
RETURNS TABLE(job_id uuid, operation_id uuid, original_bucket text, original_object_path text, report_evidence_id uuid, requires_evidence_copy boolean, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH candidate AS (
    SELECT j.id
      FROM private.message_attachment_cleanup_jobs j
      JOIN private.message_deletion_operations o ON o.id = j.operation_id
     WHERE o.message_id = p_message_id
       AND j.state IN ('pending', 'retry_pending')
       AND j.next_retry_at <= now()
       AND (j.claim_expires_at IS NULL OR j.claim_expires_at < now())
     FOR UPDATE OF j SKIP LOCKED
  ), claimed AS (
    UPDATE private.message_attachment_cleanup_jobs j
       SET state = 'processing', claimed_by = left(p_worker_id, 120), claim_token = extensions.gen_random_uuid(),
           claim_expires_at = now() + interval '5 minutes', updated_at = now()
      FROM candidate c WHERE j.id = c.id
      RETURNING j.*
  )
  SELECT c.id, c.operation_id, c.original_bucket, c.original_object_path, c.report_evidence_id, c.requires_evidence_copy, c.claim_token
    FROM claimed c;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_message_attachment_cleanup(
  p_job_id uuid, p_claim_token uuid, p_retained_attachment_path text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_job private.message_attachment_cleanup_jobs%ROWTYPE;
BEGIN
  IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_job FROM private.message_attachment_cleanup_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.state <> 'processing' OR v_job.claim_token <> p_claim_token OR v_job.claim_expires_at < now() THEN
    RAISE EXCEPTION 'invalid_or_expired_claim' USING ERRCODE = '42501';
  END IF;
  IF v_job.requires_evidence_copy AND (p_retained_attachment_path IS NULL OR p_retained_attachment_path = '') THEN
    RAISE EXCEPTION 'retained_attachment_required' USING ERRCODE = '22023';
  END IF;
  IF v_job.requires_evidence_copy THEN
    UPDATE private.report_message_evidence
       SET source_attachment_path = NULL,
           retained_attachment_bucket = CASE WHEN p_retained_attachment_path IS NULL THEN NULL ELSE 'deleted-message-evidence' END,
           retained_attachment_path = p_retained_attachment_path,
           attachment_state = CASE WHEN p_retained_attachment_path IS NULL THEN 'unavailable' ELSE 'retained' END,
           updated_at = now()
     WHERE source_message_id = (
       SELECT o.message_id FROM private.message_deletion_operations o WHERE o.id = v_job.operation_id
     );
  END IF;
  UPDATE private.message_attachment_cleanup_jobs
     SET state = 'completed', original_object_path = NULL, claimed_by = NULL, claim_token = NULL, claim_expires_at = NULL,
         completed_at = now(), updated_at = now()
   WHERE id = p_job_id;
  UPDATE private.message_deletion_operations
     SET reconciliation_state = 'completed', updated_at = now()
   WHERE id = v_job.operation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_message_attachment_cleanup(
  p_job_id uuid, p_claim_token uuid, p_error_code text, p_retryable boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_job private.message_attachment_cleanup_jobs%ROWTYPE; v_next integer;
BEGIN
  IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_job FROM private.message_attachment_cleanup_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.state <> 'processing' OR v_job.claim_token <> p_claim_token OR v_job.claim_expires_at < now() THEN
    RAISE EXCEPTION 'invalid_or_expired_claim' USING ERRCODE = '42501';
  END IF;
  v_next := v_job.retry_count + 1;
  UPDATE private.message_attachment_cleanup_jobs
     SET retry_count = v_next,
         state = CASE WHEN p_retryable AND v_next < 8 THEN 'retry_pending' ELSE 'reconciliation_required' END,
         next_retry_at = CASE WHEN p_retryable AND v_next < 8 THEN private.message_delete_backoff(v_next) ELSE now() END,
         last_error_code = left(coalesce(nullif(p_error_code, ''), 'storage_operation_failed'), 120),
         claimed_by = NULL, claim_token = NULL, claim_expires_at = NULL, updated_at = now()
   WHERE id = p_job_id;
  UPDATE private.message_deletion_operations
     SET reconciliation_state = CASE WHEN p_retryable AND v_next < 8 THEN 'pending_attachment_cleanup' ELSE 'reconciliation_required' END,
         purge_status = CASE WHEN p_retryable AND v_next < 8 THEN purge_status ELSE 'reconciliation_required' END,
         updated_at = now()
   WHERE id = v_job.operation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_expired_report_message_evidence(p_worker_id text, p_limit integer DEFAULT 10)
RETURNS TABLE(evidence_id uuid, retained_bucket text, retained_object_path text, claim_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT e.id
      FROM private.report_message_evidence e
      JOIN public.reports r ON r.id = e.report_id
     WHERE e.purge_state = 'scheduled'
       AND e.retention_expires_at IS NOT NULL
       AND e.retention_expires_at <= now()
       AND e.next_retry_at <= now()
       AND (e.claim_expires_at IS NULL OR e.claim_expires_at < now())
       AND r.status IN ('resolved', 'dismissed')
       AND NOT EXISTS (SELECT 1 FROM private.report_evidence_holds h WHERE h.report_id = e.report_id AND h.released_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM private.report_evidence_appeals a WHERE a.report_id = e.report_id AND a.status = 'active')
       AND NOT EXISTS (
         SELECT 1 FROM private.message_deletion_operations o
         JOIN private.message_attachment_cleanup_jobs j ON j.operation_id = o.id
          WHERE o.message_id = e.source_message_id AND j.state <> 'completed'
       )
       -- Serialize purges for evidence rows sharing one copied attachment.
       -- Earlier rows delete only their own body; the last row owns physical
       -- object deletion, so another report can never lose retained media.
       AND NOT EXISTS (
         SELECT 1 FROM private.report_message_evidence earlier
          WHERE earlier.source_message_id = e.source_message_id AND earlier.id < e.id
       )
     ORDER BY e.retention_expires_at
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 25))
  ), claimed AS (
    UPDATE private.report_message_evidence e
       SET purge_state = 'processing', claimed_by = left(p_worker_id, 120), claim_token = extensions.gen_random_uuid(),
           claim_expires_at = now() + interval '5 minutes', updated_at = now()
      FROM candidates c WHERE e.id = c.id
      RETURNING e.*
  )
  SELECT e.id,
         CASE WHEN NOT EXISTS (SELECT 1 FROM private.report_message_evidence sibling WHERE sibling.source_message_id = e.source_message_id AND sibling.id <> e.id)
              THEN e.retained_attachment_bucket ELSE NULL END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM private.report_message_evidence sibling WHERE sibling.source_message_id = e.source_message_id AND sibling.id <> e.id)
              THEN e.retained_attachment_path ELSE NULL END,
         e.claim_token
    FROM claimed e;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_report_message_evidence_purge(p_evidence_id uuid, p_claim_token uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_evidence private.report_message_evidence%ROWTYPE;
BEGIN
  IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_evidence FROM private.report_message_evidence WHERE id = p_evidence_id FOR UPDATE;
  IF NOT FOUND OR v_evidence.purge_state <> 'processing' OR v_evidence.claim_token <> p_claim_token OR v_evidence.claim_expires_at < now() THEN
    RAISE EXCEPTION 'invalid_or_expired_claim' USING ERRCODE = '42501';
  END IF;
  DELETE FROM private.report_message_evidence WHERE id = p_evidence_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_report_message_evidence_purge(p_evidence_id uuid, p_claim_token uuid, p_error_code text, p_retryable boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_evidence private.report_message_evidence%ROWTYPE; v_next integer;
BEGIN
  IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_evidence FROM private.report_message_evidence WHERE id = p_evidence_id FOR UPDATE;
  IF NOT FOUND OR v_evidence.purge_state <> 'processing' OR v_evidence.claim_token <> p_claim_token OR v_evidence.claim_expires_at < now() THEN
    RAISE EXCEPTION 'invalid_or_expired_claim' USING ERRCODE = '42501';
  END IF;
  v_next := v_evidence.retry_count + 1;
  UPDATE private.report_message_evidence
     SET retry_count = v_next,
         purge_state = CASE WHEN p_retryable AND v_next < 8 THEN 'scheduled' ELSE 'reconciliation_required' END,
         next_retry_at = CASE WHEN p_retryable AND v_next < 8 THEN private.message_delete_backoff(v_next) ELSE now() END,
         last_error_code = left(coalesce(nullif(p_error_code, ''), 'storage_operation_failed'), 120),
         claimed_by = NULL, claim_token = NULL, claim_expires_at = NULL, updated_at = now()
   WHERE id = p_evidence_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_message_deletion_metadata(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT private.is_service_role_request() THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501'; END IF;
  WITH candidates AS (
    SELECT o.id, o.message_id
      FROM private.message_deletion_operations o
     WHERE o.purge_status = 'scheduled'
       AND o.reconciliation_state = 'completed'
       AND o.purge_after <= now()
       AND NOT EXISTS (SELECT 1 FROM private.message_attachment_cleanup_jobs j WHERE j.operation_id = o.id AND j.state <> 'completed')
       AND NOT EXISTS (SELECT 1 FROM private.report_message_evidence e WHERE e.source_message_id = o.message_id)
     ORDER BY o.purge_after
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  )
  -- The canonical tombstone itself is structural deleted-message metadata. At
  -- the approved 365-day boundary, remove it as well as the private operation
  -- row. No report evidence/hold/reconciliation state may be present here.
  , removed_messages AS (
    DELETE FROM public.messages m USING candidates c WHERE m.id = c.message_id
    RETURNING c.id
  )
  DELETE FROM private.message_deletion_operations o USING candidates c WHERE o.id = c.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── Day 10B compatibility: verified account-deletion retries ───────────────
--
-- 061 made the durable worker reuse private.delete_account_atomic_for().  Its
-- original missing-auth guard was correct for an unknown state, but it also
-- rejected a retry after this same transaction had already removed auth.users.
-- The outbox row below is inserted in that transaction, before auth.users is
-- deleted, and rolls back with every incomplete deletion.  Its immutable,
-- unique idempotency key is therefore sufficient proof of a prior successful
-- deletion without adding a second retention-bearing account record.
--
-- Do not treat a merely missing auth.users row as success: without this exact
-- marker, callers receive an explicit reconciliation failure.  The no-op path
-- creates no audit event, email, notification, job, or data mutation.
CREATE OR REPLACE FUNCTION private.delete_account_atomic_for(
  p_user_id uuid, p_email_kind text, p_case_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_email text;
  v_avatars text[] := ARRAY[]::text[];
  v_posts text[] := ARRAY[]::text[];
  v_club_photos text[] := ARRAY[]::text[];
  v_attachments text[] := ARRAY[]::text[];
  v_case public.account_deletion_cases%ROWTYPE;
  v_completion_key text;
  v_completion_kind text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_completion_key := CASE p_email_kind
    WHEN 'voluntary_deletion_completed' THEN 'voluntary-deletion:' || p_user_id::text
    WHEN 'admin_deletion_finalized' THEN CASE WHEN p_case_id IS NULL THEN NULL ELSE 'deletion-finalized:' || p_case_id::text END
    ELSE NULL
  END;
  v_completion_kind := CASE p_email_kind
    WHEN 'voluntary_deletion_completed' THEN 'voluntary_deletion_completed'
    WHEN 'admin_deletion_finalized' THEN 'admin_deletion_finalized'
    ELSE NULL
  END;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id FOR UPDATE;
  IF v_email IS NULL THEN
    IF v_completion_key IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.transactional_email_outbox o
          WHERE o.kind = v_completion_kind
            AND o.idempotency_key = v_completion_key
       )
       AND (
         p_email_kind <> 'admin_deletion_finalized'
         OR EXISTS (
           SELECT 1
             FROM public.account_deletion_cases c
            WHERE c.id = p_case_id
              AND c.state = 'finalized'
         )
       ) THEN
      RETURN jsonb_build_object(
        'status', 'already_completed',
        'avatars', '[]'::jsonb,
        'posts', '[]'::jsonb,
        'club-photos', '[]'::jsonb,
        'chat-attachments', '[]'::jsonb
      );
    END IF;
    RAISE EXCEPTION 'Account deletion state is incomplete and requires reconciliation'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_case_id IS NOT NULL THEN
    SELECT * INTO v_case
      FROM public.account_deletion_cases
     WHERE id = p_case_id
     FOR UPDATE;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL), ARRAY[]::text[])
    INTO v_avatars
    FROM (
      SELECT public.storage_path_from_public_url(pr.avatar_url, 'avatars') AS p
        FROM public.profiles pr
       WHERE pr.id = p_user_id
         AND pr.avatar_url IS NOT NULL
         AND COALESCE(pr.avatar_type, '') <> 'text'
    ) s;
  SELECT COALESCE(array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL), ARRAY[]::text[])
    INTO v_posts
    FROM (
      SELECT public.storage_path_from_public_url(po.image_url, 'posts') AS p
        FROM public.posts po
       WHERE po.author_id = p_user_id
         AND po.image_url IS NOT NULL
    ) s;
  SELECT COALESCE(array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL), ARRAY[]::text[])
    INTO v_club_photos
    FROM (
      SELECT public.storage_path_from_public_url(cp.url, 'club-photos') AS p
        FROM public.club_photos cp
       WHERE cp.uploaded_by = p_user_id
         AND cp.url IS NOT NULL
    ) s;
  SELECT COALESCE(array_agg(DISTINCT m.attachment_url), ARRAY[]::text[])
    INTO v_attachments
    FROM public.messages m
   WHERE m.sender_id = p_user_id
     AND m.attachment_url IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.conversation_participants cp
        WHERE cp.conversation_id = m.conversation_id
          AND cp.user_id <> p_user_id
     );

  UPDATE public.events
     SET specific_user_ids = array_remove(specific_user_ids, p_user_id)
   WHERE specific_user_ids IS NOT NULL AND p_user_id = ANY (specific_user_ids);
  UPDATE public.notifications
     SET group_actors = array_remove(group_actors, p_user_id),
         group_count = GREATEST(COALESCE(array_length(array_remove(group_actors, p_user_id), 1), 0), 0)
   WHERE group_actors IS NOT NULL AND p_user_id = ANY (group_actors);
  DELETE FROM public.deletion_requests WHERE lower(email) = lower(v_email);
  UPDATE public.reports
     SET reporter_id = NULL, reporter_email = NULL, reporter_username = NULL
   WHERE reporter_id = p_user_id;
  DELETE FROM public.club_officers WHERE user_id = p_user_id;
  DELETE FROM public.chat_invitations WHERE created_by = p_user_id;
  DELETE FROM public.channel_posters WHERE user_id = p_user_id;
  DELETE FROM public.club_photos cp
   WHERE cp.uploaded_by = p_user_id
      OR cp.post_id IN (SELECT id FROM public.posts WHERE author_id = p_user_id);
  DELETE FROM public.messages m
   WHERE m.sender_id = p_user_id
     AND NOT EXISTS (
       SELECT 1
         FROM public.conversation_participants cp
        WHERE cp.conversation_id = m.conversation_id
          AND cp.user_id <> p_user_id
     );
  UPDATE public.messages SET sender_id = NULL WHERE sender_id = p_user_id;
  UPDATE public.messages SET deleted_by = NULL WHERE deleted_by = p_user_id;
  UPDATE public.messages m
     SET shared_post_id = NULL
   WHERE m.shared_post_id IN (SELECT id FROM public.posts WHERE author_id = p_user_id);
  UPDATE public.messages m
     SET shared_event_id = NULL
   WHERE m.shared_event_id IN (SELECT id FROM public.events WHERE created_by = p_user_id);
  UPDATE public.conversations SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE public.conversation_channels SET created_by = NULL WHERE created_by = p_user_id;
  UPDATE public.channel_posters SET added_by = NULL WHERE added_by = p_user_id;

  IF p_email_kind = 'voluntary_deletion_completed' THEN
    SELECT * INTO v_case
      FROM public.account_deletion_cases
     WHERE user_id = p_user_id
       AND state IN ('pending', 'processing')
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;
    UPDATE public.account_deletion_cases
       SET state = 'voluntarily_deleted', finalized_at = now()
     WHERE id = v_case.id;
    UPDATE public.account_deletion_jobs
       SET state = 'cancelled'
     WHERE case_id = v_case.id
       AND state IN ('pending', 'processing', 'retry_pending');
    INSERT INTO public.transactional_email_outbox(kind, recipient_email, payload, idempotency_key, correlation_id)
    VALUES (
      'voluntary_deletion_completed',
      v_email,
      jsonb_build_object('support_email', 'zylvana.arellano.campos@gmail.com'),
      v_completion_key,
      COALESCE(v_case.correlation_id, gen_random_uuid())
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF p_email_kind = 'admin_deletion_finalized' THEN
    UPDATE public.account_deletion_cases
       SET state = 'finalized', finalized_at = now()
     WHERE id = p_case_id;
    INSERT INTO public.transactional_email_outbox(kind, recipient_email, payload, idempotency_key, correlation_id)
    VALUES (
      'admin_deletion_finalized',
      v_email,
      jsonb_build_object(
        'violation_category', private.violation_category_label(v_case.violation_category),
        'public_reason', v_case.public_reason,
        'support_email', 'zylvana.arellano.campos@gmail.com'
      ),
      v_completion_key,
      v_case.correlation_id
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  ELSE
    RAISE EXCEPTION 'invalid account deletion completion kind' USING ERRCODE = '22023';
  END IF;

  DELETE FROM auth.users WHERE id = p_user_id;
  RETURN jsonb_build_object(
    'avatars', to_jsonb(v_avatars),
    'posts', to_jsonb(v_posts),
    'club-photos', to_jsonb(v_club_photos),
    'chat-attachments', to_jsonb(v_attachments)
  );
END;
$$;

-- A stale worker lease can arrive after a committed finalization response was
-- lost. Reconcile that exact verified state to `completed` before auditing or
-- calling the destructive helper again. Any missing-auth state without the
-- immutable completion marker remains an error and is retried/reconciled.
CREATE OR REPLACE FUNCTION public.finalize_claimed_account_deletion(p_worker_id text, p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
  v_case public.account_deletion_cases%ROWTYPE;
  v_paths jsonb;
BEGIN
  SELECT * INTO v_job
    FROM public.account_deletion_jobs
   WHERE id = p_job_id
   FOR UPDATE;
  IF v_job.id IS NULL
     OR v_job.state <> 'processing'
     OR v_job.claimed_by <> p_worker_id
     OR v_job.lease_expires_at < now() THEN
    RAISE EXCEPTION 'job is not held by this worker' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_case
    FROM public.account_deletion_cases
   WHERE id = v_job.case_id
   FOR UPDATE;

  IF v_case.state = 'finalized'
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_case.user_id)
     AND EXISTS (
       SELECT 1
         FROM public.transactional_email_outbox o
        WHERE o.kind = 'admin_deletion_finalized'
          AND o.idempotency_key = 'deletion-finalized:' || v_case.id::text
     ) THEN
    UPDATE public.account_deletion_jobs
       SET state = 'completed',
           completed_at = COALESCE(completed_at, now()),
           lease_expires_at = NULL,
           last_error = NULL
     WHERE id = v_job.id;
    RETURN jsonb_build_object('status', 'already_completed');
  END IF;

  IF v_case.state <> 'pending' THEN
    UPDATE public.account_deletion_jobs
       SET state = 'cancelled', lease_expires_at = NULL
     WHERE id = v_job.id;
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_case.user_id) THEN
    RAISE EXCEPTION 'Account deletion state is incomplete and requires reconciliation'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.account_deletion_cases SET state = 'processing' WHERE id = v_case.id;
  PERFORM private.admin_tx_ok(
    v_case.created_by,
    NULL,
    'deletion.finalize',
    'user',
    v_case.user_id,
    v_case.internal_reason,
    NULL,
    jsonb_build_object('id', v_case.id, 'state', 'finalizing'),
    jsonb_build_object('userId', v_case.user_id),
    v_case.correlation_id
  );
  v_paths := private.delete_account_atomic_for(v_case.user_id, 'admin_deletion_finalized', v_case.id);
  UPDATE public.account_deletion_jobs
     SET state = 'completed', completed_at = now(), lease_expires_at = NULL
   WHERE id = v_job.id;
  RETURN jsonb_build_object('status', 'finalized', 'paths', v_paths);
EXCEPTION WHEN OTHERS THEN
  UPDATE public.account_deletion_jobs
     SET state = CASE WHEN attempts >= 5 THEN 'reconciliation_required' ELSE 'retry_pending' END,
         last_error = left(SQLERRM, 240),
         lease_expires_at = NULL,
         run_at = now() + interval '5 minutes'
   WHERE id = p_job_id;
  UPDATE public.account_deletion_cases
     SET state = CASE
                   WHEN (SELECT attempts FROM public.account_deletion_jobs WHERE id = p_job_id) >= 5
                     THEN 'reconciliation_required'
                   ELSE 'pending'
                 END,
         finalization_error = left(SQLERRM, 240)
   WHERE id = (SELECT case_id FROM public.account_deletion_jobs WHERE id = p_job_id);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_message_attachment_cleanup_jobs(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_message_attachment_cleanup_for_message(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_message_attachment_cleanup(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_message_attachment_cleanup(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_expired_report_message_evidence(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_report_message_evidence_purge(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_report_message_evidence_purge(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_expired_message_deletion_metadata(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_message_attachment_cleanup_jobs(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_message_attachment_cleanup_for_message(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_message_attachment_cleanup(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_message_attachment_cleanup(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_expired_report_message_evidence(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_report_message_evidence_purge(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_report_message_evidence_purge(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_message_deletion_metadata(integer) TO service_role;

COMMIT;

-- Scheduler proposal (not created automatically; deployment needs founder
-- approval): invoke `reconcile-deleted-messages` every 2 minutes through
-- pg_net with `MESSAGE_PRIVACY_WORKER_SECRET` stored in Supabase Vault. The
-- worker's service-role RPC grants and leases make duplicate cron delivery safe.
