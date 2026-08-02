-- ===========================================================================
-- 061 — Content lifecycle: remove / restore / permanent purge   (Day 10C)
--
-- Governs POSTS, POST COMMENTS and EVENTS through five states:
--   active → removed → purge_pending → purged
--                    ↘ purge_failed ↗
--
-- DESIGN DECISION — WHY A SEPARATE TABLE AND NOT COLUMNS ON THE ENTITIES.
--   1. `public.events` is in the `supabase_realtime` publication. A lifecycle
--      COLUMN on events would broadcast a row change to every subscribed client
--      on every remove/restore. A table that is not published broadcasts nothing.
--   2. `trg_events_updated_at` bumps `events.updated_at` on ANY update, which
--      would silently re-order "recently updated" product surfaces.
--   3. The internal reason must never live in a student-readable row. A table
--      with ZERO RLS policies cannot leak it; a column on `posts` is one policy
--      mistake away from exposure.
--   4. One table = one transition function, one purge queue, one concurrency
--      model, one test suite — instead of three of each.
--
-- ABSENCE OF A ROW MEANS `active`. Only content that has left `active` at least
-- once has a row, so this table stays a vanishing fraction of all content — the
-- same posture 058 uses for account_restrictions. A restored item KEEPS its row
-- (state back to 'active') so restoration history survives.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No report adjudication, no enforcement workflow (Day 10D).
--   * No cross-platform synchronization parity work (Day 10E).
--   * No deleted-message privacy, no migration 051 (Day 10F).
--   * No change to migrations 054–060 or anything they created, EXCEPT the four
--     documented RLS-bypassing functions in §5 that would otherwise serve
--     removed content. Each is replaced from its VERBATIM production body,
--     captured 2026-08-01, with exactly one predicate added.
--   * No new table is added to the realtime publication.
-- ===========================================================================

BEGIN;

-- 055 created this in production; the guard keeps 061 self-contained on a
-- fresh shadow database.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 1. CANONICAL MODEL
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.content_lifecycle (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  entity_type        text NOT NULL CHECK (entity_type IN ('post','comment','event')),

  -- NO foreign key, deliberately — the same rule 055/058 apply. An FK to
  -- posts/events/profiles would let a student's own deletion, or a club cascade,
  -- destroy administrator enforcement evidence. Retention is a documented policy
  -- decision, not an accident of referential action. It is also what makes
  -- "account deletion cannot resurrect removed content" true by construction.
  entity_id          uuid NOT NULL,

  state              text NOT NULL
                       CHECK (state IN ('active','removed','purge_pending','purge_failed','purged')),

  -- Ownership snapshot taken at removal. Survives purge AND account deletion, so
  -- the audit trail stays meaningful after the entity row is redacted.
  owner_id           uuid,
  club_id            uuid,
  content_created_at timestamptz,

  -- ADMINISTRATOR-ONLY. Never exposed to a student by any path: this table has
  -- zero RLS policies and no PostgREST reachability.
  internal_reason    text CHECK (internal_reason IS NULL
                                 OR char_length(btrim(internal_reason)) BETWEEN 3 AND 500),

  removed_at             timestamptz,
  removed_by             uuid,
  removal_correlation_id uuid,

  restored_at            timestamptz,
  restored_by            uuid,

  purge_requested_at     timestamptz,
  purge_requested_by     uuid,
  purge_correlation_id   uuid,
  purge_attempts         int NOT NULL DEFAULT 0 CHECK (purge_attempts >= 0),
  purge_completed_at     timestamptz,
  purge_failed_at        timestamptz,

  -- Controlled vocabulary ONLY. Never a driver message, never a signed URL,
  -- never a stack trace — an administrator sees a category, not raw output.
  purge_failure_code     text CHECK (purge_failure_code IS NULL
                                     OR purge_failure_code IN (
                                       'storage_enumerate_failed',
                                       'storage_delete_failed',
                                       'storage_unreachable',
                                       'finalize_failed',
                                       'finalize_rejected',
                                       'outcome_persist_failed',
                                       'max_attempts_exceeded',
                                       'unknown')),

  storage_objects_total   int NOT NULL DEFAULT 0 CHECK (storage_objects_total   >= 0),
  storage_objects_deleted int NOT NULL DEFAULT 0 CHECK (storage_objects_deleted >= 0),

  -- Set when we could not even persist the outcome. Content stays hidden and the
  -- purge is NEVER falsely marked complete.
  reconciliation_required boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ── State/timestamp coherence. A row must not be able to lie about itself. ──
  CONSTRAINT cl_removed_evidence
    CHECK (state = 'active' OR (removed_at IS NOT NULL AND removed_by IS NOT NULL)),
  CONSTRAINT cl_purge_evidence
    CHECK (state IN ('active','removed')
           OR (purge_requested_at IS NOT NULL AND purge_requested_by IS NOT NULL)),
  CONSTRAINT cl_purged_evidence
    CHECK (state <> 'purged' OR purge_completed_at IS NOT NULL),
  CONSTRAINT cl_failed_evidence
    CHECK (state <> 'purge_failed' OR (purge_failed_at IS NOT NULL AND purge_failure_code IS NOT NULL)),
  -- A completed purge is terminal: nothing may claim completion unless it is purged.
  CONSTRAINT cl_completion_is_terminal
    CHECK (purge_completed_at IS NULL OR state = 'purged'),
  CONSTRAINT cl_deleted_within_total
    CHECK (storage_objects_deleted <= storage_objects_total)
);

COMMENT ON TABLE public.content_lifecycle IS
  'Administrator-controlled lifecycle state for posts, post comments and events '
  '(removed / purge_pending / purge_failed / purged). Absence of a row means '
  'active. No FK to content or profiles: enforcement history must survive '
  'account deletion, club cascades and payload redaction. Zero RLS policies — '
  'unreachable through PostgREST by any role.';

-- ONE lifecycle row per entity. This is what makes "no duplicate active
-- lifecycle record for the same entity" a database guarantee, not a convention.
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_lifecycle_entity
  ON public.content_lifecycle (entity_type, entity_id);

-- THE hot path: the student-read visibility probe. Partial, so it indexes only
-- non-active content and stays a page or two even at millions of rows.
CREATE INDEX IF NOT EXISTS idx_content_lifecycle_hidden
  ON public.content_lifecycle (entity_type, entity_id)
  WHERE state <> 'active';

-- Admin Dashboard "Removed content" listing, newest first.
CREATE INDEX IF NOT EXISTS idx_content_lifecycle_state_removed
  ON public.content_lifecycle (state, removed_at DESC);

-- Purge queue processing and failed-purge retry.
CREATE INDEX IF NOT EXISTS idx_content_lifecycle_purge_queue
  ON public.content_lifecycle (state, purge_requested_at)
  WHERE state IN ('purge_pending','purge_failed');

-- Reconciliation work that a human must look at.
CREATE INDEX IF NOT EXISTS idx_content_lifecycle_reconciliation
  ON public.content_lifecycle (updated_at DESC)
  WHERE reconciliation_required;

-- Trace an audit correlation id back to the lifecycle row it produced.
CREATE INDEX IF NOT EXISTS idx_content_lifecycle_removal_corr
  ON public.content_lifecycle (removal_correlation_id);
CREATE INDEX IF NOT EXISTS idx_content_lifecycle_purge_corr
  ON public.content_lifecycle (purge_correlation_id);

-- Append-mostly, exactly like account_restrictions: rows are inserted and
-- transitioned, never deleted by the application.
CREATE OR REPLACE FUNCTION private.content_lifecycle_block_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'content_lifecycle is append-only; rows transition, they are never deleted'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS content_lifecycle_no_delete ON public.content_lifecycle;
CREATE TRIGGER content_lifecycle_no_delete
  BEFORE DELETE ON public.content_lifecycle
  FOR EACH ROW EXECUTE FUNCTION private.content_lifecycle_block_delete();

DROP TRIGGER IF EXISTS content_lifecycle_no_truncate ON public.content_lifecycle;
CREATE TRIGGER content_lifecycle_no_truncate
  BEFORE TRUNCATE ON public.content_lifecycle
  FOR EACH STATEMENT EXECUTE FUNCTION private.content_lifecycle_block_delete();

ALTER TABLE public.content_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_lifecycle FORCE ROW LEVEL SECURITY;

-- ZERO policies, exactly like admin_audit_events and account_restrictions.
--
-- Supabase's DEFAULT PRIVILEGES grant service_role full DML on every new table
-- in `public`, so an explicit REVOKE is REQUIRED — granting SELECT alone is not
-- enough. (Learned during the Day 10B1 release, where user_blocks kept its
-- default DML until it was revoked explicitly.)
REVOKE ALL    ON public.content_lifecycle FROM anon;
REVOKE ALL    ON public.content_lifecycle FROM authenticated;
REVOKE ALL    ON public.content_lifecycle FROM service_role;
GRANT  SELECT ON public.content_lifecycle TO service_role;

