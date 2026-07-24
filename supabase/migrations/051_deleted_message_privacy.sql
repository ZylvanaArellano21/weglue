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
-- SAFETY: additive + policy-tightening, with TWO intentional destructive steps
-- required by the privacy mandate: (1) §18 backfills report snapshots into the
-- deny-all `report_evidence` table, asserts full coverage, then NULLs the
-- reporter-readable `reports.content_snapshot`/`.attachment_snapshot` columns
-- (BLOCKER 2 — snapshot nulling is NOT deferred); (2) §15b routes channel/group/
-- official-chat bulk deletion through the canonical redaction lifecycle and
-- retargets the message parent FKs to ON DELETE RESTRICT so no cascade can hard-
-- delete messages (BLOCKER 3). Dual-platform safe: no client contract breaks;
-- old clients calling `unsend_message` still work (managed-attachment messages
-- get a real `secure_deletion_required` error instead of an insecure delete —
-- §5b). Poll voting/creation are RPC-only, so removing direct poll_votes write
-- policies (BLOCKER 5) does not affect clients.
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
                                   CHECK (entry_point IN ('edge_function','legacy_rpc','admin','bulk')),
  attachment_category            TEXT NOT NULL
                                   CHECK (attachment_category IN ('managed','external','none')),
  state                          TEXT NOT NULL DEFAULT 'pending'
                                   CHECK (state IN (
                                     -- active
                                     'pending','retained','original_removed','redacted',
                                     'failed_requires_reconciliation',
                                     -- terminal
                                     'completed','restored','purged','aborted')),
  -- resume state machine (§8 / BLOCKER 6). The last lifecycle step whose result
  -- is durably committed, so a claimed `failed_requires_reconciliation` attempt
  -- resumes from the correct safe point instead of restarting or stalling:
  --   'created'          → nothing durable yet; resume by (re)copying to retention
  --   'retained'         → retention copy verified; resume by deleting the original
  --   'original_removed' → original proven absent; resume by finalizing
  last_completed_step            TEXT NOT NULL DEFAULT 'created'
                                   CHECK (last_completed_step IN ('created','retained','original_removed')),
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
-- BLOCKER 7 (oracle): NOT granted to authenticated. A directly-callable
-- is_deleted_message(uuid) is a deletion oracle for arbitrary UUIDs. It is used
-- only from other SECURITY DEFINER functions (via ownership, no grant needed)
-- and from the opaque combined RLS helpers below. Revoked from every client role.
REVOKE ALL ON FUNCTION is_deleted_message(UUID) FROM PUBLIC, anon, authenticated;

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
-- BLOCKER 7 (oracle): NOT granted to authenticated. Returning a conversation_id
-- for an arbitrary message UUID leaks which conversation any message belongs to.
-- Used only inside the opaque combined helpers (definer → no grant needed).
REVOKE ALL ON FUNCTION message_conversation_id(UUID) FROM PUBLIC, anon, authenticated;

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
-- BLOCKER 7 (oracle): NOT granted to authenticated. Folded into the opaque
-- chat_attachment_readable() helper below (definer → no grant needed).
REVOKE ALL ON FUNCTION is_deleted_attachment(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

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
-- BLOCKER 7 (oracle): NOT granted to authenticated. Folded into can_see_poll()
-- / can_manage_poll() below (definer → no grant needed).
REVOKE ALL ON FUNCTION is_deleted_poll(UUID) FROM PUBLIC, anon, authenticated;

-- ── BLOCKER 7: opaque combined RLS helpers ──────────────────────────────────
-- RLS policy expressions are evaluated with the *querying* role's privileges and
-- Postgres DOES enforce EXECUTE on functions they call, so the poll/storage
-- policies must call helpers `authenticated` can execute. Rather than granting
-- the raw deletion/lookup oracles above (each of which answers a question about
-- an arbitrary UUID/path), we grant these FUSED helpers that only ever return
-- TRUE for a row the caller is actually entitled to and FALSE — opaquely and
-- identically — for deleted, foreign, unauthorized, and nonexistent inputs. An
-- attacker calling them directly learns nothing they could not already see.

-- Poll (by underlying message) is visible to me: not deleted AND I participate.
CREATE OR REPLACE FUNCTION can_see_message(p_message_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id
      AND m.deleted_at IS NULL
      AND is_conversation_participant(m.conversation_id)
  );
$$;
REVOKE ALL ON FUNCTION can_see_message(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_see_message(UUID) TO authenticated;

-- Poll (by poll id) is visible to me: its message is not deleted AND I participate.
CREATE OR REPLACE FUNCTION can_see_poll(p_poll_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.polls p
    JOIN public.messages m ON m.id = p.message_id
    WHERE p.id = p_poll_id
      AND m.deleted_at IS NULL
      AND is_conversation_participant(m.conversation_id)
  );
$$;
REVOKE ALL ON FUNCTION can_see_poll(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_see_poll(UUID) TO authenticated;

-- Poll (by underlying message) is manageable by me: not deleted AND I am the
-- message sender (poll creator).
CREATE OR REPLACE FUNCTION can_manage_poll_message(p_message_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = p_message_id
      AND m.deleted_at IS NULL
      AND m.sender_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION can_manage_poll_message(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_manage_poll_message(UUID) TO authenticated;

-- Poll (by poll id) is manageable by me: its message is not deleted AND I am the
-- sender. Used by the poll_options creator-manage policy.
CREATE OR REPLACE FUNCTION can_manage_poll(p_poll_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.polls p
    JOIN public.messages m ON m.id = p.message_id
    WHERE p.id = p_poll_id
      AND m.deleted_at IS NULL
      AND m.sender_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION can_manage_poll(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_manage_poll(UUID) TO authenticated;

-- Chat attachment object is readable by me: I participate in its conversation
-- (folder segment 1) AND it is not a deleted attachment. Folds the storage
-- deletion oracle behind the participation check.
CREATE OR REPLACE FUNCTION chat_attachment_readable(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, storage
STABLE
AS $$
  SELECT is_conversation_participant(((storage.foldername(p_name))[1])::uuid)
     AND NOT is_deleted_attachment('chat-attachments', p_name);
$$;
REVOKE ALL ON FUNCTION chat_attachment_readable(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION chat_attachment_readable(TEXT) TO authenticated;

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

-- BLOCKER 6 — resume-state resolver. Given an attempt's state and its
-- last_completed_step, return the ACTIVE state a worker should drive on claim.
-- Active states pass through unchanged; a failed_requires_reconciliation attempt
-- is mapped back to the resumable active state implied by the durably-recorded
-- last completed step. Deterministic + idempotent.
CREATE OR REPLACE FUNCTION _dmp_resume_state(p_state TEXT, p_last_completed_step TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_state <> 'failed_requires_reconciliation' THEN p_state
    WHEN p_last_completed_step = 'original_removed'   THEN 'original_removed'
    WHEN p_last_completed_step = 'retained'           THEN 'retained'
    ELSE 'pending'
  END;
$$;
REVOKE ALL ON FUNCTION _dmp_resume_state(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

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

-- Hard guarantee: NO client may hard-delete a message. There is no DELETE RLS
-- policy on messages (so a client DELETE already affects 0 rows), but the base
-- DELETE grant existed — revoke it so any client-side hard-delete fails loudly
-- instead of silently no-op'ing. All deletion goes through the secure path
-- (unsend_message RPC / delete-message Edge Function) which soft-deletes +
-- redacts + retains. FK cascades and SECURITY DEFINER account-deletion are
-- unaffected (they do not run as anon/authenticated).
REVOKE DELETE ON messages FROM anon, authenticated;

-- BLOCKER 1 — deleted-message UPDATE bypass. The ordinary `messages: senders can
-- update own` policy (040) let a sender UPDATE their own row with no
-- `deleted_at IS NULL` guard, so a client could clear deleted_at, rehydrate
-- content/attachment fields, or mutate deletion state — bypassing audited
-- founder restoration. There is NO legitimate client message-edit feature (the
-- app never UPDATEs `messages`; every mutation goes through SECURITY DEFINER
-- RPCs owned by postgres, which bypass RLS as the table owner and need no client
-- grant). So we remove ordinary direct UPDATE rights entirely rather than
-- retaining unnecessary, dangerous access. Restoration is available only through
-- the controlled admin_restore_message() operation (§10). A future edit feature
-- must be a new SECURITY DEFINER RPC that itself requires `deleted_at IS NULL`.
DROP POLICY IF EXISTS "messages: senders can update own" ON messages;
DROP POLICY IF EXISTS "messages: senders can update" ON messages;
REVOKE UPDATE ON messages FROM anon, authenticated;

-- ============================================================================
-- SECTION 9 — Poll privacy (§9)
-- ============================================================================
-- Every permissive SELECT policy on the three poll tables AND cast_poll_vote
-- must check deletion state so no participant can read/infer
-- question/options/votes/voters/totals or vote on a deleted poll. The policies
-- call the opaque combined helpers (§7 / BLOCKER 7): they return TRUE only for a
-- poll the caller is entitled to see and FALSE identically for
-- deleted/foreign/nonexistent — no raw deletion or conversation-id oracle is
-- exposed to `authenticated`.
--
-- BLOCKER 5 — legacy permissive policies OR-combine. Postgres permissive
-- policies are OR'd, so an unguarded legacy policy re-opens what a new guarded
-- policy closes. We DROP every legacy poll policy that lacks the deletion guard
-- or bypasses the canonical RPCs, and recreate only the guarded set below.

-- polls SELECT: drop BOTH the prior guarded name AND migration 010's unguarded
-- duplicate ("polls: participants can read"), which leaked deleted polls via OR.
DROP POLICY IF EXISTS "polls: conversation participants can read" ON polls;
DROP POLICY IF EXISTS "polls: participants can read" ON polls;
CREATE POLICY "polls: conversation participants can read"
  ON polls FOR SELECT TO authenticated
  USING ( can_see_message(polls.message_id) );

DROP POLICY IF EXISTS "poll_options: participants can read" ON poll_options;
CREATE POLICY "poll_options: participants can read"
  ON poll_options FOR SELECT TO authenticated
  USING ( can_see_poll(poll_options.poll_id) );

DROP POLICY IF EXISTS "poll_votes: participants can read" ON poll_votes;
CREATE POLICY "poll_votes: participants can read"
  ON poll_votes FOR SELECT TO authenticated
  USING ( can_see_poll(poll_votes.poll_id) );

-- BLOCKER 5 — poll_votes writes are RPC-ONLY. The app never writes poll_votes
-- directly; every vote goes through cast_poll_vote() (SECURITY DEFINER, owned by
-- postgres → bypasses RLS). Remove ALL direct-write policies so an ordinary
-- client cannot INSERT/UPDATE/DELETE a vote row — including on a deleted poll or
-- to fabricate/erase totals. Migration 010's guarded "users manage own" is also
-- dropped (its SELECT arm is superseded by "participants can read" above; its
-- write arm is exactly what we are removing). Legacy 001 direct INSERT/DELETE
-- policies are dropped too.
DROP POLICY IF EXISTS "poll_votes: users manage own" ON poll_votes;
DROP POLICY IF EXISTS "poll_votes: authenticated can vote" ON poll_votes;
DROP POLICY IF EXISTS "poll_votes: users can remove own vote" ON poll_votes;

-- Defense in depth: the poll/option creator "manage" FOR ALL policies self-filter
-- deleted polls today only because their message subquery is RLS-filtered.
-- Recreate them with the opaque manage helpers so the poll SENDER/creator (who
-- may be the deleter) cannot read/manage a deleted poll's rows regardless of any
-- future change to messages RLS (§9). Also drop migration 010's unguarded
-- "poll_options: poll creator can insert" (creation is via create_poll RPC;
-- the guarded manage policy covers legitimate active-poll option writes).
DROP POLICY IF EXISTS "polls: message senders can manage" ON polls;
CREATE POLICY "polls: message senders can manage"
  ON polls FOR ALL TO authenticated
  USING ( can_manage_poll_message(polls.message_id) )
  WITH CHECK ( can_manage_poll_message(polls.message_id) );

DROP POLICY IF EXISTS "poll_options: poll creator can insert" ON poll_options;
DROP POLICY IF EXISTS "poll_options: poll creator can manage" ON poll_options;
CREATE POLICY "poll_options: poll creator can manage"
  ON poll_options FOR ALL TO authenticated
  USING ( can_manage_poll(poll_options.poll_id) )
  WITH CHECK ( can_manage_poll(poll_options.poll_id) );

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
    AND chat_attachment_readable(name)
  );

-- BLOCKER 4 — client Storage DELETE bypass. Migration 006's
-- "chat-attachments: uploader can delete" (USING owner = auth.uid()) let an
-- ordinary uploader physically remove the original attachment object at any
-- time — before retention, defeating the entire deletion lifecycle (an uploader
-- could destroy their own attachment without a retained copy, and there was no
-- server audit). Attachment removal must occur ONLY through the secure
-- server-side flow (delete-message / reconcile-deletions Edge Functions running
-- as service_role, which bypass RLS). Drop the client DELETE policy entirely;
-- there is no INSERT/SELECT change (uploading + reading active attachments still
-- work). Account-deletion cleanup already removes objects via the service-role
-- Edge Function (migration 044), not an ordinary client DELETE.
DROP POLICY IF EXISTS "chat-attachments: uploader can delete" ON storage.objects;

-- The private `deleted-message-retention` bucket has NO storage.objects policy,
-- so RLS default-denies every anon/authenticated SELECT/INSERT/UPDATE/DELETE on
-- it. Retained originals are reachable only by the service role (Edge worker)
-- and a future audited founder/admin path. (Re-asserted here for the audit.)

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

  SELECT c.type, c.club_id, c.created_by INTO v_conv
  FROM conversations c WHERE c.id = v_msg.conversation_id;

  -- BLOCKER 7 (deletion oracle) — authorization runs BEFORE any existence /
  -- deletion signal is returned. Previously `already_deleted` was returned here
  -- before this check, so an UNAUTHORIZED caller could distinguish a foreign
  -- *deleted* message (got 'already_deleted') from a foreign *live* or
  -- nonexistent message (got the opaque error) — an oracle. Now every
  -- unauthorized/foreign/nonexistent input collapses to the SAME opaque error,
  -- and only an authorized caller ever learns the message is already deleted.
  --
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

  -- Authorized: only now may we reveal the idempotent already-deleted signal.
  IF v_msg.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status','already_deleted','message_id', p_message_id);
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
  IF p_entry_point NOT IN ('edge_function','legacy_rpc','admin','bulk') THEN
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

  SELECT c.type, c.club_id, c.created_by INTO v_conv
  FROM conversations c WHERE c.id = v_msg.conversation_id;

  -- BLOCKER 7 (deletion oracle) — authorize BEFORE returning the already-deleted
  -- signal, so an unauthorized caller cannot distinguish a foreign deleted
  -- message from a foreign live/nonexistent one. Re-confirm authorization under
  -- the lock (§4b step 1). Officer check is actor-parameterized (see
  -- preflight_message_deletion). Entry points 'admin' and 'bulk' are trusted
  -- server-only callers (this function is REVOKE'd from anon/authenticated); the
  -- bulk conversation/channel operations authorize the actor themselves before
  -- looping (BLOCKER 3).
  IF NOT (
        v_msg.sender_id = p_actor_id
     OR (v_conv.type IN ('club_group','officer_chat')
         AND EXISTS (SELECT 1 FROM club_members
                     WHERE club_id = v_conv.club_id AND user_id = p_actor_id AND role = 'officer'))
     OR (v_conv.type = 'group' AND v_conv.created_by = p_actor_id)
     OR p_entry_point IN ('admin','bulk')
  ) THEN
    RAISE EXCEPTION 'not_found_or_not_authorized' USING ERRCODE = '42501';
  END IF;

  -- Authorized: only now reveal the idempotent already-deleted signal (§5b rule 3).
  IF v_msg.deleted_at IS NOT NULL THEN
    SELECT id, state INTO v_existing
    FROM message_deletion_attempts
    WHERE message_id = p_message_id
    ORDER BY attempt_no DESC LIMIT 1;
    RETURN jsonb_build_object('status','already_deleted','message_id', p_message_id,
      'attempt_id', v_existing.id, 'state', v_existing.state);
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
-- SECTION 15b — BLOCKER 3: safe bulk deletion (channel / group / official chat)
-- ============================================================================
-- Three product operations remove a whole channel/conversation's messages:
--   • delete_conversation_channel (041) — physically DELETE'd the channel, which
--     CASCADE-HARD-DELETED every message via messages.channel_id / the composite
--     FK: no history, no attachment retention, no redaction, no push/poll
--     cleanup. A catastrophic privacy bypass.
--   • delete_group_conversation (040) and clear_official_chat (040) — merely set
--     messages.deleted_at WITHOUT redacting content, retaining attachments,
--     snapshotting history, or scrubbing pushes. The original content stayed in
--     the row and Storage.
--
-- Decision (§ Blocker 3): Approach A — route EVERY message through the canonical
-- deletion lifecycle, and forbid any FK cascade from physically erasing product
-- messages.
--
-- (1) Retarget the message parent FKs from ON DELETE CASCADE to ON DELETE
--     RESTRICT so neither a channel nor a conversation delete can ever erase
--     messages outside the lifecycle. (Deleting a child message row is
--     unaffected — RESTRICT constrains deleting the PARENT.)
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_channel_id_fkey
  FOREIGN KEY (channel_id) REFERENCES conversation_channels(id) ON DELETE RESTRICT;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_conversation_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_channel_conversation_fkey
  FOREIGN KEY (channel_id, conversation_id)
  REFERENCES conversation_channels(id, conversation_id) ON DELETE RESTRICT;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE RESTRICT;

-- (2) Remove the client-facing channel DELETE policy: channel removal must go
--     through the secure RPC below, never a direct client DELETE. (With RESTRICT
--     a direct delete of a channel with messages already fails, but we close the
--     path entirely — the app deletes only via delete_conversation_channel.)
DROP POLICY IF EXISTS "conv_channels: officers can delete" ON conversation_channels;

-- (3) Bulk secure-delete helper: route EVERY active message in a conversation
--     (optionally a single channel) through begin_message_deletion with
--     entry_point='bulk' — snapshot to founder history, map + schedule
--     managed-attachment retention/removal, redact canonical content, set
--     deleted_at, scrub pending pushes. Managed attachments become 'pending'
--     attempts the reconcile worker retains + removes asynchronously; the DB is
--     fail-closed immediately and synchronously. The caller MUST authorize the
--     actor first (these helpers do not re-check the actor's role). Returns the
--     count processed. NOTE: redaction is one transaction; the physical Storage
--     work is bounded + resumable in the worker (§8). For very large channels the
--     redaction batch is large but cheap (no in-txn Storage) — acceptable at
--     launch scale; a future chunked variant can page by created_at if needed.
CREATE OR REPLACE FUNCTION _dmp_bulk_secure_delete(
  p_conversation_id UUID, p_channel_id UUID, p_actor UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r RECORD; v_n INT := 0;
BEGIN
  FOR r IN
    SELECT id FROM messages
    WHERE conversation_id = p_conversation_id
      AND (p_channel_id IS NULL OR channel_id = p_channel_id)
      AND deleted_at IS NULL
    ORDER BY created_at, id
  LOOP
    PERFORM begin_message_deletion(r.id, p_actor, 'bulk', NULL, 'bulk_delete');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION _dmp_bulk_secure_delete(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- (4) delete_conversation_channel — securely redact every message in the
--     channel, DETACH them (channel_id -> NULL) so the RESTRICT FK is satisfied,
--     then physically remove the now-empty channel container. Messages have
--     ALREADY completed secure deletion (redaction) before the parent is
--     removed, and their retained originals live under message_id, not the
--     channel — so nothing is orphaned or bypassed.
CREATE OR REPLACE FUNCTION delete_conversation_channel(p_channel_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT cc.kind, cc.conversation_id, c.type, c.club_id INTO v
  FROM conversation_channels cc JOIN conversations c ON c.id = cc.conversation_id
  WHERE cc.id = p_channel_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v.kind = 'main' THEN RAISE EXCEPTION 'cannot_delete_main'; END IF;
  IF v.type NOT IN ('club_group','officer_chat') OR NOT is_club_officer(v.club_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  PERFORM _dmp_bulk_secure_delete(v.conversation_id, p_channel_id, auth.uid());
  -- Detach the redacted messages so the ON DELETE RESTRICT parent FK is
  -- satisfied and no cascade can fire (the composite FK with NULL channel_id is
  -- unenforced). History already holds the original channel_id snapshot.
  UPDATE messages SET channel_id = NULL WHERE channel_id = p_channel_id;
  DELETE FROM conversation_channels WHERE id = p_channel_id;
END;
$$;
REVOKE ALL ON FUNCTION delete_conversation_channel(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_conversation_channel(UUID) TO authenticated;

-- (5) delete_group_conversation — secure-redact every message, then soft-delete
--     the conversation (never physical → no cascade) and drop participants.
CREATE OR REPLACE FUNCTION delete_group_conversation(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE id = p_conversation_id AND type = 'group' AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  PERFORM _dmp_bulk_secure_delete(p_conversation_id, NULL, auth.uid());
  UPDATE conversations SET deleted_at = now() WHERE id = p_conversation_id;
  DELETE FROM conversation_participants WHERE conversation_id = p_conversation_id;
END;
$$;
REVOKE ALL ON FUNCTION delete_group_conversation(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_group_conversation(UUID) TO authenticated;

-- (6) clear_official_chat — secure-redact every message, then hide the thread
--     for participants (conversation itself is retained).
CREATE OR REPLACE FUNCTION clear_official_chat(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_conv RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT type, club_id INTO v_conv FROM conversations WHERE id = p_conversation_id;
  IF NOT FOUND OR v_conv.type NOT IN ('club_group','officer_chat') THEN
    RAISE EXCEPTION 'not_official_chat';
  END IF;
  IF NOT is_club_officer(v_conv.club_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  PERFORM _dmp_bulk_secure_delete(p_conversation_id, NULL, auth.uid());
  UPDATE conversation_participants SET hidden_at = now()
  WHERE conversation_id = p_conversation_id;
END;
$$;
REVOKE ALL ON FUNCTION clear_official_chat(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION clear_official_chat(UUID) TO authenticated;

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
  v_id     UUID;
  v_state  TEXT;
  v_step   TEXT;
  v_resume TEXT;
  v_token  UUID := gen_random_uuid();
  v_row    RECORD;
BEGIN
  SELECT a.id, a.state, a.last_completed_step INTO v_id, v_state, v_step
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

  -- BLOCKER 6 — resume-state normalization. A `failed_requires_reconciliation`
  -- attempt carries no active step of its own, and the CAS transitions only
  -- accept the happy-path prior state (pending/retained/original_removed). Map it
  -- back to the correct resumable state from the durably-recorded
  -- last_completed_step so the normal CAS transitions apply and the worker
  -- resumes from the right point (never restarting after the original is gone,
  -- never finalizing before retention). Idempotent: re-normalizes to the same
  -- state on every reclaim.
  v_resume := _dmp_resume_state(v_state, v_step);

  UPDATE message_deletion_attempts
  SET state = v_resume,
      claimed_by = p_worker,
      claim_token = v_token,
      claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',   -- lease
      last_attempt_at = now(),
      updated_at = now()
  WHERE id = v_id
  RETURNING id, message_id, attempt_no, state, attachment_category, retry_count,
            last_completed_step
    INTO v_row;

  RETURN jsonb_build_object(
    'claimed', true,
    'attempt_id', v_row.id,
    'message_id', v_row.message_id,
    'claim_token', v_token,
    'state', v_row.state,
    'last_completed_step', v_row.last_completed_step,
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
  v_id     UUID;
  v_state  TEXT;
  v_step   TEXT;
  v_resume TEXT;
  v_token  UUID := gen_random_uuid();
  v_row    RECORD;
BEGIN
  SELECT a.id, a.state, a.last_completed_step INTO v_id, v_state, v_step
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

  -- BLOCKER 6 — same resume-state normalization as claim_deletion_attempt.
  v_resume := _dmp_resume_state(v_state, v_step);

  UPDATE message_deletion_attempts
  SET state = v_resume,
      claimed_by = p_worker, claim_token = v_token, claimed_at = now(),
      claim_expires_at = now() + interval '5 minutes',
      last_attempt_at = now(), updated_at = now()
  WHERE id = v_id
  RETURNING id, message_id, attempt_no, state, attachment_category, retry_count,
            last_completed_step INTO v_row;

  RETURN jsonb_build_object(
    'claimed', true, 'attempt_id', v_row.id, 'message_id', v_row.message_id,
    'claim_token', v_token, 'state', v_row.state,
    'last_completed_step', v_row.last_completed_step,
    'category', v_row.attachment_category,
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
  SET state = 'retained', last_completed_step = 'retained', updated_at = now()
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
  SET state = 'original_removed', last_completed_step = 'original_removed', updated_at = now()
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
-- SECTION 18 — BLOCKER 2: confidential report evidence (§11)
-- ============================================================================
-- Migration 040's report_message() wrote the reported message's content +
-- attachment snapshot into `reports.content_snapshot` / `.attachment_snapshot`,
-- which are reporter-readable. So a reporter (or anyone who can read the report
-- row) could retrieve a deleted message's original content/attachment forever —
-- the exact §0 violation this release exists to fix. We move ALL confidential
-- evidence into the private, deny-all `report_evidence` table and strip it from
-- the reporter-facing `reports` row, which now carries WORKFLOW fields only.

-- (a) Harden report_message: write evidence to private report_evidence only;
--     never populate the reporter-readable snapshot columns. The reporter row
--     keeps report id, reason, details, target type/id, status, timestamps.
CREATE OR REPLACE FUNCTION report_message(
  p_message_id UUID,
  p_reason TEXT,
  p_details TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_msg RECORD;
  v_conv RECORD;
  v_reporter RECORD;
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT m.*, p.question AS poll_question INTO v_msg
  FROM messages m
  LEFT JOIN polls p ON p.message_id = m.id
  WHERE m.id = p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
  IF NOT is_conversation_participant(v_msg.conversation_id) THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;
  IF v_msg.sender_id = auth.uid() THEN RAISE EXCEPTION 'cannot_report_own'; END IF;

  SELECT type, club_id INTO v_conv FROM conversations WHERE id = v_msg.conversation_id;
  SELECT username, id INTO v_reporter FROM profiles WHERE id = auth.uid();

  -- Workflow-only reporter row (NO content/attachment snapshot columns written).
  INSERT INTO reports (
    reporter_id, reporter_username, entity_type, entity_id, club_id,
    reason, details, status,
    message_id, conversation_id, conversation_type, message_type,
    message_sender_id
  ) VALUES (
    auth.uid(), v_reporter.username, 'message', p_message_id, v_conv.club_id,
    p_reason, p_details, 'pending',
    p_message_id, v_msg.conversation_id, v_conv.type, v_msg.message_type,
    v_msg.sender_id
  ) RETURNING id INTO v_report_id;

  -- Confidential evidence -> private, deny-all report_evidence (moderator-only
  -- via a future audited path). Captured at report time so a later unsend cannot
  -- destroy it, but NEVER reader-visible on the reports row.
  IF COALESCE(v_msg.content, v_msg.poll_question) IS NOT NULL THEN
    INSERT INTO report_evidence (report_id, evidence_type, related_entity_type,
                                 related_entity_id, content_snapshot)
    VALUES (v_report_id, 'message_content', 'message', p_message_id,
            COALESCE(v_msg.content, v_msg.poll_question));
  END IF;
  IF v_msg.attachment_url IS NOT NULL THEN
    INSERT INTO report_evidence (report_id, evidence_type, related_entity_type,
                                 related_entity_id, storage_bucket, storage_path, metadata)
    VALUES (v_report_id, 'attachment', 'message', p_message_id,
            'chat-attachments', v_msg.attachment_url,
            jsonb_build_object(
              'url', v_msg.attachment_url,
              'name', v_msg.attachment_name,
              'size', v_msg.attachment_size,
              'mime', v_msg.attachment_mime));
  END IF;

  RETURN v_report_id;
END;
$$;
REVOKE ALL ON FUNCTION report_message(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION report_message(UUID, TEXT, TEXT) TO authenticated;

-- (b) Backfill existing snapshots into private report_evidence (idempotent,
--     NOT EXISTS-guarded). Service-role/migration runs this.
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

-- (c) Coverage assertion: EVERY reporter-readable snapshot must now have a
--     matching private report_evidence row before we null the source. Abort the
--     whole migration if any snapshot would be lost.
DO $$
DECLARE v_missing INT;
BEGIN
  SELECT count(*) INTO v_missing
  FROM reports r
  WHERE (r.content_snapshot IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM report_evidence e
           WHERE e.report_id = r.id AND e.evidence_type = 'message_content'))
     OR (r.attachment_snapshot IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM report_evidence e
           WHERE e.report_id = r.id AND e.evidence_type = 'attachment'));
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'report_evidence backfill incomplete: % report(s) uncovered', v_missing;
  END IF;
END $$;

-- (d) Now-safe destructive step (BLOCKER 2 requires this in THIS release, not a
--     deferred phase): null the reporter-readable snapshot columns. Evidence is
--     preserved only in the deny-all report_evidence table. Rollback of 051
--     leaves these NULLs in place (data already gone), so it can never re-grant
--     reporter access to retained evidence.
UPDATE reports SET content_snapshot = NULL WHERE content_snapshot IS NOT NULL;
UPDATE reports SET attachment_snapshot = NULL WHERE attachment_snapshot IS NOT NULL;

COMMENT ON COLUMN reports.content_snapshot IS
  'DEPRECATED / always NULL since migration 051. Confidential report content '
  'lives in the deny-all report_evidence table. Never write this column.';
COMMENT ON COLUMN reports.attachment_snapshot IS
  'DEPRECATED / always NULL since migration 051. Confidential attachment evidence '
  'lives in the deny-all report_evidence table. Never write this column.';

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
