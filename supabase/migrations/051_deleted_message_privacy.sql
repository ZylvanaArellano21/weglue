-- ============================================================================
-- 051_deleted_message_privacy.sql
--
-- Deleted-Message Privacy foundation — implements the frozen v9 design
-- (docs/product/deleted-message-privacy.md, baseline commit 26d6fd02).
--
-- THE NON-NEGOTIABLE RULE (§0): once a user deletes a message, We Glue must
-- never again SERVE the original — text, attachment, poll, shared payload — to
-- any ordinary user through queries, Realtime, search, previews, signed URLs,
-- related tables, notifications/pushes, or report records. Retained originals
-- are service-role-only until a future audited founder/admin path exists.
--
-- POLARITY (§0, authoritative): ordinary product queries + RLS REQUIRE
-- `deleted_at IS NULL`. Deleted rows are reachable ONLY via future
-- founder/admin history mechanisms.
--
-- Architecture (§2): Approach B — deletion-scrubbing + server orchestration.
--   • First PostgreSQL transaction makes ordinary DB access fail-closed
--     atomically (redact canonical + snapshot to founder-only history).
--   • Edge Function orchestration performs the physical attachment move that
--     Postgres cannot (Storage + PostgreSQL are NOT atomic).
--   • Two entry points, both secured: the OTA `delete-message` Edge Function
--     and the legacy `unsend_message` RPC.
--
-- SAFETY: this migration is ADDITIVE + policy-tightening only. It creates no
-- destructive data change. The report-evidence backfill copies snapshots into a
-- new private table (idempotent); it does NOT null the reporter-readable
-- `reports.content_snapshot` columns — that destructive step is deferred to the
-- approved backfill phase (§11 / §18). Dual-platform safe: no client contract
-- breaks; old clients calling `unsend_message` still work (managed-attachment
-- messages now get a real `secure_deletion_required` error instead of an
-- insecure delete — §5b / open question §19.3).
-- ============================================================================

-- Tunable operational defaults (§8b). Adjust only with a documented reason.
--   claim lease            : 5 minutes
--   heartbeat interval      : 60 s   (renew when < 2 min remain)
--   per-Storage-op timeout  : 90–120 s (enforced in the Edge worker, not here)
--   automatic retry limit   : 8      (max_retry)
--   max attempt age         : 24 h   (dead-letter threshold)
-- These live as literals inside the functions below with inline references.

-- ============================================================================
-- SECTION 1 — Private retention bucket (§14)
-- ============================================================================
-- Private; no ordinary/participant/officer access, no public URLs, no browser
-- service-role, no ordinary signed-URL generation. Access only via future
-- audited founder/admin operations. No automatic purge in v1.
INSERT INTO storage.buckets (id, name, public)
VALUES ('deleted-message-retention', 'deleted-message-retention', false)
ON CONFLICT (id) DO NOTHING;

-- No storage.objects policy is created for this bucket → RLS default-denies all
-- `authenticated` access. The service role (Edge worker) bypasses RLS. Any
-- future founder/admin read must go through an audited service-role operation.

-- ============================================================================
-- SECTION 2 — Deletion-attempt identity (§5)
-- ============================================================================
CREATE TABLE IF NOT EXISTS message_deletion_attempts (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id                     UUID NOT NULL,               -- no FK: history must survive message hard-delete
  attempt_no                     INT  NOT NULL,
  idempotency_key                TEXT NOT NULL,
  actor_id                       UUID,                        -- deleter (profiles.id); no FK to survive account deletion
  reason                         TEXT,
  entry_point                    TEXT NOT NULL
                                   CHECK (entry_point IN ('edge_function','legacy_rpc','admin')),
  attachment_category            TEXT NOT NULL
                                   CHECK (attachment_category IN ('managed','external','none')),
  state                          TEXT NOT NULL DEFAULT 'pending'
                                   CHECK (state IN (
                                     -- active
                                     'pending','retained','original_removed','redacted',
                                     'failed_requires_reconciliation',
                                     -- terminal
                                     'completed','restored','purged','aborted')),
  -- lease + retry (§8)
  claimed_by                     TEXT,
  claim_token                    UUID,
  claimed_at                     TIMESTAMPTZ,
  claim_expires_at               TIMESTAMPTZ,
  retry_count                    INT NOT NULL DEFAULT 0,
  next_retry_at                  TIMESTAMPTZ,
  last_error                     TEXT,
  last_attempt_at                TIMESTAMPTZ,
  -- dead-letter / manual (§8d)
  requires_manual_reconciliation BOOLEAN NOT NULL DEFAULT false,
  dead_lettered_at               TIMESTAMPTZ,
  dead_letter_reason             TEXT,
  dead_lettered_by               TEXT,
  -- restoration (§10)
  restored_at                    TIMESTAMPTZ,
  restored_by                    TEXT,
  restoration_reason             TEXT,
  restoration_result             TEXT,
  -- lifecycle timestamps
  started_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at                   TIMESTAMPTZ,
  failed_at                      TIMESTAMPTZ,
  failure_reason                 TEXT
);