-- ── Storage objects captured for a purge ───────────────────────────────────
-- Captured at purge-REQUEST time, BEFORE any payload redaction, so a retry can
-- always re-derive what to delete even after the payload is gone. This is what
-- makes the cross-system workflow durable rather than best-effort.
CREATE TABLE IF NOT EXISTS public.content_purge_objects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lifecycle_id  uuid NOT NULL REFERENCES public.content_lifecycle(id) ON DELETE RESTRICT,
  bucket        text NOT NULL CHECK (char_length(bucket) BETWEEN 1 AND 100),
  object_path   text NOT NULL CHECK (char_length(object_path) BETWEEN 1 AND 1024),
  -- FALSE when another LIVE entity still references the same object. Only
  -- uniquely-owned objects are ever deleted.
  uniquely_owned boolean NOT NULL,
  deleted_at    timestamptz,
  attempts      int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  failure_code  text CHECK (failure_code IS NULL
                            OR failure_code IN ('not_found','denied','unreachable','unknown')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.content_purge_objects IS
  'Storage objects captured at purge-request time from SECURED DATABASE STATE '
  '(never client input). Path traversal is impossible: paths are derived by '
  'storage_path_from_public_url() from the stored URL and re-validated here.';

-- A given object is captured once per lifecycle row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_purge_objects_target
  ON public.content_purge_objects (lifecycle_id, bucket, object_path);

CREATE INDEX IF NOT EXISTS idx_content_purge_objects_pending
  ON public.content_purge_objects (lifecycle_id)
  WHERE deleted_at IS NULL AND uniquely_owned;

ALTER TABLE public.content_purge_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_purge_objects FORCE ROW LEVEL SECURITY;

REVOKE ALL    ON public.content_purge_objects FROM anon;
REVOKE ALL    ON public.content_purge_objects FROM authenticated;
REVOKE ALL    ON public.content_purge_objects FROM service_role;
GRANT  SELECT ON public.content_purge_objects TO service_role;

CREATE OR REPLACE FUNCTION private.content_lifecycle_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_lifecycle_touch ON public.content_lifecycle;
CREATE TRIGGER content_lifecycle_touch
  BEFORE UPDATE ON public.content_lifecycle
  FOR EACH ROW EXECUTE FUNCTION private.content_lifecycle_touch();

COMMIT;

BEGIN;

-- ===========================================================================
-- 2. THE VISIBILITY PREDICATE
--
-- WHY THIS MUST BE SECURITY DEFINER — the single most dangerous trap here.
-- `content_lifecycle` has ZERO RLS policies. A plain
--     NOT EXISTS (SELECT 1 FROM content_lifecycle ...)
-- written inline in an RLS policy would be evaluated as `authenticated`, see
-- ZERO ROWS, and therefore always answer "visible" — every removed post would
-- stay fully readable while looking correct in review. A dedicated test asserts
-- this function is SECURITY DEFINER for exactly that reason.
--
-- ENUMERATION RESISTANCE.
-- PostgreSQL evaluates RLS policy expressions with the CALLER's privileges, so
-- this must be executable by `authenticated`. It is deliberately id-scoped and
-- boolean: it has NO listing form, and content_lifecycle itself is unreachable
-- through PostgREST. A student who already holds a uuid can learn one bit —
-- "not retrievable" — which they also learn from the content being gone. They
-- can never enumerate removed content, learn WHICH state it is in, who acted,
-- or why. This is the same class of id-scoped probe as the already-shipped
-- users_have_block_relationship(p_a, p_b).
--
-- The array-returning alternative (the 058 restricted_user_ids() shape) was
-- REJECTED: it would hand any student the complete list of removed content ids.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.content_is_student_visible(
  p_entity_type text, p_entity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.content_lifecycle cl
     WHERE cl.entity_type = p_entity_type
       AND cl.entity_id   = p_entity_id
       AND cl.state <> 'active'
  );
$$;

COMMENT ON FUNCTION public.content_is_student_visible(text, uuid) IS
  'TRUE unless the entity has a lifecycle row in a non-active state. Returns a '
  'boolean for ONE known id — never a list, never a state, never a reason.';

-- Administrator/worker-side: the actual state. NEVER granted to authenticated.
CREATE OR REPLACE FUNCTION private.content_state(p_entity_type text, p_entity_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT cl.state FROM public.content_lifecycle cl
      WHERE cl.entity_type = p_entity_type AND cl.entity_id = p_entity_id),
    'active');
$$;

-- ── Self-delete authorization (Phase 8) ────────────────────────────────────
-- WHY THIS IS A FUNCTION AND NOT AN INLINE POLICY TERM:
-- an `EXISTS (SELECT 1 FROM public.reports ...)` written directly inside an RLS
-- policy is itself evaluated as the CALLING role, so `reports`' own RLS applies
-- — and production's reports SELECT policy is `reporter_id = auth.uid()`. The
-- author of reported content is (by definition) not the reporter, sees zero
-- rows, and NOT EXISTS comes back TRUE. The evidence guard would have been a
-- silent no-op in Production. The shadow harness caught this; SECURITY DEFINER
-- is what actually makes the rule real.
--
-- It answers only for a caller who could genuinely perform the delete (owner,
-- or club officer for events), so it can never be used as a general
-- "is this content reported?" oracle.
CREATE OR REPLACE FUNCTION public.content_delete_allowed(
  p_entity_type text, p_entity_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_owner uuid;
  v_club  uuid;
BEGIN
  IF v_uid IS NULL OR p_entity_type NOT IN ('post','comment','event') THEN
    RETURN false;
  END IF;

  IF p_entity_type = 'post' THEN
    SELECT p.author_id, p.club_id INTO v_owner, v_club
      FROM public.posts p WHERE p.id = p_entity_id;
  ELSIF p_entity_type = 'comment' THEN
    SELECT c.user_id, NULL::uuid INTO v_owner, v_club
      FROM public.post_comments c WHERE c.id = p_entity_id;
  ELSE
    SELECT e.created_by, e.club_id INTO v_owner, v_club
      FROM public.events e WHERE e.id = p_entity_id;
  END IF;

  IF v_owner IS NULL THEN
    RETURN false;
  END IF;

  IF v_owner <> v_uid
     AND NOT (p_entity_type = 'event'
              AND v_club IS NOT NULL
              AND public.is_club_officer(v_club)) THEN
    RETURN false;
  END IF;

  -- Content under administrator lifecycle control is not the author's to destroy.
  IF private.content_state(p_entity_type, p_entity_id) <> 'active' THEN
    RETURN false;
  END IF;

  RETURN NOT private.content_has_open_report(p_entity_type, p_entity_id);
END;
$$;

COMMENT ON FUNCTION public.content_delete_allowed(text, uuid) IS
  'TRUE when the CALLER may self-delete this entity: they own it (or officer a '
  'club event), it is lifecycle-active, and it carries no open report. Returns '
  'false for everyone else, so it is not a report-status oracle.';

-- REVOKE FROM `authenticated` EXPLICITLY, not just PUBLIC. Supabase's ALTER
-- DEFAULT PRIVILEGES grants EXECUTE on every new public function to anon,
-- authenticated AND service_role as an EXPLICIT grant, which
-- `REVOKE ... FROM PUBLIC` does not remove. (058 §2 learned this the hard way.)
REVOKE ALL ON FUNCTION public.content_is_student_visible(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_is_student_visible(text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.content_delete_allowed(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_delete_allowed(text, uuid) TO authenticated, service_role;

COMMIT;

BEGIN;

-- ===========================================================================
-- 3. STUDENT-FACING ENFORCEMENT — ROW LEVEL SECURITY
--
-- A modified client or a raw PostgREST request must gain nothing. UI filtering
-- is not a control; this section is.
--
-- Every policy below is re-created from its VERBATIM production definition
-- (captured 2026-08-01) with the lifecycle term ANDed on. Nothing else changes:
-- the 057 block terms and the 058 access predicate are preserved exactly.
-- ===========================================================================

-- Every policy in this section is inert unless RLS is actually ENABLED on the
-- table. Production already has it enabled on all eight (verified 2026-08-01);
-- asserting it here is idempotent, costs nothing, and means the lifecycle
-- guarantee cannot be silently voided by a future table rebuild.
ALTER TABLE public.posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_club_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_rsvps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_events   ENABLE ROW LEVEL SECURITY;

-- ── posts ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "posts: authenticated read, block-aware" ON public.posts;
DROP POLICY IF EXISTS "posts: authenticated read, block-and-lifecycle-aware" ON public.posts;
CREATE POLICY "posts: authenticated read, block-and-lifecycle-aware"
  ON public.posts FOR SELECT TO authenticated
  USING (
        public.content_is_student_visible('post', id)
    AND (   (club_id IS NOT NULL)
         OR (author_id = (SELECT auth.uid()))
         OR (author_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])))
  );

-- The author may not edit removed content.
DROP POLICY IF EXISTS "posts: authors can update" ON public.posts;
CREATE POLICY "posts: authors can update"
  ON public.posts FOR UPDATE TO authenticated
  USING      (author_id = (SELECT auth.uid())
              AND (SELECT public.current_student_can_access_app())
              AND public.content_is_student_visible('post', id))
  WITH CHECK (author_id = (SELECT auth.uid())
              AND (SELECT public.current_student_can_access_app())
              AND public.content_is_student_visible('post', id));

-- SELF-DELETE vs ADMINISTRATOR REMOVAL (Phase 8).
-- Self-delete stays a real deletion — making it an administrator-style removal
-- would silently retain content a student asked to delete, which is a privacy
-- regression, not a security win. Two guards are added:
--   (a) content under administrator lifecycle control cannot be destroyed by
--       its author, and
--   (b) content with an UNRESOLVED report cannot be destroyed by its author,
--       so the existing evidence requirement is not bypassed.
DROP POLICY IF EXISTS "posts: authors can delete" ON public.posts;
CREATE POLICY "posts: authors can delete"
  ON public.posts FOR DELETE TO authenticated
  USING (
        author_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_delete_allowed('post', id)
  );

-- ── post_comments ──────────────────────────────────────────────────────────
-- A comment is hidden when the COMMENT is removed OR when its PARENT POST is.
DROP POLICY IF EXISTS "post_comments: authenticated read, block-aware" ON public.post_comments;
DROP POLICY IF EXISTS "post_comments: authenticated read, block-and-lifecycle-aware" ON public.post_comments;
CREATE POLICY "post_comments: authenticated read, block-and-lifecycle-aware"
  ON public.post_comments FOR SELECT TO authenticated
  USING (
        public.content_is_student_visible('comment', id)
    AND public.content_is_student_visible('post', post_id)
    AND (   (user_id = (SELECT auth.uid()))
         OR (user_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])))
  );

-- No new comments on a removed post. (Also covers the Option-B reply rule the
-- day threading ships: a reply is a comment, and its parent must be visible.)
DROP POLICY IF EXISTS "post_comments: users insert own" ON public.post_comments;
CREATE POLICY "post_comments: users insert own"
  ON public.post_comments FOR INSERT TO authenticated
  WITH CHECK (
        user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('post', post_id)
    AND NOT EXISTS (SELECT 1 FROM public.posts p
                     WHERE p.id = post_comments.post_id
                       AND p.author_id = ANY ((SELECT public.blocked_user_ids())::uuid[]))
  );

DROP POLICY IF EXISTS "post_comments: users delete own" ON public.post_comments;
CREATE POLICY "post_comments: users delete own"
  ON public.post_comments FOR DELETE TO authenticated
  USING (
        user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_delete_allowed('comment', id)
    AND public.content_is_student_visible('post', post_id)
  );

-- ── post_likes ─────────────────────────────────────────────────────────────
-- Existing likes remain READABLE while a post is removed (the post itself is
-- hidden, so nothing leaks) — this is what makes "preserve existing likes" and
-- "restore returns engagement" true. New likes on removed posts are denied.
DROP POLICY IF EXISTS "post_likes: users manage own" ON public.post_likes;
CREATE POLICY "post_likes: users manage own"
  ON public.post_likes FOR ALL TO authenticated
  USING      (user_id = (SELECT auth.uid())
              AND (SELECT public.current_student_can_access_app()))
  WITH CHECK (user_id = (SELECT auth.uid())
              AND (SELECT public.current_student_can_access_app())
              AND public.content_is_student_visible('post', post_id)
              AND NOT EXISTS (SELECT 1 FROM public.posts p
                               WHERE p.id = post_likes.post_id
                                 AND p.author_id = ANY ((SELECT public.blocked_user_ids())::uuid[])));

-- ── post_club_tags ─────────────────────────────────────────────────────────
-- Was `USING (true)` for role `public` — i.e. readable by `anon`. It carries no
-- payload, but it let anyone enumerate (post_id, club_id) pairs. Narrowed to
-- authenticated AND gated on post visibility so removed posts are not
-- discoverable through their tags.
DROP POLICY IF EXISTS post_club_tags_select_public ON public.post_club_tags;
DROP POLICY IF EXISTS post_club_tags_select_authenticated ON public.post_club_tags;
CREATE POLICY post_club_tags_select_authenticated
  ON public.post_club_tags FOR SELECT TO authenticated
  USING (public.content_is_student_visible('post', post_id));

-- ── events ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "events: visibility-aware read" ON public.events;
DROP POLICY IF EXISTS "events: visibility-and-lifecycle-aware read" ON public.events;
CREATE POLICY "events: visibility-and-lifecycle-aware read"
  ON public.events FOR SELECT TO authenticated
  USING (
        public.content_is_student_visible('event', id)
    AND (   (visibility = 'everyone')
         OR (created_by = (SELECT auth.uid()))
         OR public.is_club_officer(club_id)
         OR (visibility = 'members' AND EXISTS (
               SELECT 1 FROM public.club_members cm
                WHERE cm.club_id = events.club_id AND cm.user_id = (SELECT auth.uid())))
         OR (visibility = 'specific' AND specific_user_ids IS NOT NULL
             AND (SELECT auth.uid()) = ANY (specific_user_ids)))
  );

-- Officers cannot edit or delete removed events through the student/officer path.
DROP POLICY IF EXISTS "events: officers can update/delete" ON public.events;
CREATE POLICY "events: officers can update/delete"
  ON public.events FOR UPDATE TO authenticated
  USING (public.is_club_officer(club_id)
         AND (SELECT public.current_student_can_access_app())
         AND public.content_is_student_visible('event', id));

DROP POLICY IF EXISTS "events: officers can delete" ON public.events;
CREATE POLICY "events: officers can delete"
  ON public.events FOR DELETE TO authenticated
  USING (
        public.is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
    AND public.content_delete_allowed('event', id)
  );

-- ── event_rsvps / saved_events ─────────────────────────────────────────────
-- Existing rows stay readable (hidden behind the event itself); new ones are
-- denied for removed events.
DROP POLICY IF EXISTS "event_rsvps: users manage own" ON public.event_rsvps;
CREATE POLICY "event_rsvps: users manage own"
  ON public.event_rsvps FOR ALL TO authenticated
  USING      (user_id = (SELECT auth.uid())
              AND (SELECT public.current_student_can_access_app()))
  WITH CHECK (user_id = (SELECT auth.uid())
              AND (SELECT public.current_student_can_access_app())
              AND public.content_is_student_visible('event', event_id));

DROP POLICY IF EXISTS "saved_events: users manage own" ON public.saved_events;
CREATE POLICY "saved_events: users manage own"
  ON public.saved_events FOR ALL TO authenticated
  USING      (user_id = (SELECT auth.uid())
              AND (SELECT public.current_student_can_access_app()))
  WITH CHECK (user_id = (SELECT auth.uid())
              AND (SELECT public.current_student_can_access_app())
              AND public.content_is_student_visible('event', event_id));

COMMIT;

BEGIN;

-- ===========================================================================
-- 4. AUDIT CATALOG
--
-- `post`, `comment` and `event` are already permitted target_types by the 055
-- CHECK, so NO constraint change is needed. The four cross-entity worker actions
-- use `system`, which is also already permitted.
--
-- WHY THE WORKER OUTCOMES HAVE requires_reason = FALSE:
-- they are machine outcomes, not human decisions. The human reason is captured
-- ONCE on purgeRequested and linked by correlation_id. Forcing the worker to
-- supply a reason would make it invent one, which is worse than honest.
-- ===========================================================================

INSERT INTO public.admin_audit_actions (action, target_type, sensitivity, requires_reason, description) VALUES
  ('post.remove',            'post',    'destructive', TRUE,
   'Hide a post from students, preserving it for administrator review and restoration.'),
  ('post.restore',           'post',    'sensitive',   TRUE,
   'Return a removed post to authorized student surfaces.'),
  ('post.purgeRequested',    'post',    'destructive', TRUE,
   'Begin the irreversible permanent purge of a post.'),
  ('post.purgeCompleted',    'post',    'destructive', TRUE,
   'A post purge finished: payload redacted and uniquely-owned media deleted.'),
  ('post.purgeFailed',       'post',    'sensitive',   FALSE,
   'A post purge attempt failed. Content stays hidden and retry remains available.'),

  ('comment.remove',         'comment', 'destructive', TRUE,
   'Hide a comment from students, preserving it for administrator review.'),
  ('comment.restore',        'comment', 'sensitive',   TRUE,
   'Return a removed comment to its exact original position.'),
  ('comment.purgeRequested', 'comment', 'destructive', TRUE,
   'Begin the irreversible permanent purge of a comment.'),
  ('comment.purgeCompleted', 'comment', 'destructive', TRUE,
   'A comment purge finished: body irreversibly cleared.'),
  ('comment.purgeFailed',    'comment', 'sensitive',   FALSE,
   'A comment purge attempt failed. Content stays hidden and retry remains available.'),

  ('event.remove',           'event',   'destructive', TRUE,
   'Hide an event from students, preserving RSVPs and media for review.'),
  ('event.restore',          'event',   'sensitive',   TRUE,
   'Return a removed event to authorized student surfaces.'),
  ('event.purgeRequested',   'event',   'destructive', TRUE,
   'Begin the irreversible permanent purge of an event.'),
  ('event.purgeCompleted',   'event',   'destructive', TRUE,
   'An event purge finished: payload redacted and dependent records deleted.'),
  ('event.purgeFailed',      'event',   'sensitive',   FALSE,
   'An event purge attempt failed. Content stays hidden and retry remains available.'),

  ('content.purgeRetry',                'system', 'sensitive',   TRUE,
   'Re-queue a failed permanent purge.'),
  ('content.purgeStorageAttempt',       'system', 'sensitive',   FALSE,
   'Storage deletion for a purge is about to be attempted.'),
  ('content.purgeStorageSuccess',       'system', 'sensitive',   FALSE,
   'Uniquely-owned Storage objects for a purge were deleted.'),
  ('content.purgeStorageFailure',       'system', 'sensitive',   FALSE,
   'Storage deletion for a purge failed. Content stays hidden.'),
  ('content.purgeReconciliationRequired','system','destructive', TRUE,
   'A purge outcome could not be persisted. Content stays hidden and is never marked complete.')