-- Identity + race guards (§5). attempt_no is computed under the message row
-- lock; these uniques reject a concurrent duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mda_message_attempt
  ON message_deletion_attempts (message_id, attempt_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mda_idempotency_key
  ON message_deletion_attempts (idempotency_key);
-- At most one ACTIVE attempt per message (partial unique over active states).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mda_active_per_message
  ON message_deletion_attempts (message_id)
  WHERE state IN ('pending','retained','original_removed','redacted',
                  'failed_requires_reconciliation');
-- Worker claim scan (§8c).
CREATE INDEX IF NOT EXISTS idx_mda_claimable
  ON message_deletion_attempts (next_retry_at)
  WHERE state IN ('pending','retained','original_removed','failed_requires_reconciliation')
    AND requires_manual_reconciliation = false
    AND dead_lettered_at IS NULL;

ALTER TABLE message_deletion_attempts ENABLE ROW LEVEL SECURITY;
-- Deny-all to authenticated: fully private operational table. Service role only.
-- (No policy = default deny for authenticated/anon; service_role bypasses RLS.)

-- ============================================================================
-- SECTION 3 — Immutable attachment-object mapping (§6)
-- ============================================================================
-- Storage policies and workers use THIS mapping only — never the redacted
-- canonical row — to discover an object path later.
CREATE TABLE IF NOT EXISTS message_attachment_map (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id            UUID NOT NULL REFERENCES message_deletion_attempts(id) ON DELETE CASCADE,
  message_id            UUID NOT NULL,
  storage_provider      TEXT,                 -- 'supabase' | null
  original_bucket       TEXT,
  original_object_path  TEXT,
  retained_bucket       TEXT,
  retained_object_path  TEXT,
  external_url_type     TEXT CHECK (external_url_type IS NULL OR external_url_type IN ('http','file','other')),
  original_url          TEXT,
  size                  BIGINT,
  mime                  TEXT,
  checksum              TEXT,
  copy_status           TEXT NOT NULL DEFAULT 'pending'
                          CHECK (copy_status IN ('pending','copied','verified','failed','not_applicable')),
  copy_verified_at      TIMESTAMPTZ,
  delete_status         TEXT NOT NULL DEFAULT 'pending'
                          CHECK (delete_status IN ('pending','deleted','verified_absent','failed','not_applicable')),
  delete_verified_at    TIMESTAMPTZ,
  mapping_confidence    TEXT NOT NULL DEFAULT 'none'
                          CHECK (mapping_confidence IN ('high','low','none')),
  mapping_error         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mam_attempt ON message_attachment_map (attempt_id);
CREATE INDEX IF NOT EXISTS idx_mam_message ON message_attachment_map (message_id);
-- Deleted-attachment lookup by exact object identity (§6 / is_deleted_attachment).
CREATE INDEX IF NOT EXISTS idx_mam_original_object
  ON message_attachment_map (original_bucket, original_object_path);

ALTER TABLE message_attachment_map ENABLE ROW LEVEL SECURITY;
-- Deny-all to authenticated. Service role only.

-- ============================================================================
-- SECTION 4 — Immutable deleted-message history (founder-only snapshot) (§4b/§10)
-- ============================================================================
-- The retained ORIGINAL of a deleted message: content, attachment metadata,
-- shared refs, and the full poll snapshot (question/options/votes/voters/totals).
-- Insert-only; never served to ordinary users. Restoration re-inserts from here.
CREATE TABLE IF NOT EXISTS deleted_message_history (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id         UUID NOT NULL REFERENCES message_deletion_attempts(id) ON DELETE CASCADE,
  message_id         UUID NOT NULL,
  conversation_id    UUID,
  channel_id         UUID,
  sender_id          UUID,
  message_type       TEXT,
  content            TEXT,
  attachment_url     TEXT,
  attachment_name    TEXT,
  attachment_mime    TEXT,
  attachment_size    BIGINT,
  shared_event_id    UUID,
  shared_post_id     UUID,
  poll_snapshot      JSONB,   -- { question, allow_multiple, start_at, end_at,
                              --   options:[{id,text,display_order}],
                              --   votes:[{option_id,user_id}], totals:{option_id:count} }
  snapshot_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dmh_attempt ON deleted_message_history (attempt_id);
CREATE INDEX IF NOT EXISTS idx_dmh_message ON deleted_message_history (message_id);

ALTER TABLE deleted_message_history ENABLE ROW LEVEL SECURITY;
-- Deny-all to authenticated. Service role only.

-- ============================================================================
-- SECTION 5 — Private data-health diagnostics (§6C)
-- ============================================================================
-- NOT a generic diagnostics platform. Records Category-C unmappable attachments
-- and Category-B file:// notes with TYPED, allowlisted, non-sensitive facts only.
CREATE TABLE IF NOT EXISTS data_health_diagnostics (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  diagnostic_type             TEXT NOT NULL,   -- e.g. 'unmappable_attachment','external_attachment'
  related_entity_type         TEXT,            -- internal-only (deny-by-default table)
  related_entity_id           UUID,            -- internal-only; NEVER exposed to ordinary clients (§6 Change #3)
  severity                    TEXT,
  -- typed facts (preferred over JSON)
  diagnostic_code             TEXT,
  provider_category           TEXT,
  mapping_confidence_category TEXT,
  validation_result_category  TEXT,
  error_classification        TEXT,
  remediation_state           TEXT,
  correlation_id              UUID DEFAULT gen_random_uuid(),  -- attempt-free; no message/path
  safe_metadata               JSONB,           -- server-built from an allowlist only
  status                      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at                 TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dhd_open ON data_health_diagnostics (created_at) WHERE status = 'open';

ALTER TABLE data_health_diagnostics ENABLE ROW LEVEL SECURITY;
-- RLS = deny-all to authenticated (§6C access policy). Service role only.
-- Future founder/admin reads: platform-admin authz + reason-required RPC +
-- audit record + minimal returned fields (not built here).

-- ============================================================================
-- SECTION 6 — One-to-many private report evidence (§11)
-- ============================================================================
CREATE TABLE IF NOT EXISTS report_evidence (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id        UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  evidence_type    TEXT NOT NULL,   -- 'message_content' | 'attachment' | 'poll' | ...
  related_entity_type TEXT,
  related_entity_id   UUID,
  content_snapshot TEXT,
  storage_bucket   TEXT,
  storage_path     TEXT,
  checksum         TEXT,
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_evidence_report ON report_evidence (report_id);

ALTER TABLE report_evidence ENABLE ROW LEVEL SECURITY;
-- Deny-all: reporter / reported-user / officer / participant / ordinary-auth all
-- UNREADABLE. Founder/admin via a future audited RPC. Immutable. Service role only.

-- ============================================================================
-- SECTION 7 — Deleted-state helper functions (SECURITY DEFINER, §12)
-- ============================================================================
-- True iff the canonical message is soft-deleted. SECURITY DEFINER so it sees
-- the true deleted_at regardless of the caller's RLS.
CREATE OR REPLACE FUNCTION is_deleted_message(p_message_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.messages
    WHERE id = p_message_id AND deleted_at IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION is_deleted_message(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_deleted_message(UUID) TO authenticated;

-- SECURITY DEFINER lookup of a message's conversation, bypassing messages RLS,
-- so poll policies can check participation without depending on messages RLS.
CREATE OR REPLACE FUNCTION message_conversation_id(p_message_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT conversation_id FROM public.messages WHERE id = p_message_id;
$$;
REVOKE ALL ON FUNCTION message_conversation_id(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION message_conversation_id(UUID) TO authenticated;

-- True iff the exact Storage object (bucket, path) belongs to a message whose
-- deletion attempt is active or terminal-deleted (i.e. NOT restored/aborted).
-- Uses the immutable attachment mapping only — never the redacted message row.
-- Restored attempts (state='restored') fall through → object readable again.
CREATE OR REPLACE FUNCTION is_deleted_attachment(p_bucket TEXT, p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.message_attachment_map m
    JOIN public.message_deletion_attempts a ON a.id = m.attempt_id
    WHERE m.original_bucket = p_bucket
      AND m.original_object_path = p_path
      AND a.state IN ('pending','retained','original_removed','redacted',
                      'completed','failed_requires_reconciliation','purged')
  );
$$;
REVOKE ALL ON FUNCTION is_deleted_attachment(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_deleted_attachment(TEXT, TEXT) TO authenticated;

-- True iff a poll's underlying message is soft-deleted. SECURITY DEFINER so it
-- bypasses polls/messages RLS — a guard built on an RLS-filtered subquery would
-- fail OPEN (a hidden deleted poll returns NULL → "not deleted"). Used by the
-- poll_votes policies, whose USING keys only on user_id and cannot self-filter.
CREATE OR REPLACE FUNCTION is_deleted_poll(p_poll_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.polls p
    JOIN public.messages m ON m.id = p.message_id
    WHERE p.id = p_poll_id AND m.deleted_at IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION is_deleted_poll(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_deleted_poll(UUID) TO authenticated;

-- Backoff schedule for retryable failures (§8d). Exponential, capped at 30 min.
CREATE OR REPLACE FUNCTION _dmp_backoff(p_retry_count INT)
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT least(make_interval(secs => 30 * power(2, greatest(p_retry_count,0))::int), interval '30 minutes');
$$;
REVOKE ALL ON FUNCTION _dmp_backoff(INT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- SECTION 8 — Message SELECT RLS: require deleted_at IS NULL (§1/§4)
-- ============================================================================
-- Backend RLS is mandatory + sufficient on its own (client filtering is NOT
-- relied upon). Recreate every message SELECT policy with the deleted filter.
DROP POLICY IF EXISTS "messages: participants can read" ON messages;
CREATE POLICY "messages: participants can read"
  ON messages FOR SELECT
  TO authenticated
  USING (deleted_at IS NULL AND is_conversation_participant(conversation_id));

DROP POLICY IF EXISTS "messages: non-member club preview" ON messages;
CREATE POLICY "messages: non-member club preview"
  ON messages FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND NOT is_conversation_participant(conversation_id)
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id AND c.type = 'club_group'
    )
    AND messages.id IN (
      SELECT recent_club_preview_message_ids(messages.conversation_id)
    )
  );

-- ============================================================================
-- SECTION 9 — Poll privacy (§9)
-- ============================================================================
-- Every permissive SELECT policy on the three poll tables AND cast_poll_vote
-- must check deletion state via is_deleted_message() so no participant can
-- read/infer question/options/votes/voters/totals or vote on a deleted poll.
DROP POLICY IF EXISTS "polls: conversation participants can read" ON polls;
CREATE POLICY "polls: conversation participants can read"
  ON polls FOR SELECT TO authenticated
  USING (
    NOT is_deleted_message(polls.message_id)
    AND is_conversation_participant(message_conversation_id(polls.message_id))
  );

DROP POLICY IF EXISTS "poll_options: participants can read" ON poll_options;
CREATE POLICY "poll_options: participants can read"
  ON poll_options FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM polls p
      WHERE p.id = poll_options.poll_id
        AND NOT is_deleted_message(p.message_id)
        AND is_conversation_participant(message_conversation_id(p.message_id))
    )
  );

DROP POLICY IF EXISTS "poll_votes: participants can read" ON poll_votes;
CREATE POLICY "poll_votes: participants can read"
  ON poll_votes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM polls p
      WHERE p.id = poll_votes.poll_id
        AND NOT is_deleted_message(p.message_id)
        AND is_conversation_participant(message_conversation_id(p.message_id))
    )
  );

-- CRITICAL LEAK FIX: migration 010's "poll_votes: users manage own" is a FOR ALL
-- policy keyed only on user_id, so its SELECT arm let a voter still read THEIR
-- OWN vote row on a DELETED poll (leaking that the poll existed + their choice).
-- Recreate it guarded with is_deleted_poll() (SECURITY DEFINER, so the guard
-- cannot fail open). Live-poll vote management is unchanged.
DROP POLICY IF EXISTS "poll_votes: users manage own" ON poll_votes;
CREATE POLICY "poll_votes: users manage own"
  ON poll_votes FOR ALL TO authenticated
  USING (user_id = auth.uid() AND NOT is_deleted_poll(poll_votes.poll_id))
  WITH CHECK (user_id = auth.uid() AND NOT is_deleted_poll(poll_votes.poll_id));

-- Defense in depth: the poll/option "manage" FOR ALL policies (migration 001)
-- self-filter deleted polls today only because their message subquery is
-- RLS-filtered. Recreate them with an explicit is_deleted_message() guard so
-- the poll SENDER/creator (who may be the deleter) cannot read/manage a deleted
-- poll's rows regardless of any future change to messages RLS (§9).
DROP POLICY IF EXISTS "polls: message senders can manage" ON polls;
CREATE POLICY "polls: message senders can manage"
  ON polls FOR ALL TO authenticated
  USING (
    NOT is_deleted_message(polls.message_id)
    AND EXISTS (SELECT 1 FROM messages m WHERE m.id = polls.message_id AND m.sender_id = auth.uid())
  )
  WITH CHECK (
    NOT is_deleted_message(polls.message_id)
    AND EXISTS (SELECT 1 FROM messages m WHERE m.id = polls.message_id AND m.sender_id = auth.uid())
  );

DROP POLICY IF EXISTS "poll_options: poll creator can manage" ON poll_options;
CREATE POLICY "poll_options: poll creator can manage"
  ON poll_options FOR ALL TO authenticated
  USING (
    NOT is_deleted_poll(poll_options.poll_id)
    AND EXISTS (
      SELECT 1 FROM polls p JOIN messages m ON m.id = p.message_id
      WHERE p.id = poll_options.poll_id AND m.sender_id = auth.uid())
  )
  WITH CHECK (
    NOT is_deleted_poll(poll_options.poll_id)
    AND EXISTS (
      SELECT 1 FROM polls p JOIN messages m ON m.id = p.message_id
      WHERE p.id = poll_options.poll_id AND m.sender_id = auth.uid())
  );

-- Voting on a deleted poll is denied (§9). Recreate cast_poll_vote with the
-- deletion guard added; behavior otherwise identical to migration 010.
CREATE OR REPLACE FUNCTION cast_poll_vote(p_poll_id UUID, p_option_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow_multiple BOOLEAN;
  v_start_at       TIMESTAMPTZ;
  v_end_at         TIMESTAMPTZ;
  v_conv_id        UUID;
  v_message_id     UUID;
BEGIN
  SELECT p.allow_multiple, p.start_at, p.end_at, m.conversation_id, m.id
    INTO v_allow_multiple, v_start_at, v_end_at, v_conv_id, v_message_id
  FROM polls p
  JOIN messages m ON m.id = p.message_id
  WHERE p.id = p_poll_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Poll not found' USING ERRCODE = 'P0002';
  END IF;

  -- Deleted-message polls are gone: deny the vote (do not reveal existence).
  IF is_deleted_message(v_message_id) THEN
    RAISE EXCEPTION 'Poll not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT is_conversation_participant(v_conv_id) THEN
    RAISE EXCEPTION 'Not a member of this conversation' USING ERRCODE = '42501';
  END IF;

  IF v_start_at IS NOT NULL AND NOW() < v_start_at THEN
    RAISE EXCEPTION 'Poll has not started yet' USING ERRCODE = 'P0001';
  END IF;

  IF v_end_at IS NOT NULL AND NOW() > v_end_at THEN
    RAISE EXCEPTION 'Poll has ended' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_allow_multiple THEN
    DELETE FROM poll_votes WHERE poll_id = p_poll_id AND user_id = auth.uid();
  END IF;

  IF EXISTS (
    SELECT 1 FROM poll_votes
    WHERE poll_id = p_poll_id AND option_id = p_option_id AND user_id = auth.uid()
  ) THEN
    DELETE FROM poll_votes
    WHERE poll_id = p_poll_id AND option_id = p_option_id AND user_id = auth.uid();
  ELSE
    INSERT INTO poll_votes (poll_id, option_id, user_id)
    VALUES (p_poll_id, p_option_id, auth.uid())
    ON CONFLICT (poll_id, option_id, user_id) DO NOTHING;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION cast_poll_vote(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cast_poll_vote(UUID, UUID) TO authenticated;

-- ============================================================================
-- SECTION 10 — Storage read policy: deny deleted attachments (§6/§7)
-- ============================================================================
-- New signed-URL generation checks the SELECT policy, so this denies new signed
-- URLs for a deleted attachment. Prev-issued signed URLs remain valid until the
-- original object is physically removed (honest semantics, §7).
DROP POLICY IF EXISTS "chat-attachments: participants can read" ON storage.objects;
CREATE POLICY "chat-attachments: participants can read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'chat-attachments'
    AND is_conversation_participant(((storage.foldername(name))[1])::uuid)
    AND NOT is_deleted_attachment('chat-attachments', name)
  );

-- ============================================================================
-- SECTION 11 — Push provenance + cleanup (§10)
-- ============================================================================
ALTER TABLE push_queue
  ADD COLUMN IF NOT EXISTS source_type          TEXT,
  ADD COLUMN IF NOT EXISTS source_message_id    UUID,
  ADD COLUMN IF NOT EXISTS source_conversation_id UUID,
  ADD COLUMN IF NOT EXISTS source_channel_id    UUID,
  ADD COLUMN IF NOT EXISTS source_event_id      UUID;

CREATE INDEX IF NOT EXISTS idx_push_queue_source_message
  ON push_queue (source_message_id);
CREATE INDEX IF NOT EXISTS idx_push_queue_source_type_message
  ON push_queue (source_type, source_message_id);
CREATE INDEX IF NOT EXISTS idx_push_queue_source_message_pending
  ON push_queue (source_message_id) WHERE status = 'pending';

-- enqueue_push gains nullable structured provenance appended at the end, so all
-- existing 6–9-arg call sites still resolve via defaults. DROP + CREATE because
-- the signature changes (CREATE OR REPLACE cannot alter the arg list).
DROP FUNCTION IF EXISTS enqueue_push(UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, INT);
CREATE OR REPLACE FUNCTION enqueue_push(
  p_user            UUID,
  p_notification_id UUID,
  p_type            TEXT,
  p_title           TEXT,
  p_body            TEXT,
  p_route           JSONB,
  p_collapse_key    TEXT DEFAULT NULL,
  p_dedupe_key      TEXT DEFAULT NULL,
  p_min_gap_minutes INT  DEFAULT 0,
  -- structured provenance (§10)
  p_source_type            TEXT DEFAULT NULL,
  p_source_message_id      UUID DEFAULT NULL,
  p_source_conversation_id UUID DEFAULT NULL,
  p_source_channel_id      UUID DEFAULT NULL,
  p_source_event_id        UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg       notification_types%ROWTYPE;
  v_cap       INT;
  v_sent_hour INT;
BEGIN
  SELECT * INTO v_reg FROM notification_types WHERE type = p_type;
  IF NOT FOUND OR NOT v_reg.enabled OR NOT v_reg.push THEN RETURN; END IF;
  IF NOT user_wants_push(p_user, v_reg.category) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM push_tokens WHERE user_id = p_user AND status = 'active') THEN
    RETURN;
  END IF;

  v_cap := COALESCE((
    SELECT (value ->> v_reg.category)::INT FROM notification_config WHERE key = 'push.hourly_caps'
  ), 30);
  IF v_cap <= 0 THEN RETURN; END IF;
  SELECT count(*) INTO v_sent_hour
  FROM push_queue
  WHERE user_id = p_user AND category = v_reg.category
    AND created_at > now() - interval '1 hour'
    AND status IN ('pending','processing','sent');
  IF v_sent_hour >= v_cap THEN RETURN; END IF;

  IF p_collapse_key IS NOT NULL AND p_min_gap_minutes > 0 AND EXISTS (
    SELECT 1 FROM push_queue
    WHERE user_id = p_user AND collapse_key = p_collapse_key
      AND status = 'sent' AND sent_at > now() - make_interval(mins => p_min_gap_minutes)
  ) THEN
    RETURN;
  END IF;

  -- Burst replacement: preserve structured provenance on the absorbed row (§10).
  IF p_collapse_key IS NOT NULL THEN
    UPDATE push_queue
    SET title = p_title, body = p_body, route = p_route,
        notification_id = COALESCE(p_notification_id, notification_id),
        source_type = COALESCE(p_source_type, source_type),
        source_message_id = COALESCE(p_source_message_id, source_message_id),
        source_conversation_id = COALESCE(p_source_conversation_id, source_conversation_id),
        source_channel_id = COALESCE(p_source_channel_id, source_channel_id),
        source_event_id = COALESCE(p_source_event_id, source_event_id),
        created_at = now()
    WHERE user_id = p_user AND collapse_key = p_collapse_key AND status = 'pending';
    IF FOUND THEN RETURN; END IF;
  END IF;

  INSERT INTO push_queue (
    user_id, notification_id, category, title, body, route, collapse_key, dedupe_key,
    source_type, source_message_id, source_conversation_id, source_channel_id, source_event_id
  )
  VALUES (p_user, p_notification_id, v_reg.category, p_title, p_body,
          COALESCE(p_route, '{}'::jsonb), p_collapse_key, p_dedupe_key,
          p_source_type, p_source_message_id, p_source_conversation_id,
          p_source_channel_id, p_source_event_id)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION enqueue_push(UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, INT, TEXT, UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- handle_message_push now stamps structured provenance so deletion cleanup does
-- not rely on parsing dedupe_key. Body still derives from NEW.content (redacted
-- on delete), and the AFTER-INSERT early-out on NEW.deleted_at prevents a push
-- for an already-deleted message.
CREATE OR REPLACE FUNCTION handle_message_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv       conversations%ROWTYPE;
  v_sender     TEXT;
  v_channel    TEXT;
  v_is_channel BOOLEAN := false;
  v_club       TEXT;
  v_preview    TEXT;
  v_title      TEXT;
  v_body       TEXT;
  v_type       TEXT;
  v_recipient  RECORD;
BEGIN
  BEGIN
    IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

    SELECT * INTO v_conv FROM conversations WHERE id = NEW.conversation_id;
    IF NOT FOUND OR v_conv.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

    SELECT COALESCE(NULLIF(full_name, ''), username) INTO v_sender
    FROM profiles WHERE id = NEW.sender_id;
    v_sender := COALESCE(v_sender, 'Someone');

    v_preview := CASE
      WHEN NEW.message_type = 'image'        THEN COALESCE(NULLIF(NEW.content, ''), '📷 Photo')
      WHEN NEW.message_type = 'video'        THEN COALESCE(NULLIF(NEW.content, ''), '🎬 Video')
      WHEN NEW.message_type = 'file'         THEN COALESCE(NULLIF(NEW.content, ''), '📎 File')
      WHEN NEW.message_type = 'poll'         THEN '📊 Started a poll'
      WHEN NEW.message_type = 'shared_event' THEN '📅 Shared an event'
      WHEN NEW.message_type = 'shared_post'  THEN '🖼️ Shared a post'
      ELSE COALESCE(NEW.content, 'New message')
    END;
    v_preview := left(v_preview, 140);

    IF v_conv.type = 'direct' THEN
      v_type  := 'dm_message';
      v_title := v_sender;
      v_body  := v_preview;
    ELSIF v_conv.type = 'group' THEN
      v_type  := 'group_message';
      v_title := COALESCE(v_conv.name, 'Group chat');
      v_body  := v_sender || ': ' || v_preview;
    ELSE
      v_type := 'club_chat_message';
      SELECT name INTO v_club FROM clubs WHERE id = v_conv.club_id;
      IF NEW.channel_id IS NOT NULL THEN
        SELECT CASE WHEN ch.kind = 'channel' THEN ch.name END,
               ch.kind = 'channel'
          INTO v_channel, v_is_channel
        FROM conversation_channels ch WHERE ch.id = NEW.channel_id;
      END IF;
      v_title := COALESCE(v_club, 'Club chat') ||
                 CASE WHEN v_conv.type = 'officer_chat' THEN ' Officers' ELSE '' END;
      v_body := CASE
        WHEN v_channel IS NOT NULL
          THEN '#' || ltrim(v_channel, '#') || ' · ' || v_sender || ': ' || v_preview
        ELSE v_sender || ': ' || v_preview
      END;
    END IF;

    FOR v_recipient IN
      SELECT cp.user_id
      FROM conversation_participants cp
      WHERE cp.conversation_id = NEW.conversation_id
        AND cp.user_id <> NEW.sender_id
        AND cp.muted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM channel_mutes chm
          WHERE NEW.channel_id IS NOT NULL
            AND chm.channel_id = NEW.channel_id AND chm.user_id = cp.user_id
        )
    LOOP
      PERFORM enqueue_push(
        v_recipient.user_id,
        NULL,
        v_type,
        v_title,
        v_body,
        jsonb_strip_nulls(jsonb_build_object(
          'screen', 'chat',
          'chatId', NEW.conversation_id,
          'channelId', CASE WHEN v_is_channel THEN NEW.channel_id END
        )),
        'msg:' || NEW.conversation_id || ':' ||
          CASE WHEN v_is_channel THEN NEW.channel_id::text ELSE 'main' END,
        'msg:' || NEW.id || ':' || v_recipient.user_id,
        0,
        -- structured provenance (§10)
        'message',
        NEW.id,
        NEW.conversation_id,
        NEW.channel_id,
        NULL
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_message_push failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Scrub every pending push tied to a deleted message. Primary match is the
-- structured source_message_id; a VERIFIED dedupe_key format ('msg:{id}:{user}')
-- is the only fallback — never scrub on an ambiguous match (§10).
CREATE OR REPLACE FUNCTION scrub_message_pushes(p_message_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE push_queue
  SET status = 'suppressed',
      title = NULL,
      body = NULL,
      route = '{}'::jsonb,
      error = 'source message deleted'
  WHERE status = 'pending'
    AND (
      source_message_id = p_message_id
      OR (source_message_id IS NULL
          AND dedupe_key LIKE ('msg:' || p_message_id::text || ':%'))
    );
END;
$$;
REVOKE ALL ON FUNCTION scrub_message_pushes(UUID) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- SECTION 12 — Attachment classification (§6, internal)
-- ============================================================================
-- Returns { category, provider, bucket, path, external_url_type, original_url,
--           size, mime, confidence, error } for a message. Never raises.
-- Category A managed  : message_type in (image,video,file) AND attachment_url is
--                       a bare storage path -> chat-attachments/{path}.
--        B external    : file:// or non-We-Glue http(s) URL, or type text/poll/
--                       shared_* (nothing managed to move).
--        C unmappable  : looks managed (attachment type) but URL missing or
--                       unparseable -> confidence none (preflight failure).
CREATE OR REPLACE FUNCTION classify_message_attachment(p_message_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_msg  RECORD;
  v_url  TEXT;
  v_seg1 TEXT;
BEGIN
  SELECT message_type, attachment_url, attachment_name, attachment_mime, attachment_size
    INTO v_msg
  FROM messages WHERE id = p_message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('category','none','confidence','none','error','message_not_found');
  END IF;

  -- Non-attachment message types: nothing managed to move.
  IF v_msg.message_type NOT IN ('image','video','file') THEN
    RETURN jsonb_build_object('category','none','confidence','high');
  END IF;

  v_url := v_msg.attachment_url;

  -- Attachment type but no URL -> unmappable (Category C).
  IF v_url IS NULL OR length(trim(v_url)) = 0 THEN
    RETURN jsonb_build_object('category','unmappable','confidence','none','error','missing_attachment_url');
  END IF;

  -- Device-local file:// -> external (Category B).
  IF v_url LIKE 'file://%' THEN
    RETURN jsonb_build_object('category','external','confidence','high',
      'external_url_type','file','original_url', v_url,
      'size', v_msg.attachment_size, 'mime', v_msg.attachment_mime);
  END IF;

  -- http(s) URL -> external http (Category B). (We store bare paths, never
  -- signed URLs, so any http(s) here is a non-managed/foreign reference.)
  IF v_url LIKE 'http://%' OR v_url LIKE 'https://%' THEN
    RETURN jsonb_build_object('category','external','confidence','high',
      'external_url_type','http','original_url', v_url,
      'size', v_msg.attachment_size, 'mime', v_msg.attachment_mime);
  END IF;

  -- Bare storage path in chat-attachments: expect '{conversation_uuid}/{name}'.
  v_seg1 := split_part(v_url, '/', 1);
  IF v_seg1 IS NULL OR v_seg1 = '' OR position('/' in v_url) = 0 THEN
    RETURN jsonb_build_object('category','unmappable','confidence','none','error','unparseable_object_path');
  END IF;
  -- First segment must be a UUID (the conversation id), matching the upload
  -- layout <conversation_id>/<random>.<ext>.
  IF v_seg1 !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN jsonb_build_object('category','unmappable','confidence','none','error','unexpected_object_layout');
  END IF;

  RETURN jsonb_build_object(
    'category','managed','confidence','high',
    'provider','supabase','bucket','chat-attachments','path', v_url,
    'size', v_msg.attachment_size, 'mime', v_msg.attachment_mime);
END;
$$;
REVOKE ALL ON FUNCTION classify_message_attachment(UUID) FROM PUBLIC, anon, authenticated;

-- Server-built Category-C diagnostic from an allowlist only (§6C). No message
-- id/path/content ever enters safe_metadata. related_entity_id is stored
-- internally (deny-by-default table) and never returned to ordinary clients.
CREATE OR REPLACE FUNCTION record_unmappable_attachment_diagnostic(
  p_message_id UUID,
  p_error_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO data_health_diagnostics (
    diagnostic_type, related_entity_type, related_entity_id, severity,
    diagnostic_code, provider_category, mapping_confidence_category,
    validation_result_category, error_classification, remediation_state,
    safe_metadata, status)
  VALUES (
    'unmappable_attachment', 'message', p_message_id, 'high',
    p_error_code, 'supabase', 'none',
    'failed', 'attachment_mapping', 'needs_manual_review',
    jsonb_build_object('diagnostic_code', p_error_code), 'open');
END;
$$;
REVOKE ALL ON FUNCTION record_unmappable_attachment_diagnostic(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- SECTION 13 — Preflight authorization + classification (§4a)
-- ============================================================================
-- Runs BEFORE any attempt exists. Verifies authorization (§3) exactly as the
-- legacy unsend_message did, classifies the attachment, and validates the
-- source object. On any failure it creates NO attempt/history/redaction and
-- returns a real error (optionally a safe Category-C diagnostic). Identical
-- error responses regardless of message existence (§6 Change #3): callers see
-- 'not_found_or_not_authorized' whether the message is missing or foreign.
CREATE OR REPLACE FUNCTION preflight_message_deletion(
  p_message_id UUID,
  p_actor_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg    RECORD;
  v_conv   RECORD;
  v_class  JSONB;
  v_cat    TEXT;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT m.id, m.sender_id, m.conversation_id, m.deleted_at
    INTO v_msg
  FROM messages m WHERE m.id = p_message_id;

  -- Non-existent message: opaque, existence-preserving error (§6 Change #3).
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found_or_not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Already securely deleted -> idempotent signal (no new attempt here).
  IF v_msg.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','already_deleted','message_id', p_message_id);
  END IF;

  SELECT c.type, c.club_id, c.created_by INTO v_conv
  FROM conversations c WHERE c.id = v_msg.conversation_id;

  -- Authorization (§3) — identical to unsend_message (040:173-181), but the
  -- officer check is actor-parameterized: is_club_officer() reads auth.uid(),
  -- which is NULL when the Edge Function calls this as service_role with
  -- identity supplied via p_actor_id. Inline the same semantics
  -- (officer = club_members.role='officer', per is_club_officer / CLAUDE.md).
  IF NOT (
        v_msg.sender_id = p_actor_id
     OR (v_conv.type IN ('club_group','officer_chat')
         AND EXISTS (SELECT 1 FROM club_members
                     WHERE club_id = v_conv.club_id AND user_id = p_actor_id AND role = 'officer'))
     OR (v_conv.type = 'group' AND v_conv.created_by = p_actor_id)
  ) THEN
    RAISE EXCEPTION 'not_found_or_not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Classify the attachment.
  v_class := classify_message_attachment(p_message_id);
  v_cat := v_class->>'category';

  -- Category C (unmappable): preflight failure. A diagnostic is NOT written here
  -- because RAISE rolls back this transaction (the insert would vanish). The
  -- orchestrating entry point records the safe diagnostic in a SEPARATE call
  -- after catching this error (delete-message Edge Function). The RETURN'd error
  -- code tells it which diagnostic to record.
  IF v_cat = 'unmappable' THEN
    RAISE EXCEPTION 'attachment_unmappable' USING ERRCODE = 'P0001';
  END IF;

  -- Managed: confirm the source object exists where the mapping requires (§4a).
  IF v_cat = 'managed' THEN
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = (v_class->>'bucket') AND name = (v_class->>'path')
    ) THEN
      -- Source missing at preflight -> no attempt (§8e case A). Diagnostic is
      -- recorded by the entry point after catching this error (see above).
      RAISE EXCEPTION 'source_object_missing' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status','ok',
    'message_id', p_message_id,
    'category', v_cat,                       -- 'managed' | 'external' | 'none'
    'classification', v_class);
END;
$$;
REVOKE ALL ON FUNCTION preflight_message_deletion(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- SECTION 14 — First PostgreSQL transaction (§4b, both entry points)
-- ============================================================================
-- Atomic, all-or-nothing. Locks the message, re-confirms authorization + that
-- the attachment is still A/B/none (never C here), computes attempt_no under the
-- lock, inserts the attempt, snapshots to founder history, redacts canonical
-- content, sets deleted_at, scrubs pending pushes, and sets the resulting state
-- (managed -> pending; external/none -> completed). Any failure rolls the whole
-- thing back — never a history-only or redaction-only remnant.
--
-- Idempotency (§5b): callers pass either a real client key (edge_function) or
-- the derived legacy key is computed here (legacy_rpc). Repeated calls do not
-- create duplicate attempts.
CREATE OR REPLACE FUNCTION begin_message_deletion(
  p_message_id     UUID,
  p_actor_id       UUID,
  p_entry_point    TEXT,                 -- 'edge_function' | 'legacy_rpc' | 'admin'
  p_idempotency_key TEXT DEFAULT NULL,   -- required for edge_function; derived for legacy
  p_reason         TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg        RECORD;
  v_conv       RECORD;
  v_class      JSONB;
  v_cat        TEXT;         -- 'managed' | 'external' | 'none'
  v_attempt_no INT;
  v_key        TEXT;
  v_attempt_id UUID;
  v_state      TEXT;
  v_existing   RECORD;
  v_poll       JSONB;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_entry_point NOT IN ('edge_function','legacy_rpc','admin') THEN
    RAISE EXCEPTION 'invalid_entry_point' USING ERRCODE = '22023';
  END IF;
  IF p_entry_point = 'edge_function' AND (p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0) THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = '22023';
  END IF;

  -- 1. Lock the canonical message row.
  SELECT m.id, m.sender_id, m.conversation_id, m.channel_id, m.message_type,
         m.content, m.attachment_url, m.attachment_name, m.attachment_mime,
         m.attachment_size, m.shared_event_id, m.shared_post_id, m.deleted_at
    INTO v_msg
  FROM messages m WHERE m.id = p_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found_or_not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Already securely deleted: idempotent success, no new attempt (§5b rule 3).
  IF v_msg.deleted_at IS NOT NULL THEN
    SELECT id, state INTO v_existing
    FROM message_deletion_attempts
    WHERE message_id = p_message_id
    ORDER BY attempt_no DESC LIMIT 1;
    RETURN jsonb_build_object('status','already_deleted','message_id', p_message_id,
      'attempt_id', v_existing.id, 'state', v_existing.state);
  END IF;

  SELECT c.type, c.club_id, c.created_by INTO v_conv
  FROM conversations c WHERE c.id = v_msg.conversation_id;

  -- Re-confirm authorization under the lock (§4b step 1). Officer check is
  -- actor-parameterized (see preflight_message_deletion for the rationale).
  IF NOT (
        v_msg.sender_id = p_actor_id
     OR (v_conv.type IN ('club_group','officer_chat')
         AND EXISTS (SELECT 1 FROM club_members
                     WHERE club_id = v_conv.club_id AND user_id = p_actor_id AND role = 'officer'))
     OR (v_conv.type = 'group' AND v_conv.created_by = p_actor_id)
     OR p_entry_point = 'admin'
  ) THEN
    RAISE EXCEPTION 'not_found_or_not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Reuse a compatible active attempt if one exists (§5b rule 2 + edge dup).
  SELECT id, state, attachment_category INTO v_existing
  FROM message_deletion_attempts
  WHERE message_id = p_message_id
    AND state IN ('pending','retained','original_removed','redacted','failed_requires_reconciliation')
  ORDER BY attempt_no DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status','existing','message_id', p_message_id,
      'attempt_id', v_existing.id, 'state', v_existing.state,
      'category', v_existing.attachment_category);
  END IF;

  -- Re-classify under the lock (never C here — preflight rejected it).
  v_class := classify_message_attachment(p_message_id);
  v_cat := v_class->>'category';
  IF v_cat = 'unmappable' THEN
    -- Preflight-class evidence discovered inside the txn -> roll back, no attempt.
    RAISE EXCEPTION 'attachment_unmappable' USING ERRCODE = 'P0001';
  END IF;

  -- Legacy managed-attachment deletion is refused (§5b rule 6 / B2). Zero writes.
  IF p_entry_point = 'legacy_rpc' AND v_cat = 'managed' THEN
    RAISE EXCEPTION 'secure_deletion_required' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Compute attempt_no under the lock; derive the legacy key if needed.
  SELECT 1 + COALESCE(max(attempt_no), 0) INTO v_attempt_no
  FROM message_deletion_attempts WHERE message_id = p_message_id;

  v_key := p_idempotency_key;
  IF p_entry_point = 'legacy_rpc' OR v_key IS NULL THEN
    v_key := 'legacy:' || p_message_id::text || ':' || v_attempt_no::text;
  END IF;

  v_state := CASE WHEN v_cat = 'managed' THEN 'pending' ELSE 'completed' END;

  INSERT INTO message_deletion_attempts (
    message_id, attempt_no, idempotency_key, actor_id, reason,
    entry_point, attachment_category, state,
    completed_at)
  VALUES (
    p_message_id, v_attempt_no, v_key, p_actor_id, p_reason,
    p_entry_point, v_cat, v_state,
    CASE WHEN v_state = 'completed' THEN now() ELSE NULL END)
  RETURNING id INTO v_attempt_id;

  -- 3. Snapshot to founder-only history (content + shared refs + poll snapshot).
  IF v_msg.message_type = 'poll' THEN
    SELECT jsonb_build_object(
      'question', p.question,
      'allow_multiple', p.allow_multiple,
      'start_at', p.start_at,
      'end_at', p.end_at,
      'options', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', o.id, 'text', o.option_text,
                                            'display_order', o.display_order)
                         ORDER BY o.display_order)
        FROM poll_options o WHERE o.poll_id = p.id), '[]'::jsonb),
      'votes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('option_id', v.option_id, 'user_id', v.user_id))
        FROM poll_votes v WHERE v.poll_id = p.id), '[]'::jsonb),
      'totals', COALESCE((
        SELECT jsonb_object_agg(t.option_id, t.cnt) FROM (
          SELECT option_id, count(*) AS cnt FROM poll_votes WHERE poll_id = p.id GROUP BY option_id
        ) t), '{}'::jsonb))
      INTO v_poll
    FROM polls p WHERE p.message_id = p_message_id;
  END IF;

  INSERT INTO deleted_message_history (
    attempt_id, message_id, conversation_id, channel_id, sender_id, message_type,
    content, attachment_url, attachment_name, attachment_mime, attachment_size,
    shared_event_id, shared_post_id, poll_snapshot)
  VALUES (
    v_attempt_id, p_message_id, v_msg.conversation_id, v_msg.channel_id, v_msg.sender_id,
    v_msg.message_type, v_msg.content, v_msg.attachment_url, v_msg.attachment_name,
    v_msg.attachment_mime, v_msg.attachment_size, v_msg.shared_event_id,
    v_msg.shared_post_id, v_poll);

  -- Attachment mapping (immutable) — the ONLY later source of the object path.
  IF v_cat = 'managed' THEN
    INSERT INTO message_attachment_map (
      attempt_id, message_id, storage_provider, original_bucket, original_object_path,
      original_url, size, mime, mapping_confidence)
    VALUES (
      v_attempt_id, p_message_id, 'supabase', v_class->>'bucket', v_class->>'path',
      v_msg.attachment_url, v_msg.attachment_size, v_msg.attachment_mime, 'high');
  ELSIF v_cat = 'external' THEN
    INSERT INTO message_attachment_map (
      attempt_id, message_id, storage_provider, external_url_type, original_url,
      size, mime, mapping_confidence, copy_status, delete_status)
    VALUES (
      v_attempt_id, p_message_id, NULL, v_class->>'external_url_type', v_class->>'original_url',
      v_msg.attachment_size, v_msg.attachment_mime, 'high', 'not_applicable', 'not_applicable');
    -- Category-B data-health note: we cannot delete an external/device-local file.
    PERFORM record_unmappable_attachment_diagnostic(p_message_id, 'external_attachment_not_deletable');
  END IF;

  -- 4. Redact canonical content-bearing fields (null all §2 content cols).
  --    Poll rows are unlinked below via deletion state (RLS hides them); the
  --    poll snapshot is preserved in history for restoration.
  UPDATE messages
  SET content = NULL,
      attachment_url = NULL,
      attachment_name = NULL,
      attachment_mime = NULL,
      attachment_size = NULL,
      shared_event_id = NULL,
      shared_post_id = NULL,
      -- 5. deleted_at / deleted_by
      deleted_at = now(),
      deleted_by = p_actor_id
  WHERE id = p_message_id;

  -- Push cleanup: scrub pending pushes for this message (§10).
  PERFORM scrub_message_pushes(p_message_id);

  RETURN jsonb_build_object(
    'status','started',
    'message_id', p_message_id,
    'attempt_id', v_attempt_id,
    'attempt_no', v_attempt_no,
    'idempotency_key', v_key,
    'category', v_cat,
    'state', v_state);
END;
$$;
REVOKE ALL ON FUNCTION begin_message_deletion(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- SECTION 15 — Legacy unsend_message (§5b) — secure replacement
-- ============================================================================
-- Old clients call this directly with only a message id. It preflights, and:
--   • no-managed-attachment (external/none) -> snapshot + redact (completed)
--   • managed We Glue Storage attachment    -> raises secure_deletion_required
--     with ZERO database/Storage/push/poll/history changes (§5b rule 6 / B2)
-- Idempotent: a repeat call on an already-deleted message returns cleanly.
-- Restore-then-delete-again creates a new attempt (next attempt_no).
CREATE OR REPLACE FUNCTION unsend_message(p_message_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  -- Preflight raises on unauthorized / unmappable / missing-source; returns
  -- 'already_deleted' when the message is already gone (idempotent no-op).
  BEGIN
    v_result := preflight_message_deletion(p_message_id, auth.uid());
  EXCEPTION
    WHEN OTHERS THEN
      -- Preserve secure_deletion_required and other explicit errors verbatim.
      RAISE;
  END;

  IF (v_result->>'status') = 'already_deleted' THEN
    RETURN;  -- idempotent success
  END IF;

  -- Category A managed via the legacy path is refused inside begin_ (B2). This
  -- also re-checks under the row lock and makes zero changes on refusal.
  v_result := begin_message_deletion(p_message_id, auth.uid(), 'legacy_rpc', NULL, NULL);
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION unsend_message(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION unsend_message(UUID) TO authenticated;

-- ============================================================================
-- SECTION 16 — Worker: claim, heartbeat, CAS transitions, fail/dead-letter (§8)
-- ============================================================================
-- Claim ONE eligible attempt (§8c predicate) with a 5-minute lease. Short PG
-- txn; Storage work happens OUTSIDE any txn in the Edge worker. FOR UPDATE SKIP
-- LOCKED so concurrent workers never double-claim.
CREATE OR REPLACE FUNCTION claim_deletion_attempt(p_worker TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    UUID;
  v_token UUID := gen_random_uuid();
  v_row   RECORD;
BEGIN
  SELECT a.id INTO v_id
  FROM message_deletion_attempts a
  WHERE a.state IN ('pending','retained','original_removed','failed_requires_reconciliation')
    AND a.requires_manual_reconciliation = false
    AND a.dead_lettered_at IS NULL
    AND (a.next_retry_at IS NULL OR a.next_retry_at <= now())
    AND (a.claim_expires_at IS NULL OR a.claim_expires_at < now())
    AND a.retry_count < 8                              -- automatic_retry_limit
  ORDER BY a.next_retry_at NULLS FIRST, a.started_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  UPDATE message_deletion_attempts
  SET claimed_by = p_worker,
      claim_token = v_token,
      claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',   -- lease
      last_attempt_at = now(),
      updated_at = now()
  WHERE id = v_id
  RETURNING id, message_id, attempt_no, state, attachment_category, retry_count
    INTO v_row;

  RETURN jsonb_build_object(
    'claimed', true,
    'attempt_id', v_row.id,
    'message_id', v_row.message_id,
    'claim_token', v_token,
    'state', v_row.state,
    'category', v_row.attachment_category,
    'retry_count', v_row.retry_count,
    'mapping', (
      SELECT to_jsonb(m) FROM message_attachment_map m
      WHERE m.attempt_id = v_row.id LIMIT 1));
END;
$$;
REVOKE ALL ON FUNCTION claim_deletion_attempt(TEXT) FROM PUBLIC, anon, authenticated;

-- Targeted claim: the delete-message Edge Function claims EXACTLY the attempt it
-- just created (rather than the scan-based claim, which could lease an unrelated
-- pending attempt). Same eligibility predicate (§8c); same lease/token contract.
CREATE OR REPLACE FUNCTION claim_specific_deletion_attempt(p_attempt UUID, p_worker TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    UUID;
  v_token UUID := gen_random_uuid();
  v_row   RECORD;
BEGIN
  SELECT a.id INTO v_id
  FROM message_deletion_attempts a
  WHERE a.id = p_attempt
    AND a.state IN ('pending','retained','original_removed','failed_requires_reconciliation')
    AND a.requires_manual_reconciliation = false
    AND a.dead_lettered_at IS NULL
    AND (a.next_retry_at IS NULL OR a.next_retry_at <= now())
    AND (a.claim_expires_at IS NULL OR a.claim_expires_at < now())
    AND a.retry_count < 8
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  UPDATE message_deletion_attempts
  SET claimed_by = p_worker, claim_token = v_token, claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',
      last_attempt_at = now(), updated_at = now()
  WHERE id = v_id
  RETURNING id, message_id, attempt_no, state, attachment_category, retry_count INTO v_row;

  RETURN jsonb_build_object(
    'claimed', true, 'attempt_id', v_row.id, 'message_id', v_row.message_id,
    'claim_token', v_token, 'state', v_row.state, 'category', v_row.attachment_category,
    'retry_count', v_row.retry_count,
    'mapping', (SELECT to_jsonb(m) FROM message_attachment_map m WHERE m.attempt_id = v_row.id LIMIT 1));
END;
$$;
REVOKE ALL ON FUNCTION claim_specific_deletion_attempt(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Heartbeat: extend the lease (renew when < 2 min remain). CAS on claim_token.
CREATE OR REPLACE FUNCTION heartbeat_deletion_claim(p_attempt UUID, p_claim_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INT;
BEGIN
  UPDATE message_deletion_attempts
  SET claim_expires_at = now() + interval '5 minutes', updated_at = now()
  WHERE id = p_attempt AND claim_token = p_claim_token
    AND claim_expires_at > now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$$;
REVOKE ALL ON FUNCTION heartbeat_deletion_claim(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- CAS: pending -> retained (retention copy verified). Records copy status/checksum.
CREATE OR REPLACE FUNCTION mark_retention_copied(
  p_attempt UUID, p_claim_token UUID,
  p_retained_bucket TEXT, p_retained_path TEXT, p_checksum TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INT;
BEGIN
  UPDATE message_deletion_attempts
  SET state = 'retained', updated_at = now()
  WHERE id = p_attempt AND claim_token = p_claim_token
    AND claim_expires_at > now() AND state = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN
    UPDATE message_attachment_map
    SET retained_bucket = p_retained_bucket, retained_object_path = p_retained_path,
        checksum = COALESCE(p_checksum, checksum),
        copy_status = 'verified', copy_verified_at = now()
    WHERE attempt_id = p_attempt;
  END IF;
  RETURN v_n = 1;
END;
$$;
REVOKE ALL ON FUNCTION mark_retention_copied(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- CAS: retained -> original_removed. Requires positively-verified absence (§8f)
-- established by the worker; p_verification records method/time/result/class.
CREATE OR REPLACE FUNCTION mark_original_removed(
  p_attempt UUID, p_claim_token UUID, p_verification JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INT;
BEGIN
  UPDATE message_deletion_attempts
  SET state = 'original_removed', updated_at = now()
  WHERE id = p_attempt AND claim_token = p_claim_token
    AND claim_expires_at > now() AND state = 'retained';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN
    UPDATE message_attachment_map
    SET delete_status = 'verified_absent', delete_verified_at = now(),
        mapping_error = NULL
    WHERE attempt_id = p_attempt;
  END IF;
  RETURN v_n = 1;
END;
$$;
REVOKE ALL ON FUNCTION mark_original_removed(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- CAS: original_removed -> completed. Canonical content was already redacted in
-- the first txn; this finalizes and re-scrubs pushes defensively.
CREATE OR REPLACE FUNCTION finalize_message_deletion(p_attempt UUID, p_claim_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INT; v_message UUID;
BEGIN
  UPDATE message_deletion_attempts
  SET state = 'completed', completed_at = now(), updated_at = now(),
      claim_token = NULL, claim_expires_at = NULL
  WHERE id = p_attempt AND claim_token = p_claim_token
    AND claim_expires_at > now() AND state = 'original_removed'
  RETURNING message_id INTO v_message;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN
    PERFORM scrub_message_pushes(v_message);
  END IF;
  RETURN v_n = 1;
END;
$$;
REVOKE ALL ON FUNCTION finalize_message_deletion(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Post-attempt failure taxonomy (§8d). Retryable -> failed_requires_reconciliation
-- with backoff; permanent OR retry/age limits exceeded -> dead-letter + critical
-- alert flag. Canonical content is NEVER re-exposed here. CAS on claim_token.
CREATE OR REPLACE FUNCTION fail_deletion_attempt(
  p_attempt UUID, p_claim_token UUID, p_error TEXT, p_permanent BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   RECORD;
  v_dead  BOOLEAN;
BEGIN
  SELECT id, retry_count, started_at INTO v_row
  FROM message_deletion_attempts
  WHERE id = p_attempt AND claim_token = p_claim_token AND claim_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale_or_lost_claim');
  END IF;

  v_dead := p_permanent
         OR (v_row.retry_count + 1) >= 8                         -- max_retry
         OR (now() - v_row.started_at) > interval '24 hours';    -- max_attempt_age

  IF v_dead THEN
    UPDATE message_deletion_attempts
    SET state = 'failed_requires_reconciliation',
        requires_manual_reconciliation = true,
        dead_lettered_at = now(),
        dead_letter_reason = p_error,
        dead_lettered_by = 'worker',
        retry_count = retry_count + 1,
        last_error = p_error,
        failed_at = now(),
        failure_reason = p_error,
        claim_token = NULL, claim_expires_at = NULL,
        updated_at = now()
    WHERE id = p_attempt;
    RETURN jsonb_build_object('ok', true, 'dead_lettered', true, 'alert', 'critical');
  ELSE
    UPDATE message_deletion_attempts
    SET state = 'failed_requires_reconciliation',
        retry_count = retry_count + 1,
        next_retry_at = now() + _dmp_backoff(retry_count + 1),
        last_error = p_error,
        claim_token = NULL, claim_expires_at = NULL,
        updated_at = now()
    WHERE id = p_attempt;
    RETURN jsonb_build_object('ok', true, 'dead_lettered', false);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION fail_deletion_attempt(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- SECTION 17 — Founder/admin foundations: manual retry, restore, purge (§8d/§10)
-- ============================================================================
-- Clear a dead-letter and schedule EXACTLY ONE controlled attempt (§8d). Keeps
-- history. Service role only (future audited admin path).
CREATE OR REPLACE FUNCTION admin_manual_retry_deletion(p_attempt UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INT;
BEGIN
  UPDATE message_deletion_attempts
  SET requires_manual_reconciliation = false,
      dead_lettered_at = NULL,
      dead_letter_reason = NULL,
      next_retry_at = now(),
      claim_token = NULL, claim_expires_at = NULL,
      last_error = COALESCE('manual retry: ' || p_reason, last_error),
      updated_at = now()
  WHERE id = p_attempt AND requires_manual_reconciliation = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n = 1);
END;
$$;
REVOKE ALL ON FUNCTION admin_manual_retry_deletion(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Restore (all-or-nothing, founder-only, audited). Storage file move-back is
-- performed by the admin Edge path BEFORE this is called (verified); this does
-- the DB half: re-insert content/attachment/shared refs + poll/options/votes
-- from history, clear deleted_at, and set state='restored'. Attempt history is
-- preserved; a restored message may be deleted again (new attempt).
CREATE OR REPLACE FUNCTION admin_restore_message(p_attempt UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att   RECORD;
  v_hist  RECORD;
  v_poll  RECORD;
  v_opt   JSONB;
  v_vote  JSONB;
BEGIN
  SELECT id, message_id, state INTO v_att
  FROM message_deletion_attempts WHERE id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found'); END IF;

  -- Restoration eligible only after redaction committed (§7).
  IF v_att.state NOT IN ('redacted','completed','failed_requires_reconciliation') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_restorable_from_state', 'state', v_att.state);
  END IF;

  SELECT * INTO v_hist FROM deleted_message_history WHERE attempt_id = p_attempt;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_history'); END IF;

  -- Re-hydrate canonical message fields.
  UPDATE messages
  SET content = v_hist.content,
      attachment_url = v_hist.attachment_url,
      attachment_name = v_hist.attachment_name,
      attachment_mime = v_hist.attachment_mime,
      attachment_size = v_hist.attachment_size,
      shared_event_id = v_hist.shared_event_id,
      shared_post_id = v_hist.shared_post_id,
      deleted_at = NULL,
      deleted_by = NULL
  WHERE id = v_att.message_id;

  -- Re-insert poll/options/votes if this was a poll and the rows are gone.
  IF v_hist.poll_snapshot IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM polls WHERE message_id = v_att.message_id) THEN
      INSERT INTO polls (message_id, question, allow_multiple, start_at, end_at)
      VALUES (v_att.message_id,
              v_hist.poll_snapshot->>'question',
              COALESCE((v_hist.poll_snapshot->>'allow_multiple')::boolean, false),
              (v_hist.poll_snapshot->>'start_at')::timestamptz,
              (v_hist.poll_snapshot->>'end_at')::timestamptz)
      RETURNING id, message_id INTO v_poll;

      FOR v_opt IN SELECT * FROM jsonb_array_elements(v_hist.poll_snapshot->'options') LOOP
        INSERT INTO poll_options (id, poll_id, option_text, display_order)
        VALUES ((v_opt->>'id')::uuid, v_poll.id, v_opt->>'text', (v_opt->>'display_order')::int);
      END LOOP;
      FOR v_vote IN SELECT * FROM jsonb_array_elements(v_hist.poll_snapshot->'votes') LOOP
        INSERT INTO poll_votes (poll_id, option_id, user_id)
        VALUES (v_poll.id, (v_vote->>'option_id')::uuid, (v_vote->>'user_id')::uuid)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  END IF;

  UPDATE message_deletion_attempts
  SET state = 'restored', restored_at = now(), restored_by = 'admin',
      restoration_reason = p_reason, restoration_result = 'ok',
      requires_manual_reconciliation = false,
      updated_at = now()
  WHERE id = p_attempt;

  RETURN jsonb_build_object('ok', true, 'message_id', v_att.message_id);
END;
$$;
REVOKE ALL ON FUNCTION admin_restore_message(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Purge foundation (irreversible, audited). Deletes the founder history +
-- attachment mapping + retained-object references for an attempt and marks it
-- purged. The physical retained-object delete is performed by the admin Edge
-- path; this removes the DB-side snapshot. Eligible from redacted/completed or
-- after manual reconciliation (§7).
CREATE OR REPLACE FUNCTION admin_purge_deleted_message(p_attempt UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_att RECORD;
BEGIN
  SELECT id, state, requires_manual_reconciliation INTO v_att
  FROM message_deletion_attempts WHERE id = p_attempt FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found'); END IF;
  IF v_att.state NOT IN ('redacted','completed','failed_requires_reconciliation') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_purgeable_from_state', 'state', v_att.state);
  END IF;

  DELETE FROM deleted_message_history WHERE attempt_id = p_attempt;
  DELETE FROM poll_votes v USING message_deletion_attempts a
    WHERE a.id = p_attempt AND v.poll_id IN (
      SELECT id FROM polls WHERE message_id = a.message_id);
  -- Attachment map kept as a tombstone (delete refs) unless caller removes it.
  UPDATE message_attachment_map
  SET retained_bucket = NULL, retained_object_path = NULL
  WHERE attempt_id = p_attempt;

  UPDATE message_deletion_attempts
  SET state = 'purged', restoration_reason = COALESCE(p_reason, restoration_reason),
      requires_manual_reconciliation = false, updated_at = now()
  WHERE id = p_attempt;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION admin_purge_deleted_message(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- SECTION 18 — Report-evidence backfill (§11, NON-destructive)
-- ============================================================================
-- Copy existing reporter-readable snapshots into the private one-to-many table.
-- Idempotent (guarded by NOT EXISTS). Does NOT null reporters' snapshot columns
-- — that destructive step is deferred to the approved backfill phase (§18).
INSERT INTO report_evidence (report_id, evidence_type, related_entity_type, related_entity_id, content_snapshot, metadata)
SELECT r.id, 'message_content', 'message', r.message_id, r.content_snapshot, NULL
FROM reports r
WHERE r.content_snapshot IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM report_evidence e
    WHERE e.report_id = r.id AND e.evidence_type = 'message_content');

INSERT INTO report_evidence (report_id, evidence_type, related_entity_type, related_entity_id, storage_bucket, storage_path, metadata)
SELECT r.id, 'attachment', 'message', r.message_id, 'chat-attachments',
       r.attachment_snapshot->>'url', r.attachment_snapshot
FROM reports r
WHERE r.attachment_snapshot IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM report_evidence e
    WHERE e.report_id = r.id AND e.evidence_type = 'attachment');

-- ============================================================================
-- SECTION 19 — Realtime redaction note (§7)
-- ============================================================================
-- `messages` and `poll_votes` are already in the supabase_realtime publication.
-- The message soft-delete UPDATE (deleted_at set + content nulled) is itself the
-- Realtime event ordinary clients receive — the redacted row. No original
-- content is broadcast. Poll-vote Realtime is guarded because the poll rows are
-- hidden by RLS (is_deleted_message) and cast_poll_vote refuses deleted polls.
-- No publication change is required.

-- ============================================================================
-- SECTION 20 — service_role EXECUTE grants (§12)
-- ============================================================================
-- The Edge Functions connect as `service_role`, which has BYPASSRLS but is NOT
-- superuser — after REVOKE ... FROM PUBLIC it needs explicit EXECUTE on every
-- function it invokes. These are the ONLY functions the delete-message +
-- reconcile-deletions Edge Functions (and the future admin path) call directly.
-- Ordinary clients still cannot call them (REVOKE'd from anon/authenticated).
GRANT EXECUTE ON FUNCTION preflight_message_deletion(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION begin_message_deletion(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION record_unmappable_attachment_diagnostic(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION claim_deletion_attempt(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION claim_specific_deletion_attempt(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION heartbeat_deletion_claim(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION mark_retention_copied(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION mark_original_removed(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_message_deletion(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION fail_deletion_attempt(UUID, UUID, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION admin_manual_retry_deletion(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_restore_message(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_purge_deleted_message(UUID, TEXT) TO service_role;

-- ============================================================================
-- END 051_deleted_message_privacy.sql
-- ============================================================================