ON CONFLICT (action) DO NOTHING;

COMMIT;

BEGIN;

-- ===========================================================================
-- 5. CLOSING THE RLS-BYPASSING READ PATHS
--
-- RLS does nothing for a SECURITY DEFINER function, which runs as its owner by
-- design. These four would otherwise keep serving removed content no matter how
-- correct §3 is. Each body below is the VERBATIM production definition captured
-- 2026-08-01, with EXACTLY ONE predicate added and nothing else changed.
-- ===========================================================================

-- ── 5a. Realtime private-broadcast authorizers (migration 050) ─────────────
-- Without this a client stays subscribed to a removed post's/event's topic and
-- keeps receiving like / comment / RSVP broadcasts about it.
CREATE OR REPLACE FUNCTION private.can_receive_post_interaction(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ '^post:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN EXISTS (SELECT 1 FROM public.posts p
                    WHERE p.id = pg_catalog.substr(p_topic, 6)::uuid)
           AND public.content_is_student_visible('post', pg_catalog.substr(p_topic, 6)::uuid)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION private.can_receive_event_interaction(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ '^event:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN EXISTS (SELECT 1 FROM public.events e
                    WHERE e.id = pg_catalog.substr(p_topic, 7)::uuid)
           AND public.content_is_student_visible('event', pg_catalog.substr(p_topic, 7)::uuid)
    ELSE false
  END;
$$;

-- ── 5b. Event discovery ────────────────────────────────────────────────────
-- SECURITY DEFINER, so §3's events policy does not apply to it at all.
-- The DEFAULTS are part of the production signature (p_limit 20, p_offset 0).
-- Omitting them makes CREATE OR REPLACE fail with "cannot remove parameter
-- defaults from existing function" — caught by the harness, not by inspection.
CREATE OR REPLACE FUNCTION public.get_discovery_events__inner(
  p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid, title text, emoji text, event_date date,
  start_time time without time zone, end_time time without time zone,
  location text, cover_image_url text, club_id uuid, club_name text,
  club_avatar_url text, member_count integer,
  is_saved boolean, user_rsvp_status text, match_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me uuid := public.assert_self_or_null(p_user_id);
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.title, e.emoji, e.event_date, e.start_time, e.end_time, e.location,
    e.cover_image_url, e.club_id, c.name, c.avatar_url, c.member_count,
    EXISTS(SELECT 1 FROM public.saved_events se
            WHERE se.user_id = v_me AND se.event_id = e.id) AS is_saved,
    (SELECT er.status::TEXT FROM public.event_rsvps er
      WHERE er.user_id = v_me AND er.event_id = e.id LIMIT 1) AS user_rsvp_status,
    (SELECT COUNT(DISTINCT ea.activity)::INT FROM public.event_activities ea
      WHERE ea.event_id = e.id
        AND EXISTS (SELECT 1 FROM public.user_activities ua
                     WHERE ua.user_id = v_me AND ua.activity = ea.activity)) AS match_count
  FROM public.events e
  JOIN public.clubs c ON c.id = e.club_id
  WHERE e.event_date >= CURRENT_DATE
    AND c.is_active = true
    AND public.content_is_student_visible('event', e.id)   -- ← 061
    AND (
      e.visibility = 'everyone'
      OR (e.visibility = 'members'
          AND EXISTS (SELECT 1 FROM public.club_members cm
                       WHERE cm.club_id = e.club_id AND cm.user_id = v_me))
      OR (e.visibility = 'specific' AND v_me = ANY(e.specific_user_ids))
    )
  ORDER BY match_count DESC, e.event_date ASC, e.start_time ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_discovery_events__inner(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_discovery_events__inner(uuid, integer, integer)
  TO service_role;

-- ── 5c. Event reminders ────────────────────────────────────────────────────
-- Runs as service_role on the 5-minute heartbeat and reads `events` directly.
-- Without the filter a REMOVED event still generates reminder notifications AND
-- leaks its title into push copy ("<title> is tomorrow.").
--
-- Only the three reminder inserts and the last-chance insert gain the predicate;
-- everything else is the verbatim production body.
CREATE OR REPLACE FUNCTION public.process_event_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_catchup  INT := notification_config_int('reminder.catchup_window_minutes', 30);
  v_inserted INT := 0;
  v_n        INT;
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('event_reminder_tomorrow', notification_config_int('reminder.tomorrow_lead_minutes', 1440)),
      ('event_reminder_hour',     notification_config_int('reminder.hour_lead_minutes', 60)),
      ('event_reminder_now',      notification_config_int('reminder.now_lead_minutes', 0))
    ) AS k(kind, lead_minutes)
  LOOP
    INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key)
    SELECT
      rv.user_id, e.created_by, r.kind, e.id, 'event', false,
      CASE r.kind
        WHEN 'event_reminder_tomorrow' THEN e.title || ' is tomorrow.'
        WHEN 'event_reminder_hour'     THEN e.title || ' starts in one hour.'
        ELSE e.title || ' is starting now.'
      END,
      r.kind || ':' || e.id || ':' ||
        extract(epoch FROM event_start_ts(e.event_date, e.start_time))::bigint || ':' || rv.user_id
    FROM events e
    JOIN event_rsvps rv ON rv.event_id = e.id AND rv.status = 'going'
    WHERE now() >= event_start_ts(e.event_date, e.start_time) - make_interval(mins => r.lead_minutes)
      AND now() <  event_start_ts(e.event_date, e.start_time) - make_interval(mins => r.lead_minutes)
                   + make_interval(mins => v_catchup)
      AND event_start_ts(e.event_date, e.start_time) > now() - interval '5 minutes'
      AND public.content_is_student_visible('event', e.id)   -- ← 061
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_inserted := v_inserted + v_n;
  END LOOP;

  INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key)
  SELECT
    m.user_id, e.created_by, 'event_last_chance', e.id, 'event', false,
    'Last chance to RSVP to ' || e.title || '.',
    'event_last_chance:' || e.id || ':' ||
      extract(epoch FROM event_start_ts(e.event_date, e.start_time))::bigint || ':' || m.user_id
  FROM events e
  JOIN LATERAL (
    SELECT cm.user_id FROM club_members cm
    WHERE cm.club_id = e.club_id AND e.visibility IN ('everyone','members')
    UNION
    SELECT uid FROM unnest(COALESCE(e.specific_user_ids, ARRAY[]::uuid[])) AS uid
    WHERE e.visibility = 'specific'
  ) m ON true
  WHERE m.user_id <> COALESCE(e.created_by, m.user_id)
    AND now() >= event_start_ts(e.event_date, e.start_time)
                 - make_interval(mins => notification_config_int('reminder.last_chance_lead_minutes', 360))
    AND now() <  event_start_ts(e.event_date, e.start_time)
                 - make_interval(mins => notification_config_int('reminder.last_chance_lead_minutes', 360))
                 + make_interval(mins => v_catchup)
    AND event_start_ts(e.event_date, e.start_time) > now()
    AND public.content_is_student_visible('event', e.id)   -- ← 061
    AND NOT EXISTS (
      SELECT 1 FROM event_rsvps rv WHERE rv.event_id = e.id AND rv.user_id = m.user_id
    )
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_inserted := v_inserted + v_n;

  PERFORM process_social_proof_events();

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.process_event_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_event_reminders() TO service_role;

-- ── 5d. Officer RPCs that mutate a post ────────────────────────────────────
-- These are the 058-generated WRAPPERS (not hand-written bodies), so re-creating
-- them freezes nothing. The 058 restriction guard is preserved EXACTLY and the
-- lifecycle guard is added ahead of the inner call.
CREATE OR REPLACE FUNCTION public.remove_post_from_club(p_post_id uuid, p_club_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT public.current_student_can_access_app() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF NOT public.content_is_student_visible('post', p_post_id) THEN
    RAISE EXCEPTION 'content_unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM public.remove_post_from_club__inner(p_post_id, p_club_id);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_post_from_club(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_post_from_club(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_club_photo_everywhere(p_photo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_post_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT public.current_student_can_access_app() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT cp.post_id INTO v_post_id FROM public.club_photos cp WHERE cp.id = p_photo_id;
  IF v_post_id IS NOT NULL
     AND NOT public.content_is_student_visible('post', v_post_id) THEN
    RAISE EXCEPTION 'content_unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM public.delete_club_photo_everywhere__inner(p_photo_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_club_photo_everywhere(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_club_photo_everywhere(uuid) TO authenticated;

COMMIT;

BEGIN;

-- ===========================================================================
-- 6. SHARED HELPERS FOR THE ADMINISTRATOR MUTATIONS
-- ===========================================================================

-- Sanitized snapshot for before_state / after_state.
-- NOTE THE OMISSIONS: no caption, no comment body, no event description, no
-- location, no media URL. internal_reason is NOT included either — it already
-- lives in admin_audit_events.reason, and duplicating it into a JSONB blob would
-- double the disclosure surface for no benefit (the 058 rule).
CREATE OR REPLACE FUNCTION private.content_snap(p_entity_type text, p_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state text := private.content_state(p_entity_type, p_entity_id);
  v_deps  jsonb := '{}'::jsonb;
BEGIN
  IF p_entity_type = 'post' THEN
    SELECT jsonb_build_object(
             'likes',      (SELECT count(*) FROM public.post_likes     l WHERE l.post_id = p_entity_id),
             'comments',   (SELECT count(*) FROM public.post_comments  c WHERE c.post_id = p_entity_id),
             'clubTags',   (SELECT count(*) FROM public.post_club_tags t WHERE t.post_id = p_entity_id),
             'clubPhotos', (SELECT count(*) FROM public.club_photos    p WHERE p.post_id = p_entity_id),
             'sharedInMessages',
                           (SELECT count(*) FROM public.messages       m WHERE m.shared_post_id = p_entity_id),
             'hasMedia',   (SELECT (image_url IS NOT NULL) FROM public.posts WHERE id = p_entity_id))
      INTO v_deps;
  ELSIF p_entity_type = 'event' THEN
    SELECT jsonb_build_object(
             'rsvps',       (SELECT count(*) FROM public.event_rsvps      r WHERE r.event_id = p_entity_id),
             'savedBy',     (SELECT count(*) FROM public.saved_events     s WHERE s.event_id = p_entity_id),
             'activities',  (SELECT count(*) FROM public.event_activities a WHERE a.event_id = p_entity_id),
             'interests',   (SELECT count(*) FROM public.event_interests  i WHERE i.event_id = p_entity_id),
             'linkedPosts', (SELECT count(*) FROM public.posts            p WHERE p.linked_event_id = p_entity_id),
             'sharedInMessages',
                            (SELECT count(*) FROM public.messages         m WHERE m.shared_event_id = p_entity_id),
             'hasMedia',    (SELECT (cover_image_url IS NOT NULL) FROM public.events WHERE id = p_entity_id))
      INTO v_deps;
  ELSE
    v_deps := jsonb_build_object(
      'parentPostId', (SELECT post_id FROM public.post_comments WHERE id = p_entity_id));
  END IF;

  RETURN jsonb_build_object(
    'entityType', p_entity_type,
    'entityId',   p_entity_id,
    'state',      v_state,
    'exists',     CASE p_entity_type
                    WHEN 'post'    THEN EXISTS (SELECT 1 FROM public.posts         WHERE id = p_entity_id)
                    WHEN 'event'   THEN EXISTS (SELECT 1 FROM public.events        WHERE id = p_entity_id)
                    ELSE                EXISTS (SELECT 1 FROM public.post_comments WHERE id = p_entity_id)
                  END,
    'dependencies', v_deps);
END;
$$;

-- Owner/club/created_at for the lifecycle snapshot. Structural identifiers only.
CREATE OR REPLACE FUNCTION private.content_owner_snapshot(p_entity_type text, p_entity_id uuid)
RETURNS TABLE (owner_id uuid, club_id uuid, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.author_id, p.club_id, p.created_at FROM public.posts p
   WHERE p_entity_type = 'post' AND p.id = p_entity_id
  UNION ALL
  SELECT e.created_by, e.club_id, e.created_at FROM public.events e
   WHERE p_entity_type = 'event' AND e.id = p_entity_id
  UNION ALL
  SELECT c.user_id, NULL::uuid, c.created_at FROM public.post_comments c
   WHERE p_entity_type = 'comment' AND c.id = p_entity_id
  LIMIT 1;
$$;

-- Does an UNRESOLVED report still need the original payload?
--
-- Day 10C's ONLY report obligation: do not destroy evidence Day 10D will need.
-- There is NO evidence-snapshot mechanism for post/comment/event reports in the
-- schema (reports.content_snapshot is message-specific), so the honest answer is
-- to BLOCK the purge rather than copy full content into append-only audit
-- history as a substitute — which would defeat the point of purging.
CREATE OR REPLACE FUNCTION private.content_purge_blocked_by_report(
  p_entity_type text, p_entity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_entity_type IN ('post','event')
     AND EXISTS (
       SELECT 1 FROM public.reports r
        WHERE r.entity_type = p_entity_type
          AND r.entity_id   = p_entity_id
          AND r.status IN ('pending','reviewing')
          -- An adequate snapshot would satisfy the requirement; none exists for
          -- these entity types today, so this term is always false. It is written
          -- explicitly so Day 10D only has to populate the column.
          AND COALESCE(btrim(r.content_snapshot), '') = ''
     );
$$;

-- Open-report test used by the STUDENT self-delete rule (Phase 8). Deliberately
-- separate from content_purge_blocked_by_report: the snapshot relaxation above
-- is a purge-time concession, whereas a student may never delete their way out
-- of an open report regardless of what evidence exists.
CREATE OR REPLACE FUNCTION private.content_has_open_report(
  p_entity_type text, p_entity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_entity_type IN ('post','event')
     AND EXISTS (
       SELECT 1 FROM public.reports r
        WHERE r.entity_type = p_entity_type
          AND r.entity_id   = p_entity_id
          AND r.status IN ('pending','reviewing')
     );
$$;

-- Reason validity, enforced in the DATABASE and not only in the Server Action.
-- The 055 audit table already CHECKs 3..500, but a raw constraint violation is a
-- 500-shaped surprise; every transition validates first and fails honestly with
-- `invalid_reason` so the administrator sees the real cause. Whitespace-only is
-- rejected because btrim() collapses it to the empty string.
-- Failure codes are a CATEGORY vocabulary, not free text: an administrator sees
-- a category, never a driver message, a signed URL or a stack trace. A code the
-- worker did not have a category for degrades to 'unknown' rather than raising
-- a CHECK violation, because an erroring failure-recorder would turn an ordinary
-- retryable failure into a reconciliation — strictly worse for the same event.
CREATE OR REPLACE FUNCTION private.content_failure_code(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN btrim(COALESCE(p_code, '')) IN (
      'storage_enumerate_failed','storage_delete_failed','storage_unreachable',
      'finalize_failed','finalize_rejected','outcome_persist_failed',
      'max_attempts_exceeded','unknown')
    THEN btrim(p_code)
    ELSE 'unknown'
  END;
$$;

CREATE OR REPLACE FUNCTION private.content_reason_ok(p_reason text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT char_length(btrim(COALESCE(p_reason, ''))) BETWEEN 3 AND 500;
$$;

-- Entity-scoped serialization. Concurrent remove-vs-restore, restore-vs-purge
-- and duplicate purge requests all serialize here; the loser then observes the
-- winner's COMMITTED state and fails with a real code instead of racing.
CREATE OR REPLACE FUNCTION private.content_lock(p_entity_type text, p_entity_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_advisory_xact_lock(
    hashtextextended('content_lifecycle:' || p_entity_type || ':' || p_entity_id::text, 0));
$$;

COMMIT;

BEGIN;

-- ===========================================================================
-- 7. THE TRANSITION CORE
--
-- One implementation, three thin per-entity public wrappers each (§8), so there
-- is NO generic arbitrary-table mutation endpoint: entity_type is a closed
-- 3-value vocabulary, every table is named literally, and there is no dynamic
-- SQL anywhere in this section.
-- ===========================================================================

CREATE OR REPLACE FUNCTION private.content_remove_impl(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_entity_type text, p_entity_id uuid, p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta   jsonb := jsonb_build_object('entityType', p_entity_type, 'entityId', p_entity_id);
  before jsonb;
  v_state text;
  v_owner uuid; v_club uuid; v_created timestamptz;
  v_exists boolean;
BEGIN
  IF NOT private.content_reason_ok(p_reason) THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'invalid_reason');
  END IF;

  PERFORM private.content_lock(p_entity_type, p_entity_id);

  SELECT owner_id, club_id, created_at
    INTO v_owner, v_club, v_created
    FROM private.content_owner_snapshot(p_entity_type, p_entity_id);

  v_exists := v_created IS NOT NULL;
  IF NOT v_exists THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'not_found');
  END IF;

  before  := private.content_snap(p_entity_type, p_entity_id);
  v_state := private.content_state(p_entity_type, p_entity_id);

  IF v_state = 'removed' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'already_removed');
  END IF;
  IF v_state IN ('purge_pending','purge_failed') THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'purge_in_progress');
  END IF;
  IF v_state = 'purged' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'already_purged');
  END IF;

  INSERT INTO public.content_lifecycle
    (entity_type, entity_id, state, owner_id, club_id, content_created_at,
     internal_reason, removed_at, removed_by, removal_correlation_id)
  VALUES
    (p_entity_type, p_entity_id, 'removed', v_owner, v_club, v_created,
     btrim(p_reason), now(), p_actor_id, p_correlation_id)
  ON CONFLICT (entity_type, entity_id) DO UPDATE
     SET state = 'removed',
         internal_reason = btrim(p_reason),
         removed_at = now(),
         removed_by = p_actor_id,
         removal_correlation_id = p_correlation_id,
         restored_at = NULL,
         restored_by = NULL;

  -- Cancel pending push work that exists ONLY for this content. Notifications
  -- themselves are deliberately KEPT (deleting them would rewrite a student's
  -- history); they resolve through RLS to the generic unavailable state.
  DELETE FROM public.push_queue q
   WHERE q.status = 'pending'
     AND EXISTS (SELECT 1 FROM public.notifications n
                  WHERE n.id = q.notification_id
                    AND n.entity_id = p_entity_id
                    AND n.entity_type = p_entity_type);

  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                             p_reason, before, private.content_snap(p_entity_type, p_entity_id),
                             meta, p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.content_restore_impl(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_entity_type text, p_entity_id uuid, p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta   jsonb := jsonb_build_object('entityType', p_entity_type, 'entityId', p_entity_id);
  before jsonb;
  v_state text;
  v_owner uuid; v_club uuid; v_created timestamptz;
  v_parent uuid;
BEGIN
  IF NOT private.content_reason_ok(p_reason) THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'invalid_reason');
  END IF;

  PERFORM private.content_lock(p_entity_type, p_entity_id);

  before  := private.content_snap(p_entity_type, p_entity_id);
  v_state := private.content_state(p_entity_type, p_entity_id);

  IF v_state = 'active' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'not_removed');
  END IF;
  IF v_state = 'purged' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'already_purged');
  END IF;
  IF v_state IN ('purge_pending','purge_failed') THEN
    -- Restoration is permanently disabled the moment purge begins.
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'purge_in_progress');
  END IF;

  -- ── Structural validity. Restore must FAIL SAFELY, never half-succeed. ────
  SELECT owner_id, club_id, created_at
    INTO v_owner, v_club, v_created
    FROM private.content_owner_snapshot(p_entity_type, p_entity_id);

  IF v_created IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'not_found');
  END IF;

  -- Owner must still exist (posts/events/comments all cascade from profiles, so
  -- a missing owner means the row should not have survived at all).
  IF v_owner IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_owner) THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'owner_missing');
  END IF;

  -- Required club must still exist. An INACTIVE club is allowed on purpose: the
  -- content stays hidden by the club's own inactivity rules, whereas refusing
  -- would strand it permanently.
  IF v_club IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = v_club) THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'club_missing');
  END IF;

  -- A comment cannot come back under a parent post that is gone or not active.
  IF p_entity_type = 'comment' THEN
    SELECT post_id INTO v_parent FROM public.post_comments WHERE id = p_entity_id;
    IF v_parent IS NULL OR NOT EXISTS (SELECT 1 FROM public.posts WHERE id = v_parent) THEN
      RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                   meta,p_correlation_id,'parent_missing');
    END IF;
    IF private.content_state('post', v_parent) <> 'active' THEN
      RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                   meta,p_correlation_id,'parent_unavailable');
    END IF;
  END IF;

  -- The lifecycle row is UPDATED, never deleted, and the ENTITY ROW IS NOT
  -- TOUCHED. That is what structurally guarantees the Phase 5/6/7 promises:
  -- original timestamps are preserved, engagement is untouched, no AFTER INSERT
  -- notification trigger can fire, and no unread count moves.
  UPDATE public.content_lifecycle
     SET state = 'active', restored_at = now(), restored_by = p_actor_id
   WHERE entity_type = p_entity_type AND entity_id = p_entity_id;

  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                             p_reason, before, private.content_snap(p_entity_type, p_entity_id),
                             meta, p_correlation_id);
END;
$$;

-- ── Purge REQUEST: removed → purge_pending, capturing storage objects ──────
CREATE OR REPLACE FUNCTION private.content_request_purge_impl(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_entity_type text, p_entity_id uuid, p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta      jsonb := jsonb_build_object('entityType', p_entity_type, 'entityId', p_entity_id);
  before    jsonb;
  v_state   text;
  v_life    uuid;
  v_url     text;
  v_path    text;
  v_bucket  text := 'posts';   -- posts AND event covers both live here (audited)
  v_unique  boolean;
  v_total   int := 0;
BEGIN
  IF NOT private.content_reason_ok(p_reason) THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'invalid_reason');
  END IF;

  PERFORM private.content_lock(p_entity_type, p_entity_id);

  before  := private.content_snap(p_entity_type, p_entity_id);
  v_state := private.content_state(p_entity_type, p_entity_id);

  -- NO DIRECT active → purge. Content must be removed and reviewed first.
  IF v_state = 'active' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'invalid_transition');
  END IF;
  IF v_state = 'purged' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'already_purged');
  END IF;
  IF v_state IN ('purge_pending','purge_failed') THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'purge_in_progress');
  END IF;

  IF private.content_purge_blocked_by_report(p_entity_type, p_entity_id) THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'evidence_required');
  END IF;

  SELECT id INTO v_life FROM public.content_lifecycle
   WHERE entity_type = p_entity_type AND entity_id = p_entity_id;

  -- ── Capture storage objects BEFORE any redaction ────────────────────────
  -- Paths are derived from SECURED DATABASE STATE via the existing
  -- storage_path_from_public_url(), never from client input, so path traversal
  -- and cross-user deletion are structurally impossible.
  IF p_entity_type = 'post' THEN
    SELECT image_url INTO v_url FROM public.posts WHERE id = p_entity_id;
  ELSIF p_entity_type = 'event' THEN
    SELECT cover_image_url INTO v_url FROM public.events WHERE id = p_entity_id;
  ELSE
    v_url := NULL;   -- comments have no media in this schema
  END IF;

  IF v_url IS NOT NULL THEN
    v_path := public.storage_path_from_public_url(v_url, v_bucket);
    -- NULL means the URL is not a Supabase object in this bucket (production
    -- holds picsum.photos seed URLs). Skipping is correct — reporting a failure
    -- for something we never owned would be dishonest.
    IF v_path IS NOT NULL AND btrim(v_path) <> '' AND v_path NOT LIKE '%..%' THEN
      -- Uniquely owned = no OTHER live entity references the same object.
      -- Checked across ALL THREE tables because posts, event covers and club
      -- photos share the `posts` bucket (verified against production).
      v_unique := NOT EXISTS (
          SELECT 1 FROM public.posts p
           WHERE p.image_url = v_url AND p.id IS DISTINCT FROM p_entity_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.events e
           WHERE e.cover_image_url = v_url AND e.id IS DISTINCT FROM p_entity_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.club_photos c
           WHERE c.url = v_url AND c.post_id IS DISTINCT FROM p_entity_id);

      INSERT INTO public.content_purge_objects (lifecycle_id, bucket, object_path, uniquely_owned)
      VALUES (v_life, v_bucket, v_path, COALESCE(v_unique, false))
      ON CONFLICT (lifecycle_id, bucket, object_path) DO NOTHING;

      IF COALESCE(v_unique, false) THEN v_total := 1; END IF;
    END IF;
  END IF;

  UPDATE public.content_lifecycle
     SET state = 'purge_pending',
         purge_requested_at = now(),
         purge_requested_by = p_actor_id,
         purge_correlation_id = p_correlation_id,
         purge_attempts = 0,
         purge_failure_code = NULL,
         purge_failed_at = NULL,
         storage_objects_total = v_total,
         storage_objects_deleted = 0
   WHERE id = v_life;

  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,
                             p_reason, before, private.content_snap(p_entity_type, p_entity_id),
                             meta || jsonb_build_object('storageObjects', v_total),
                             p_correlation_id);
END;
$$;

COMMIT;

BEGIN;

-- ===========================================================================
-- 8. NARROW PER-ENTITY ADMINISTRATOR MUTATIONS
--
-- Twelve explicitly-named functions. No generic endpoint, no dynamic SQL, no
-- caller-supplied table or column anywhere.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.admin_tx_post_remove(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_post_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.content_remove_impl(p_actor_id,p_actor_email,p_reason,p_correlation_id,'post',p_post_id,'post.remove');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_post_restore(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_post_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.content_restore_impl(p_actor_id,p_actor_email,p_reason,p_correlation_id,'post',p_post_id,'post.restore');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_post_request_purge(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_post_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.content_request_purge_impl(p_actor_id,p_actor_email,p_reason,p_correlation_id,'post',p_post_id,'post.purgeRequested');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_comment_remove(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_comment_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.content_remove_impl(p_actor_id,p_actor_email,p_reason,p_correlation_id,'comment',p_comment_id,'comment.remove');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_comment_restore(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_comment_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.content_restore_impl(p_actor_id,p_actor_email,p_reason,p_correlation_id,'comment',p_comment_id,'comment.restore');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_comment_request_purge(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_comment_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.content_request_purge_impl(p_actor_id,p_actor_email,p_reason,p_correlation_id,'comment',p_comment_id,'comment.purgeRequested');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_event_remove(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.content_remove_impl(p_actor_id,p_actor_email,p_reason,p_correlation_id,'event',p_event_id,'event.remove');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_event_restore(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.content_restore_impl(p_actor_id,p_actor_email,p_reason,p_correlation_id,'event',p_event_id,'event.restore');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_event_request_purge(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_event_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.content_request_purge_impl(p_actor_id,p_actor_email,p_reason,p_correlation_id,'event',p_event_id,'event.purgeRequested');
$$;

-- ── Retry a FAILED purge: purge_failed → purge_pending ────────────────────
CREATE OR REPLACE FUNCTION public.admin_tx_content_retry_purge(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_entity_type text, p_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta jsonb := jsonb_build_object('entityType', p_entity_type, 'entityId', p_entity_id);
  before jsonb; v_state text;
BEGIN
  IF p_entity_type NOT IN ('post','comment','event') THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'content.purgeRetry','system',p_entity_id,
                                 meta,p_correlation_id,'invalid_target');
  END IF;
  IF NOT private.content_reason_ok(p_reason) THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'content.purgeRetry','system',p_entity_id,
                                 meta,p_correlation_id,'invalid_reason');
  END IF;

  PERFORM private.content_lock(p_entity_type, p_entity_id);
  before  := private.content_snap(p_entity_type, p_entity_id);
  v_state := private.content_state(p_entity_type, p_entity_id);

  IF v_state = 'purged' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'content.purgeRetry','system',p_entity_id,
                                 meta,p_correlation_id,'already_purged');
  END IF;
  IF v_state <> 'purge_failed' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'content.purgeRetry','system',p_entity_id,
                                 meta,p_correlation_id,'invalid_transition');
  END IF;

  UPDATE public.content_lifecycle
     SET state = 'purge_pending', purge_failure_code = NULL, purge_failed_at = NULL
   WHERE entity_type = p_entity_type AND entity_id = p_entity_id;

  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,'content.purgeRetry','system',p_entity_id,
                             p_reason, before, private.content_snap(p_entity_type, p_entity_id),
                             meta, p_correlation_id);
END;
$$;

DO $grants$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'admin_tx_post_remove(uuid,text,text,uuid,uuid)',
    'admin_tx_post_restore(uuid,text,text,uuid,uuid)',
    'admin_tx_post_request_purge(uuid,text,text,uuid,uuid)',
    'admin_tx_comment_remove(uuid,text,text,uuid,uuid)',
    'admin_tx_comment_restore(uuid,text,text,uuid,uuid)',
    'admin_tx_comment_request_purge(uuid,text,text,uuid,uuid)',
    'admin_tx_event_remove(uuid,text,text,uuid,uuid)',
    'admin_tx_event_restore(uuid,text,text,uuid,uuid)',
    'admin_tx_event_request_purge(uuid,text,text,uuid,uuid)',
    'admin_tx_content_retry_purge(uuid,text,text,uuid,text,uuid)'
  ] LOOP
    -- No EXCEPTION handler: these are created immediately above, so a failure
    -- here is a real defect and must be loud.
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role;', fn);
  END LOOP;
END
$grants$;

COMMIT;

BEGIN;

-- ===========================================================================
-- 9. PURGE WORKER SURFACE  (service_role only)
--
-- The lifecycle row IS the durable job record — there is no second queue table
-- that could diverge from it.
-- ===========================================================================

-- Claim work. FOR UPDATE SKIP LOCKED so concurrent workers never double-process
-- (the same shape claim_push_batch uses).
CREATE OR REPLACE FUNCTION public.content_purge_claim_batch(p_limit integer DEFAULT 10)
RETURNS TABLE (
  lifecycle_id uuid, entity_type text, entity_id uuid,
  correlation_id uuid, attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT cl.id
      FROM public.content_lifecycle cl
     WHERE cl.state = 'purge_pending'
     ORDER BY cl.purge_requested_at
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 100))
  )
  UPDATE public.content_lifecycle c
     SET purge_attempts = c.purge_attempts + 1
    FROM claimed
   WHERE c.id = claimed.id
  RETURNING c.id, c.entity_type, c.entity_id, c.purge_correlation_id, c.purge_attempts;
END;
$$;

-- Objects the worker should delete: uniquely-owned and not yet deleted.
CREATE OR REPLACE FUNCTION public.content_purge_pending_objects(p_lifecycle_id uuid)
RETURNS TABLE (object_id uuid, bucket text, object_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.id, o.bucket, o.object_path
    FROM public.content_purge_objects o
   WHERE o.lifecycle_id = p_lifecycle_id
     AND o.uniquely_owned
     AND o.deleted_at IS NULL;
$$;

-- Record one object's outcome. Idempotent: an already-deleted object (or one
-- that was never there) converges to deleted, because a purge that finds its
-- object already gone HAS achieved its goal.
CREATE OR REPLACE FUNCTION public.content_purge_record_object(
  p_object_id uuid, p_deleted boolean, p_failure_code text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_failure_code IS NOT NULL
     AND p_failure_code NOT IN ('not_found','denied','unreachable','unknown') THEN
    RAISE EXCEPTION 'content_purge_record_object: unknown failure code %', p_failure_code
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.content_purge_objects
     SET attempts = attempts + 1,
         deleted_at = CASE WHEN p_deleted OR p_failure_code = 'not_found'
                           THEN COALESCE(deleted_at, now()) ELSE deleted_at END,
         failure_code = CASE WHEN p_deleted OR p_failure_code = 'not_found'
                             THEN NULL ELSE p_failure_code END
   WHERE id = p_object_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'content_purge_record_object: unknown object %', p_object_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

-- ── FINALIZE: purge_pending → purged, in ONE transaction ──────────────────
--
-- ORDER IS LOAD-BEARING FOR EVENTS. `trg_event_updated_notify` fires AFTER
-- UPDATE on events and notifies every 'going' RSVP when location/date/time
-- changes. Redacting an event's location BEFORE deleting its RSVPs would send
-- every attendee "The location for <title> changed." Dependents are therefore
-- ALWAYS deleted first, which leaves the trigger with no recipients.
CREATE OR REPLACE FUNCTION public.content_purge_finalize(
  p_actor_id uuid, p_actor_email text, p_correlation_id uuid,
  p_entity_type text, p_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta    jsonb := jsonb_build_object('entityType', p_entity_type, 'entityId', p_entity_id);
  action  text  := p_entity_type || '.purgeCompleted';
  before  jsonb;
  v_state text;
  v_life  uuid;
  v_undeleted int;
  v_comments  int := 0;
  v_reason    text;
BEGIN
  IF p_entity_type NOT IN ('post','comment','event') THEN
    RAISE EXCEPTION 'content_purge_finalize: invalid entity type %', p_entity_type
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM private.content_lock(p_entity_type, p_entity_id);

  -- The authorizing reason is the one the administrator gave when they REQUESTED
  -- the purge. The worker carries it forward rather than inventing one, so every
  -- destructive audit row still names a human justification and the whole
  -- request→completion chain reads coherently under one correlation id.
  SELECT id, state, internal_reason INTO v_life, v_state, v_reason
    FROM public.content_lifecycle
   WHERE entity_type = p_entity_type AND entity_id = p_entity_id;

  -- IDEMPOTENT: a duplicate finalization (lost response, retried worker) is a
  -- no-op that reports the truth rather than writing a second completion record.
  IF v_state = 'purged' THEN
    RETURN jsonb_build_object('status','ok','already',true);
  END IF;
  IF v_state IS NULL OR v_state NOT IN ('purge_pending','purge_failed') THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'invalid_transition');
  END IF;

  -- Never finalize while a uniquely-owned object is still undeleted: that would
  -- claim a purge is complete while the media is still retrievable.
  SELECT count(*) INTO v_undeleted FROM public.content_purge_objects o
   WHERE o.lifecycle_id = v_life AND o.uniquely_owned AND o.deleted_at IS NULL;
  IF v_undeleted > 0 THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'storage_incomplete');
  END IF;

  before := private.content_snap(p_entity_type, p_entity_id);

  IF p_entity_type = 'post' THEN
    -- Dependent comments follow the approved comment-purge model: body cleared
    -- irreversibly, lifecycle recorded, row deleted (comments are leaves).
    INSERT INTO public.content_lifecycle
      (entity_type, entity_id, state, owner_id, content_created_at,
       removed_at, removed_by, purge_requested_at, purge_requested_by,
       purge_correlation_id, purge_completed_at)
    SELECT 'comment', c.id, 'purged', c.user_id, c.created_at,
           now(), p_actor_id, now(), p_actor_id, p_correlation_id, now()
      FROM public.post_comments c WHERE c.post_id = p_entity_id
    ON CONFLICT (entity_type, entity_id) DO UPDATE
       SET state = 'purged', purge_completed_at = now(),
           purge_correlation_id = p_correlation_id,
           purge_requested_at = COALESCE(public.content_lifecycle.purge_requested_at, now()),
           purge_requested_by = COALESCE(public.content_lifecycle.purge_requested_by, p_actor_id),
           removed_at = COALESCE(public.content_lifecycle.removed_at, now()),
           removed_by = COALESCE(public.content_lifecycle.removed_by, p_actor_id);
    GET DIAGNOSTICS v_comments = ROW_COUNT;

    UPDATE public.post_comments SET content = '' WHERE post_id = p_entity_id;
    DELETE FROM public.post_comments WHERE post_id = p_entity_id;

    DELETE FROM public.post_likes     WHERE post_id = p_entity_id;
    DELETE FROM public.post_club_tags WHERE post_id = p_entity_id;
    DELETE FROM public.club_photos    WHERE post_id = p_entity_id;
    UPDATE public.messages SET shared_post_id = NULL WHERE shared_post_id = p_entity_id;

    -- Irreversible redaction of the payload. The row survives so reports and
    -- audit records stay resolvable, and so no delete-trigger fires.
    UPDATE public.posts
       SET caption = NULL, image_url = NULL, linked_event_id = NULL, club_id = NULL
     WHERE id = p_entity_id;

  ELSIF p_entity_type = 'event' THEN
    -- DEPENDENTS FIRST — see the header note about trg_event_updated_notify.
    DELETE FROM public.event_rsvps      WHERE event_id = p_entity_id;
    DELETE FROM public.saved_events     WHERE event_id = p_entity_id;
    DELETE FROM public.event_activities WHERE event_id = p_entity_id;
    DELETE FROM public.event_interests  WHERE event_id = p_entity_id;
    UPDATE public.messages SET shared_event_id = NULL WHERE shared_event_id = p_entity_id;
    UPDATE public.posts    SET linked_event_id = NULL WHERE linked_event_id = p_entity_id;

    UPDATE public.events
       SET title = '[removed]',        -- NOT NULL, so a neutral placeholder
           description = NULL, location = NULL, building = NULL, room = NULL,
           cover_image_url = NULL, emoji = NULL, specific_user_ids = NULL
     WHERE id = p_entity_id;

  ELSE  -- comment
    UPDATE public.post_comments SET content = '' WHERE id = p_entity_id;
    DELETE FROM public.post_comments WHERE id = p_entity_id;
  END IF;

  -- Pending push work for this content can never be delivered now.
  DELETE FROM public.push_queue q
   WHERE q.status = 'pending'
     AND EXISTS (SELECT 1 FROM public.notifications n
                  WHERE n.id = q.notification_id
                    AND n.entity_id = p_entity_id
                    AND n.entity_type = p_entity_type);

  UPDATE public.content_lifecycle
     SET state = 'purged',
         purge_completed_at = now(),
         purge_failure_code = NULL,
         purge_failed_at = NULL,
         reconciliation_required = false,
         storage_objects_deleted = (SELECT count(*) FROM public.content_purge_objects o
                                     WHERE o.lifecycle_id = v_life AND o.deleted_at IS NOT NULL)
   WHERE id = v_life;

  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,action,p_entity_type,p_entity_id,
                             v_reason, before, private.content_snap(p_entity_type, p_entity_id),
                             meta || jsonb_build_object('purgedComments', v_comments),
                             p_correlation_id);
END;
$$;

-- ── Record a failed attempt: purge_pending → purge_failed ─────────────────
CREATE OR REPLACE FUNCTION public.content_purge_mark_failed(
  p_actor_id uuid, p_actor_email text, p_correlation_id uuid,
  p_entity_type text, p_entity_id uuid, p_failure_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta   jsonb := jsonb_build_object('entityType', p_entity_type, 'entityId', p_entity_id);
  action text  := p_entity_type || '.purgeFailed';
  v_state text;
BEGIN
  IF p_entity_type NOT IN ('post','comment','event') THEN
    RAISE EXCEPTION 'content_purge_mark_failed: invalid entity type %', p_entity_type
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM private.content_lock(p_entity_type, p_entity_id);
  v_state := private.content_state(p_entity_type, p_entity_id);

  -- A late failure report must NEVER un-purge completed work.
  IF v_state = 'purged' THEN
    RETURN jsonb_build_object('status','ok','already',true);
  END IF;
  IF v_state NOT IN ('purge_pending','purge_failed') THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,action,p_entity_type,p_entity_id,
                                 meta,p_correlation_id,'invalid_transition');
  END IF;

  UPDATE public.content_lifecycle
     SET state = 'purge_failed',
         purge_failed_at = now(),
         purge_failure_code = private.content_failure_code(p_failure_code)
   WHERE entity_type = p_entity_type AND entity_id = p_entity_id;

  PERFORM public.admin_audit_log(
    p_actor_user_id => p_actor_id, p_actor_email => p_actor_email,
    p_action => action, p_target_type => p_entity_type, p_target_id => p_entity_id,
    p_metadata => meta, p_error_code => private.content_failure_code(p_failure_code),
    p_correlation_id => p_correlation_id, p_event_type => 'failure');

  RETURN jsonb_build_object('status','ok');
END;
$$;

-- ── Storage lifecycle audit events (attempt / success / failure) ───────────
CREATE OR REPLACE FUNCTION public.content_purge_audit_storage(
  p_actor_id uuid, p_actor_email text, p_correlation_id uuid,
  p_entity_id uuid, p_phase text, p_object_count integer,
  p_failure_code text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_action text;
BEGIN
  v_action := CASE p_phase
                WHEN 'attempt' THEN 'content.purgeStorageAttempt'
                WHEN 'success' THEN 'content.purgeStorageSuccess'
                WHEN 'failure' THEN 'content.purgeStorageFailure'
                ELSE NULL END;
  IF v_action IS NULL THEN
    RAISE EXCEPTION 'content_purge_audit_storage: unknown phase %', p_phase
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.admin_audit_log(
    p_actor_user_id => p_actor_id, p_actor_email => p_actor_email,
    p_action => v_action, p_target_type => 'system', p_target_id => p_entity_id,
    -- Object COUNT only. Never a path, never a bucket URL, never a signed URL.
    p_metadata => jsonb_build_object('storageObjects', COALESCE(p_object_count, 0)),
    p_error_code => CASE WHEN p_phase = 'failure'
                         THEN COALESCE(NULLIF(p_failure_code,''),'unknown') ELSE NULL END,
    p_correlation_id => p_correlation_id,
    p_event_type => CASE p_phase WHEN 'attempt' THEN 'attempt'
                                 WHEN 'success' THEN 'success'
                                 ELSE 'failure' END);
END;
$$;

-- ── Reconciliation: the outcome itself could not be persisted ──────────────
-- Content stays hidden, the purge is NEVER falsely marked complete, and durable
-- work is created for a human.
CREATE OR REPLACE FUNCTION public.content_purge_mark_reconciliation(
  p_actor_id uuid, p_actor_email text, p_correlation_id uuid,
  p_entity_type text, p_entity_id uuid, p_failure_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reason text;
BEGIN
  IF p_entity_type NOT IN ('post','comment','event') THEN
    RAISE EXCEPTION 'content_purge_mark_reconciliation: invalid entity type %', p_entity_type
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT internal_reason INTO v_reason FROM public.content_lifecycle
   WHERE entity_type = p_entity_type AND entity_id = p_entity_id;

  UPDATE public.content_lifecycle
     SET reconciliation_required = true,
         purge_failure_code = private.content_failure_code(
                                COALESCE(NULLIF(p_failure_code,''), 'outcome_persist_failed'))
   WHERE entity_type = p_entity_type AND entity_id = p_entity_id
     AND state <> 'purged';

  PERFORM public.admin_audit_log(
    p_actor_user_id => p_actor_id, p_actor_email => p_actor_email,
    p_action => 'content.purgeReconciliationRequired',
    p_target_type => 'system', p_target_id => p_entity_id,
    p_reason => v_reason,
    p_metadata => jsonb_build_object('entityType', p_entity_type),
    p_error_code => private.content_failure_code(
                      COALESCE(NULLIF(p_failure_code,''), 'outcome_persist_failed')),
    p_correlation_id => p_correlation_id,
    p_event_type => 'reconciliation_required');
END;
$$;

DO $wgrants$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'content_purge_claim_batch(integer)',
    'content_purge_pending_objects(uuid)',
    'content_purge_record_object(uuid,boolean,text)',
    'content_purge_finalize(uuid,text,uuid,text,uuid)',
    'content_purge_mark_failed(uuid,text,uuid,text,uuid,text)',
    'content_purge_audit_storage(uuid,text,uuid,uuid,text,integer,text)',
    'content_purge_mark_reconciliation(uuid,text,uuid,text,uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role;', fn);
  END LOOP;
END
$wgrants$;

COMMIT;
