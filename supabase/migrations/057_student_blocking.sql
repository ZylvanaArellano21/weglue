-- ===========================================================================
-- 057 — Student-to-student blocking  (Day 10B1)
--
-- Adds the canonical `user_blocks` model and enforces it SERVER-SIDE across
-- discovery, follows, personal content, direct messaging, notifications and
-- push. A modified client or a raw PostgREST request gains nothing.
--
-- TERMINOLOGY — read this before changing anything in here.
--   * A STUDENT BLOCK is what this migration implements: a directional row in
--     `user_blocks`, owned by the blocker, that PREVENTS INTERACTION IN BOTH
--     DIRECTIONS. It is a student's own choice about their own experience.
--   * An ADMINISTRATOR RESTRICTION (suspension / platform block) is a DIFFERENT
--     system, arriving in migration 058 (Day 10B2), with its own table, its own
--     vocabulary and its own audit trail.
--   There is deliberately NO shared "blocked" column, type, function or label
--   between the two. Do not introduce one.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No administrator suspension or platform block (that is 058).
--   * No change to account deletion — `user_blocks` cascades from `profiles`,
--     so `delete_own_account_atomic()` needs no edit at all.
--   * No content soft-delete, no deleted-message retention, no migration 051.
--   * No Storage change. Public buckets stay public (documented limitation).
--   * No administrator write is enabled. ADMIN_WRITES_ENABLED is untouched.
--
-- THE APPROVED PRODUCT BEHAVIOUR (founder decisions 2 + 3)
--   Personal / social content  →  hidden between the blocked pair.
--   OFFICIAL club + event content  →  ALWAYS VISIBLE, even when its author is
--   blocked. A student who blocks an officer must not lose the club's
--   announcements, events or safety information. The technical distinction is
--   `posts.club_id IS NULL` (personal) vs `IS NOT NULL` (official).
--   Shared group and club conversations  →  NOT filtered. Blocking severs
--   DIRECT contact; it does not censor a room both people chose to join.
--
-- PERFORMANCE CONTRACT — the reason the predicates look the way they do.
--   `blocked_user_ids()` takes NO ARGUMENTS. Because nothing in its call
--   depends on the row being scanned, it is not correlated with the scan, and
--   wrapping every call site as `(SELECT public.blocked_user_ids())` forces
--   PostgreSQL to evaluate it ONCE PER STATEMENT as an InitPlan and then reuse
--   the result as a constant. Row filtering then costs an array comparison
--   against a constant — no subquery, no join, no I/O per row.
--
--   `users_may_interact(a, b)` takes TWO arguments and is therefore
--   ROW-CORRELATED. It is for RPCs and one-shot server checks ONLY.
--   NEVER put it in a policy on profiles / posts / messages / notifications.
-- ===========================================================================

BEGIN;

-- Migration 055 already created this in production; the guard keeps 057
-- self-contained so it can be applied to a fresh shadow database on its own.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 1. CANONICAL MODEL
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.user_blocks (
  -- Directional and owned: `blocker_id` is the student who chose this.
  blocker_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Server-generated. No client-supplied timestamp is ever trusted.
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Uniqueness for the pair, and the "who have I blocked" lookup index.
  CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_no_self CHECK (blocker_id <> blocked_id)
);

COMMENT ON TABLE public.user_blocks IS
  'Student-to-student blocks. Directional ownership (blocker_id owns the row), '
  'symmetric prevention (interaction is blocked in BOTH directions). NOT related '
  'to administrator suspension/platform blocking, which is a separate system.';

-- The PK covers blocker_id -> blocked_id. This covers the REVERSE direction,
-- which the symmetric predicate needs on every single evaluation.
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON public.user_blocks (blocked_id, blocker_id);

-- FK cascade targets: PostgreSQL needs an index on the referencing columns to
-- avoid a seq scan when a referenced profiles row is deleted. The PK serves
-- blocker_id; idx_user_blocks_blocked serves blocked_id. Both covered.

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks FORCE ROW LEVEL SECURITY;

-- The ONLY student-facing policy. A blocked user querying this table gets zero
-- rows, so they cannot enumerate who blocked them. There is no aggregate,
-- count, or reverse lookup exposed anywhere.
DROP POLICY IF EXISTS "user_blocks: blocker reads own" ON public.user_blocks;
CREATE POLICY "user_blocks: blocker reads own"
  ON public.user_blocks FOR SELECT TO authenticated
  USING (blocker_id = (SELECT auth.uid()));

-- No INSERT / UPDATE / DELETE policy exists, by design. Mutation is RPC-only
-- so that "insert the block" and "delete the follows" cannot be split into two
-- client round trips, which would leave a Gluemate surviving a block.
REVOKE ALL     ON public.user_blocks FROM anon;
REVOKE ALL     ON public.user_blocks FROM authenticated;
-- Supabase's DEFAULT PRIVILEGES grant service_role full DML on every new table
-- in `public`, so granting SELECT is not enough — the defaults must be revoked
-- explicitly or service_role keeps INSERT/UPDATE/DELETE/TRUNCATE. This mirrors
-- what migration 055 established for admin_audit_events: a safety table is
-- readable by the server and mutable ONLY through SECURITY DEFINER functions.
-- (Caught during the Day 10B1 production release and corrected there; folded in
-- here so a fresh environment reproduces the reviewed posture on its own.)
REVOKE ALL     ON public.user_blocks FROM service_role;
GRANT  SELECT  ON public.user_blocks TO authenticated;
GRANT  SELECT  ON public.user_blocks TO service_role;

-- ===========================================================================
-- 2. CENTRALIZED PREDICATES
--
-- All SECURITY DEFINER (they read a table the caller cannot fully see), all
-- STABLE, all with an empty search_path and fully-qualified names.
-- Every authorization decision uses auth.uid(). None accepts an identity.
-- ===========================================================================

-- THE hot-path set. Every uuid the CURRENT user cannot interact with, in either
-- direction. Argument-free on purpose — see the performance contract above.
CREATE OR REPLACE FUNCTION public.blocked_user_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT other), ARRAY[]::uuid[])
  FROM (
    SELECT ub.blocked_id AS other
      FROM public.user_blocks ub
     WHERE ub.blocker_id = (SELECT auth.uid())
    UNION
    SELECT ub.blocker_id
      FROM public.user_blocks ub
     WHERE ub.blocked_id = (SELECT auth.uid())
  ) s
  WHERE other IS NOT NULL;
$$;

COMMENT ON FUNCTION public.blocked_user_ids() IS
  'Every user id the CURRENT user cannot interact with (either direction). '
  'Argument-free so call sites can wrap it as (SELECT public.blocked_user_ids()) '
  'and get a once-per-statement InitPlan instead of a per-row evaluation.';

-- Symmetric relationship test for an arbitrary pair. ROW-CORRELATED — RPC and
-- one-shot server use only, never in a policy over a high-volume table.
CREATE OR REPLACE FUNCTION public.users_have_block_relationship(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_a IS NOT NULL AND p_b IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_blocks ub
     WHERE (ub.blocker_id = p_a AND ub.blocked_id = p_b)
        OR (ub.blocker_id = p_b AND ub.blocked_id = p_a)
  );
$$;

-- May these two students interact at all? Day 10B1 knows only about blocks.
-- Day 10B2 will extend this ONE function with the administrator-restriction
-- term, so every call site inherits it without being edited again.
CREATE OR REPLACE FUNCTION public.users_may_interact(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_a IS NOT NULL
     AND p_b IS NOT NULL
     AND NOT public.users_have_block_relationship(p_a, p_b);
$$;

-- "Have I blocked them?" — directional, the caller's own row only.
CREATE OR REPLACE FUNCTION public.current_user_blocks(p_target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks ub
     WHERE ub.blocker_id = (SELECT auth.uid())
       AND ub.blocked_id = p_target
  );
$$;

-- "Is interaction with this user unavailable?" — symmetric, and deliberately
-- does NOT reveal WHICH direction. A client can learn that a profile is
-- unavailable; it can never learn that it was the other person who blocked.
CREATE OR REPLACE FUNCTION public.target_is_blocked_from_current_user(p_target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_target IS NOT NULL
     AND p_target = ANY ((SELECT public.blocked_user_ids())::uuid[]);
$$;

REVOKE ALL ON FUNCTION public.blocked_user_ids()                          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.users_have_block_relationship(uuid, uuid)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.users_may_interact(uuid, uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_blocks(uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.target_is_blocked_from_current_user(uuid)   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.blocked_user_ids()                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.users_have_block_relationship(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.users_may_interact(uuid, uuid)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_blocks(uuid)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.target_is_blocked_from_current_user(uuid) TO authenticated, service_role;

-- ===========================================================================
-- 2b. PAIR SERIALIZATION — the concurrent block/follow race
--
-- FOUND BY A REAL TWO-SESSION TEST, not by inspection:
--
--   session 1: BEGIN; block_user(C)            -- deletes follows, holds open
--   session 2:        INSERT INTO follows ...  -- RLS reads user_blocks
--   session 1: COMMIT
--
-- Under READ COMMITTED, session 2's policy check could not see session 1's
-- uncommitted block row, so the follow passed the WITH CHECK; and session 1 had
-- already run its DELETE before that row existed. Final state: a block AND a
-- live follow between the same pair — a persistent, user-visible inconsistency
-- and exactly the "concurrent follow and block" case that must fail safely.
--
-- RLS alone cannot fix this: a policy is evaluated against the caller's
-- snapshot, and no snapshot sees an uncommitted row. The two paths have to be
-- SERIALIZED, so both take the same transaction-scoped advisory lock, keyed on
-- the unordered pair. Whichever transaction arrives second blocks until the
-- first commits, then re-reads committed state and does the right thing.
--
-- Advisory locking is the pattern migration 054 already uses for the per-club
-- officer floor (`club_officer_lock_key`), so this is consistent with how the
-- codebase already serializes a cross-row invariant.
-- ===========================================================================

CREATE OR REPLACE FUNCTION private.user_pair_lock_key(p_a uuid, p_b uuid)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- Order-independent: (A,B) and (B,A) must map to the SAME key, or the two
  -- directions would take different locks and never serialize against
  -- each other.
  SELECT ('x' || substr(
            md5(least(p_a::text, p_b::text) || '|' || greatest(p_a::text, p_b::text)),
            1, 16))::bit(64)::bigint;
$$;

-- Re-check a follow at INSERT/UPDATE time, holding the pair lock.
--
-- This is the SECOND barrier, not a replacement for the RLS policy. The policy
-- rejects the common case cheaply and without a lock; this trigger closes the
-- concurrent window the policy structurally cannot see.
CREATE OR REPLACE FUNCTION public.follows_block_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(private.user_pair_lock_key(NEW.follower_id, NEW.following_id));
  IF public.users_have_block_relationship(NEW.follower_id, NEW.following_id) THEN
    RAISE EXCEPTION 'interaction_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_follows_block_guard ON public.follows;
CREATE TRIGGER trg_follows_block_guard
  BEFORE INSERT OR UPDATE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.follows_block_guard();

-- The same race exists for a direct message sent as a block commits.
--
-- SCOPED DELIBERATELY: the lock is taken ONLY for `direct` conversations. Group
-- and club messages — the overwhelming majority of message volume — take no
-- lock and pay only one cheap `conversations.type` lookup, because blocking
-- never restricts a shared room (founder decision 2).
CREATE OR REPLACE FUNCTION public.messages_block_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_other uuid;
BEGIN
  IF NEW.sender_id IS NULL THEN RETURN NEW; END IF;

  SELECT cp.user_id INTO v_other
    FROM public.conversations c
    JOIN public.conversation_participants cp ON cp.conversation_id = c.id
   WHERE c.id = NEW.conversation_id
     AND c.type = 'direct'
     AND cp.user_id <> NEW.sender_id
   LIMIT 1;

  IF v_other IS NULL THEN RETURN NEW; END IF;  -- not a direct conversation

  PERFORM pg_advisory_xact_lock(private.user_pair_lock_key(NEW.sender_id, v_other));
  IF public.users_have_block_relationship(NEW.sender_id, v_other) THEN
    RAISE EXCEPTION 'interaction_unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_block_guard ON public.messages;
CREATE TRIGGER trg_messages_block_guard
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_block_guard();

-- ===========================================================================
-- 3. ATOMIC BLOCK / UNBLOCK RPCs
-- ===========================================================================

-- Block a student. ONE transaction: the block row, the removal of BOTH follow
-- directions (which is what makes the Gluemate relationship disappear), and the
-- hiding of any shared direct conversation from the blocker's inbox.
--
-- IDEMPOTENT: blocking someone already blocked returns {status:'ok',
-- already_blocked:true} rather than an error. An error would be a side channel
-- and would make the client's retry path worse for no benefit.
CREATE OR REPLACE FUNCTION public.block_user(p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me       uuid := (SELECT auth.uid());
  v_existed  boolean;
  v_follows  int := 0;
  v_hidden   int := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_target IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_target');
  END IF;

  IF p_target = v_me THEN
    RETURN jsonb_build_object('status', 'self_target');
  END IF;

  -- The target must be a real STUDENT. Platform-admin identities have no
  -- public.profiles row (migration 053), so this single check refuses them
  -- along with deleted and never-existent accounts — and it does so without
  -- disclosing which of those three it was.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_target) THEN
    RETURN jsonb_build_object('status', 'user_not_found');
  END IF;

  -- Belt and braces: refuse an auth identity explicitly marked platform_admin
  -- even in the impossible case that it also holds a profiles row.
  IF EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = p_target
       AND public.is_platform_admin_auth(u.raw_app_meta_data)
  ) THEN
    RETURN jsonb_build_object('status', 'user_not_found');
  END IF;

  -- Serialize against a concurrent follow or direct message for THIS pair.
  --
  -- The key is order-independent, so it is the same lock the follows and
  -- messages guards take, and it is transaction-scoped, so it is released on
  -- COMMIT/ROLLBACK with no cleanup path to get wrong. A concurrent follow that
  -- arrives mid-block now waits here, then re-reads committed state and is
  -- correctly rejected — rather than slipping past a policy that could not yet
  -- see the block row.
  --
  -- Two students blocking each other simultaneously take the SAME key, so one
  -- simply waits for the other; there is no lock-ordering deadlock to avoid.
  PERFORM pg_advisory_xact_lock(private.user_pair_lock_key(v_me, p_target));

  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (v_me, p_target)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  v_existed := NOT FOUND;

  -- BOTH directions. This is what makes the mutual-follow (Gluemate)
  -- relationship disappear immediately: Gluemate is DERIVED from two accepted
  -- follows, so deleting either row ends it. There is no gluemate table to
  -- update and no cached flag to invalidate.
  --
  -- The delete fires trg_follow_delete_notify -> handle_follow_delete(), which
  -- was read in full during the audit: it emits NOTHING. It only deletes a
  -- stale 'follow_request' notification when a PENDING follow is removed. So
  -- this step is not merely non-disclosing, it actively cleans a pending
  -- request out of the other person's notification list.
  DELETE FROM public.follows f
   WHERE (f.follower_id = v_me      AND f.following_id = p_target)
      OR (f.follower_id = p_target  AND f.following_id = v_me);
  GET DIAGNOSTICS v_follows = ROW_COUNT;

  -- Hide any shared DIRECT conversation from the BLOCKER's inbox only, using
  -- the `hidden_at` column that already exists for exactly this purpose. The
  -- blocked person's inbox is untouched — changing it would be a disclosure.
  -- History is preserved for both; nothing is deleted or rewritten.
  UPDATE public.conversation_participants cp
     SET hidden_at = now()
   WHERE cp.user_id = v_me
     AND cp.hidden_at IS NULL
     AND cp.conversation_id IN (
           SELECT c.id
             FROM public.conversations c
             JOIN public.conversation_participants me
                   ON me.conversation_id = c.id AND me.user_id = v_me
             JOIN public.conversation_participants them
                   ON them.conversation_id = c.id AND them.user_id = p_target
            WHERE c.type = 'direct'
         );
  GET DIAGNOSTICS v_hidden = ROW_COUNT;

  -- Cancel any push that has not gone out yet and would announce the newly
  -- blocked person. Best effort by design: `push_queue` has no actor column, so
  -- this joins through the originating notification. Anything already marked
  -- 'sent' cannot be recalled from APNs/FCM — see the honest limit in §8 of the
  -- architecture document.
  DELETE FROM public.push_queue pq
   WHERE pq.status = 'pending'
     AND pq.user_id IN (v_me, p_target)
     AND EXISTS (
           SELECT 1 FROM public.notifications n
            WHERE n.id = pq.notification_id
              AND ((n.user_id = v_me     AND n.actor_id = p_target)
                OR (n.user_id = p_target AND n.actor_id = v_me))
         );

  -- NO notification is created for the blocked person. Not here, not by a
  -- trigger, not anywhere. That is enforced structurally in section 6.
  RETURN jsonb_build_object(
    'status',           'ok',
    'already_blocked',  v_existed,
    'follows_removed',  v_follows,
    'conversations_hidden', v_hidden
  );
END;
$$;

-- Remove ONLY the caller's own directional block.
-- Restores NOTHING: no follow, no Gluemate, no conversation visibility.
-- IDEMPOTENT: unblocking someone who is not blocked returns
-- {status:'ok', was_blocked:false}. It reveals nothing about blocks owned by
-- other users, because it only ever touches rows where blocker_id = auth.uid().
CREATE OR REPLACE FUNCTION public.unblock_user(p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me      uuid := (SELECT auth.uid());
  v_removed int  := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_target IS NULL OR p_target = v_me THEN
    RETURN jsonb_build_object('status', 'ok', 'was_blocked', false);
  END IF;

  -- Same pair lock as block_user and the three guards, so the whole
  -- block/unblock/follow/message family is TOTALLY serialized per pair.
  --
  -- Unblocking without it is already fail-SAFE (a follow racing an uncommitted
  -- unblock still sees the block and is rejected, which is the conservative
  -- outcome), but it produces a confusing rejection immediately after the user
  -- taps Unblock. Serializing removes that surprise without weakening anything.
  PERFORM pg_advisory_xact_lock(private.user_pair_lock_key(v_me, p_target));

  DELETE FROM public.user_blocks ub
   WHERE ub.blocker_id = v_me
     AND ub.blocked_id = p_target;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  RETURN jsonb_build_object('status', 'ok', 'was_blocked', v_removed > 0);
END;
$$;

-- The blocker's own list. Scoped to auth.uid() inside the function body, so
-- there is no parameter through which another user's list could be requested.
CREATE OR REPLACE FUNCTION public.get_my_blocked_users(
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id    uuid,
  username   text,
  full_name  text,
  avatar_url text,
  avatar_type text,
  blocked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.username, p.full_name, p.avatar_url, p.avatar_type, ub.created_at
    FROM public.user_blocks ub
    JOIN public.profiles p ON p.id = ub.blocked_id
   WHERE ub.blocker_id = (SELECT auth.uid())
   ORDER BY ub.created_at DESC
   LIMIT  GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
$$;

REVOKE ALL ON FUNCTION public.block_user(uuid)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unblock_user(uuid)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_blocked_users(integer, integer)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_user(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_blocked_users(integer, integer) TO authenticated;

-- ===========================================================================
-- 4. DISCOVERY RPC IDENTITY HARDENING
--
-- All four discovery functions historically accepted the CALLER'S IDENTITY as
-- an argument (`p_user_id`) and used it for filtering. That was harmless while
-- every result was public. The moment blocking is enforced inside them it
-- becomes a bypass: a modified client passes a different UUID and gets an
-- unfiltered result set.
--
-- COMPATIBILITY STRATEGY (installed iOS/Android builds must keep working):
--   * The signatures are UNCHANGED, so shipped clients still resolve the RPC.
--   * `p_user_id` is now COMPATIBILITY-ONLY and DEPRECATED. It is validated,
--     never trusted: it must equal auth.uid() or the call is rejected.
--   * All filtering and authorization uses auth.uid() internally.
--   * NULL is accepted and treated as "the caller", so a future client can stop
--     sending it without a coordinated release.
-- ===========================================================================

-- Shared validator. Rejects unauthenticated callers and any attempt to act as
-- somebody else, and returns the ONLY identity the callers may use.
CREATE OR REPLACE FUNCTION public.assert_self_or_null(p_claimed uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  -- NULL means "whoever I am" and is always fine. A NON-NULL value must match.
  IF p_claimed IS NOT NULL AND p_claimed <> v_me THEN
    RAISE EXCEPTION 'identity_mismatch' USING ERRCODE = '42501';
  END IF;
  RETURN v_me;
END;
$$;

COMMENT ON FUNCTION public.assert_self_or_null(uuid) IS
  'Validates a legacy caller-supplied p_user_id against auth.uid(). The '
  'parameter is compatibility-only and deprecated; auth.uid() is the authority.';

REVOKE ALL ON FUNCTION public.assert_self_or_null(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_self_or_null(uuid) TO authenticated, service_role;

-- ── search_discovery ────────────────────────────────────────────────────────
-- People results exclude the blocked pair in BOTH directions. Club results are
-- untouched: a club is official information and is never hidden because of a
-- personal block (founder decision 3).
CREATE OR REPLACE FUNCTION public.search_discovery(p_user_id uuid, p_query text)
RETURNS TABLE(result_type text, id uuid, name text, avatar_url text, sub text, is_member boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me      uuid   := public.assert_self_or_null(p_user_id);
  v_blocked uuid[] := public.blocked_user_ids();
  -- Same literal-match hardening as search_students. This function already
  -- existed in production with a raw interpolated pattern; since 057 is
  -- rewriting it for identity hardening anyway, it gets the fix too.
  v_q       text   := public.safe_like_fragment(p_query);
BEGIN
  IF v_q = '' THEN RETURN; END IF;

  RETURN QUERY
  SELECT * FROM (
    SELECT
      'person'::TEXT AS result_type,
      p.id,
      COALESCE(p.full_name, p.username) AS name,
      p.avatar_url,
      p.username AS sub,
      false AS is_member
    FROM public.profiles p
    WHERE p.id <> v_me
      AND p.id <> ALL (v_blocked)          -- ← both directions of block
      AND (
        p.username  ILIKE '%' || v_q || '%' ESCAPE '\'
        OR p.full_name ILIKE '%' || v_q || '%' ESCAPE '\'
      )
    LIMIT 20
  ) people

  UNION ALL

  SELECT * FROM (
    SELECT
      'club'::TEXT AS result_type,
      c.id,
      c.name,
      c.avatar_url,
      c.member_count::TEXT AS sub,
      EXISTS(
        SELECT 1 FROM public.club_members cm
        WHERE cm.club_id = c.id AND cm.user_id = v_me
      ) AS is_member
    FROM public.clubs c
    WHERE c.is_active = true
      AND c.name ILIKE '%' || v_q || '%' ESCAPE '\'
    LIMIT 20
  ) clubs_res;
END;
$$;

-- ── get_discovery_people ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_discovery_people(p_user_id uuid)
RETURNS TABLE(user_id uuid, username text, full_name text, avatar_url text, club_name text, club_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me      uuid   := public.assert_self_or_null(p_user_id);
  v_blocked uuid[] := public.blocked_user_ids();
BEGIN
  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.username,
    p.full_name,
    p.avatar_url,
    COALESCE(
      (SELECT c.name FROM public.club_officers co
         JOIN public.clubs c ON c.id = co.club_id
        WHERE co.user_id = p.id AND c.is_active = true LIMIT 1),
      (SELECT c.name FROM public.posts pt
         JOIN public.clubs c ON c.id = pt.club_id
        WHERE pt.author_id = p.id AND pt.club_id IS NOT NULL AND c.is_active = true
        ORDER BY pt.created_at DESC LIMIT 1),
      (SELECT c.name FROM public.club_members clm
         JOIN public.clubs c ON c.id = clm.club_id
        WHERE clm.user_id = p.id AND c.is_active = true
        ORDER BY clm.joined_at DESC LIMIT 1)
    ) AS club_name,
    COALESCE(
      (SELECT co.club_id FROM public.club_officers co
         JOIN public.clubs c ON c.id = co.club_id
        WHERE co.user_id = p.id AND c.is_active = true LIMIT 1),
      (SELECT pt.club_id FROM public.posts pt
         JOIN public.clubs c ON c.id = pt.club_id
        WHERE pt.author_id = p.id AND pt.club_id IS NOT NULL AND c.is_active = true
        ORDER BY pt.created_at DESC LIMIT 1),
      (SELECT clm.club_id FROM public.club_members clm
         JOIN public.clubs c ON c.id = clm.club_id
        WHERE clm.user_id = p.id AND c.is_active = true
        ORDER BY clm.joined_at DESC LIMIT 1)
    ) AS club_id
  FROM public.profiles p
  WHERE p.id <> v_me
    AND p.id <> ALL (v_blocked)            -- ← both directions of block
  ORDER BY RANDOM()
  LIMIT 20;
END;
$$;

-- ── get_discovery_clubs ─────────────────────────────────────────────────────
-- Identity is hardened. NO block filtering: clubs are official information.
CREATE OR REPLACE FUNCTION public.get_discovery_clubs(
  p_user_id uuid, p_category text DEFAULT NULL::text,
  p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, name text, avatar_url text, cover_image_url text, member_count integer,
              is_member boolean, categories text[], meeting_day text, meeting_time_start text,
              meeting_time_end text, meeting_building text, meeting_room text)
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
    c.id, c.name, c.avatar_url, c.cover_image_url, c.member_count,
    EXISTS(SELECT 1 FROM public.club_members cm
            WHERE cm.club_id = c.id AND cm.user_id = v_me) AS is_member,
    ARRAY(SELECT cc.category FROM public.club_categories cc
           WHERE cc.club_id = c.id ORDER BY cc.category) AS categories,
    c.meeting_day, c.meeting_time_start::TEXT, c.meeting_time_end::TEXT,
    c.meeting_building, c.meeting_room
  FROM public.clubs c
  WHERE c.is_active = true
    AND (p_category IS NULL
         OR EXISTS (SELECT 1 FROM public.club_categories cc
                     WHERE cc.club_id = c.id AND cc.category = p_category))
  ORDER BY
    CASE WHEN p_category IS NULL THEN
      (SELECT COUNT(*) FROM public.club_categories cc
        JOIN public.user_interests ui ON ui.interest = cc.category AND ui.user_id = v_me
       WHERE cc.club_id = c.id)
      +
      (SELECT COUNT(DISTINCT ea.activity) FROM public.events e
        JOIN public.event_activities ea ON ea.event_id = e.id
        JOIN public.user_activities ua ON ua.activity = ea.activity AND ua.user_id = v_me
       WHERE e.club_id = c.id)
    ELSE 0 END DESC,
    c.name ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- ── get_discovery_events ────────────────────────────────────────────────────
-- Identity is hardened. NO block filtering: events are official information and
-- must remain visible even when the creating officer is blocked (decision 3).
CREATE OR REPLACE FUNCTION public.get_discovery_events(
  p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, title text, emoji text, event_date date, start_time time without time zone,
              end_time time without time zone, location text, cover_image_url text, club_id uuid,
              club_name text, club_avatar_url text, member_count integer, is_saved boolean,
              user_rsvp_status text, match_count integer)
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

-- ── Safe LIKE fragment ──────────────────────────────────────────────────────
--
-- User search input is interpolated into an ILIKE pattern. It is parameterized,
-- so SQL injection is not possible — but LIKE METACHARACTERS still are:
--
--   '%'   matched every row, returning the whole student directory
--   '_'   matched every row likewise
--   a 10,000-character fragment scanned the table with a 10,000-char pattern
--
-- Verified against the shadow database BEFORE this helper existed: search_students('%')
-- returned every other student, up to the limit. That is directory enumeration
-- through a search box, and a pattern with no trigrams cannot use the index, so
-- it also forces the exact sequential scan this function exists to avoid.
--
-- Escaping makes user input match LITERALLY, and the length cap keeps the
-- pattern bounded. Both are applied to every people-search entry point.
CREATE OR REPLACE FUNCTION public.safe_like_fragment(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT replace(replace(replace(
           left(btrim(COALESCE(p_input, '')), 100),
           '\', '\\'), '%', '\%'), '_', '\_');
$$;

COMMENT ON FUNCTION public.safe_like_fragment(text) IS
  'Trims, caps at 100 chars, and escapes LIKE metacharacters so a search '
  'fragment is matched literally. Prevents wildcard-only directory enumeration '
  'and unbounded pattern scans. Use with ESCAPE ''\''.';

REVOKE ALL ON FUNCTION public.safe_like_fragment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safe_like_fragment(text) TO authenticated, service_role;

-- ── search_students: the people picker used by student web ──────────────────
--
-- WHY THIS RPC EXISTS — a measured performance finding, not a preference.
--
-- Section 5 puts a real predicate on `profiles`. Any non-trivial RLS policy
-- makes the table a SECURITY BARRIER, and PostgreSQL may not push a
-- NON-LEAKPROOF user qual below a security barrier. `ILIKE` (`texticlike`) is
-- not leakproof (verified: pg_proc.proleakproof = false), so once 057 lands, a
-- client-side `ILIKE` on `profiles` can NEVER use the trigram indexes again.
--
-- Measured on a 200,000-profile shadow database, worst case (a typeahead
-- fragment matching nothing, which forces a full scan):
--     direct ILIKE as `authenticated`, post-057 ....... 81.7 ms   (Seq Scan)
--     same predicate inside SECURITY DEFINER .......... 0.015 ms  (Bitmap Index Scan)
--
-- That is the difference between a working typeahead and an unusable one, and
-- typeahead is exactly the pattern that produces zero-match queries. So people
-- search moves behind a DEFINER function — which is ALSO where the block filter
-- belongs, and is already how mobile search works (`search_discovery`).
CREATE OR REPLACE FUNCTION public.search_students(
  p_query text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (id uuid, username text, full_name text, avatar_url text, university text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me      uuid   := (SELECT auth.uid());
  v_blocked uuid[];
  v_univ    text;
  v_raw     text   := btrim(COALESCE(p_query, ''));
  v_q       text   := public.safe_like_fragment(p_query);
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  -- MINIMUM QUERY LENGTH — a measured bound, not a style preference.
  --
  -- A trigram index cannot serve a pattern shorter than 3 characters, so a
  -- 1–2 character fragment always degrades to a sequential scan. Measured on
  -- the 200,000-profile shadow database:
  --
  --     1 char  -> 20.6 ms   (Seq Scan)
  --     2 chars -> 72.2 ms   (Seq Scan)
  --     3 chars ->  0.41 ms  (Bitmap Index Scan)  ← the index engages here
  --     4 chars ->  0.25 ms
  --
  -- Without this bound, every keystroke of a typeahead costs a full table scan,
  -- which is precisely what this function exists to prevent. It also makes the
  -- escaped wildcard case moot: '%' is one character and stops here.
  --
  -- The length is measured on the RAW trimmed input, not the escaped form —
  -- escaping '%' produces the 2-character '\%', which must not sneak past.
  IF length(v_raw) < 3 OR v_q = '' THEN RETURN; END IF;

  v_blocked := public.blocked_user_ids();
  SELECT p.university INTO v_univ FROM public.profiles p WHERE p.id = v_me;

  RETURN QUERY
  SELECT p.id, p.username, p.full_name, p.avatar_url, p.university
    FROM public.profiles p
   WHERE p.id <> v_me
     AND p.id <> ALL (v_blocked)                    -- ← both directions of block
     -- Same-campus scoping, matching the behaviour of the callers this replaces.
     AND (v_univ IS NULL OR p.university IS NOT DISTINCT FROM v_univ)
     AND (p.username  ILIKE '%' || v_q || '%' ESCAPE '\'
       OR p.full_name ILIKE '%' || v_q || '%' ESCAPE '\')
   ORDER BY p.username
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
END;
$$;

REVOKE ALL ON FUNCTION public.search_students(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_students(text, integer) TO authenticated;

-- ===========================================================================
-- 5. RLS POLICY ENFORCEMENT
--
-- Every policy below uses `(SELECT public.blocked_user_ids())` so PostgreSQL
-- evaluates the set ONCE per statement as an InitPlan.
-- ===========================================================================

-- ── profiles: the discovery surface ─────────────────────────────────────────
-- A blocked profile returns ZERO ROWS, which is what makes every direct link,
-- deep link and hand-crafted PostgREST request resolve to the same safe
-- "unavailable" state without the client having to implement it.
DROP POLICY IF EXISTS "profiles: anyone authenticated can read" ON public.profiles;
DROP POLICY IF EXISTS "profiles: authenticated read, block-aware" ON public.profiles;
CREATE POLICY "profiles: authenticated read, block-aware"
  ON public.profiles FOR SELECT TO authenticated
  USING (
        id = (SELECT auth.uid())
    OR  id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
  );

-- ── posts: the personal / official split (founder decision 3) ───────────────
-- `club_id IS NOT NULL` means the post was published to a club. It stays
-- visible no matter who wrote it. Only PERSONAL posts are hidden.
DROP POLICY IF EXISTS "posts: anyone authenticated can read" ON public.posts;
DROP POLICY IF EXISTS "posts: authenticated read, block-aware" ON public.posts;
CREATE POLICY "posts: authenticated read, block-aware"
  ON public.posts FOR SELECT TO authenticated
  USING (
        club_id IS NOT NULL                                   -- OFFICIAL: always visible
    OR  author_id = (SELECT auth.uid())
    OR  author_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])  -- personal: block-aware
  );

-- Writes: a student may not act on a blocked user's post.
DROP POLICY IF EXISTS "posts: authors can insert" ON public.posts;
CREATE POLICY "posts: authors can insert"
  ON public.posts FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()));

-- ── post_comments: personal social interaction, filtered both ways ──────────
DROP POLICY IF EXISTS "post_comments: anyone authenticated can read" ON public.post_comments;
DROP POLICY IF EXISTS "post_comments: authenticated read, block-aware" ON public.post_comments;
CREATE POLICY "post_comments: authenticated read, block-aware"
  ON public.post_comments FOR SELECT TO authenticated
  USING (
        user_id = (SELECT auth.uid())
    OR  user_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
  );

DROP POLICY IF EXISTS "post_comments: users insert own" ON public.post_comments;
CREATE POLICY "post_comments: users insert own"
  ON public.post_comments FOR INSERT TO authenticated
  WITH CHECK (
        user_id = (SELECT auth.uid())
    -- Cannot comment on a blocked user's post.
    AND NOT EXISTS (
          SELECT 1 FROM public.posts p
           WHERE p.id = post_comments.post_id
             AND p.author_id = ANY ((SELECT public.blocked_user_ids())::uuid[])
        )
  );

-- ── post_likes ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "post_likes: anyone authenticated can read" ON public.post_likes;
DROP POLICY IF EXISTS "post_likes: authenticated read, block-aware" ON public.post_likes;
CREATE POLICY "post_likes: authenticated read, block-aware"
  ON public.post_likes FOR SELECT TO authenticated
  USING (
        user_id = (SELECT auth.uid())
    OR  user_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
  );

DROP POLICY IF EXISTS "post_likes: users manage own" ON public.post_likes;
CREATE POLICY "post_likes: users manage own"
  ON public.post_likes FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
        user_id = (SELECT auth.uid())
    AND NOT EXISTS (
          SELECT 1 FROM public.posts p
           WHERE p.id = post_likes.post_id
             AND p.author_id = ANY ((SELECT public.blocked_user_ids())::uuid[])
        )
  );

-- ── follows: discovery + creation + acceptance ──────────────────────────────
-- SELECT is filtered so a blocked user never appears in ANY follower/following
-- or Gluemate list the blocker can see, including third parties' lists.
DROP POLICY IF EXISTS "follows: anyone authenticated can read" ON public.follows;
DROP POLICY IF EXISTS "follows: authenticated read, block-aware" ON public.follows;
CREATE POLICY "follows: authenticated read, block-aware"
  ON public.follows FOR SELECT TO authenticated
  USING (
        follower_id  = (SELECT auth.uid())
    OR  following_id = (SELECT auth.uid())
    OR  (    follower_id  <> ALL ((SELECT public.blocked_user_ids())::uuid[])
         AND following_id <> ALL ((SELECT public.blocked_user_ids())::uuid[]) )
  );

-- A modified client must not be able to recreate a follow while the block
-- exists. This is the server-side half of "follow controls cannot operate".
DROP POLICY IF EXISTS "follows: authenticated can insert" ON public.follows;
CREATE POLICY "follows: authenticated can insert"
  ON public.follows FOR INSERT TO authenticated
  WITH CHECK (
        follower_id = (SELECT auth.uid())
    AND following_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
  );

-- Acceptance (pending -> accepted) is an UPDATE by the followed user.
DROP POLICY IF EXISTS "follows: owner can update (accept/reject)" ON public.follows;
CREATE POLICY "follows: owner can update (accept/reject)"
  ON public.follows FOR UPDATE TO authenticated
  USING  (following_id = (SELECT auth.uid()))
  WITH CHECK (
        following_id = (SELECT auth.uid())
    AND follower_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
  );

-- ── messages: DIRECT conversations only ─────────────────────────────────────
-- The SELECT policies are deliberately NOT touched. That is founder decision 2
-- made concrete: shared group and club history is never filtered, existing DM
-- history stays readable to both parties, and the hottest read path in the
-- product gains ZERO cost.
DROP POLICY IF EXISTS "messages: participants can insert" ON public.messages;
CREATE POLICY "messages: participants can insert"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
        sender_id = (SELECT auth.uid())
    AND public.is_conversation_participant(conversation_id)
    AND (channel_id IS NULL OR public.can_post_in_channel(channel_id))
    -- A stale DM screen cannot send through a raw API request either.
    AND NOT EXISTS (
          SELECT 1
            FROM public.conversations c
            JOIN public.conversation_participants cp ON cp.conversation_id = c.id
           WHERE c.id = messages.conversation_id
             AND c.type = 'direct'
             AND cp.user_id <> (SELECT auth.uid())
             AND cp.user_id = ANY ((SELECT public.blocked_user_ids())::uuid[])
        )
  );

-- ===========================================================================
-- 6. DIRECT-CONVERSATION AND GROUP-INVITATION GUARDS
-- ===========================================================================

-- No new direct conversation between a blocked pair, from either side.
CREATE OR REPLACE FUNCTION public.get_or_create_direct_chat(other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me      uuid := (SELECT auth.uid());
  v_conv_id uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF v_me = other_user_id THEN
    RAISE EXCEPTION 'Cannot create a DM with yourself' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = other_user_id) THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  -- Serialize against a concurrent block BEFORE reading the relationship.
  --
  -- REPRODUCED DEFECT (Gate 1): without this lock, a get_or_create_direct_chat
  -- racing an uncommitted block passed its own check and CREATED the
  -- conversation plus both participant rows. The block then committed. The
  -- result was an empty direct thread between a blocked pair, sitting in the
  -- BLOCKER's inbox — and not hidden, because block_user's hidden_at sweep had
  -- already run before the conversation existed.
  --
  -- Checking under the lock makes the read see committed state.
  PERFORM pg_advisory_xact_lock(private.user_pair_lock_key(v_me, other_user_id));

  -- Symmetric: neither the blocker nor the blocked person may open a DM.
  IF public.users_have_block_relationship(v_me, other_user_id) THEN
    RAISE EXCEPTION 'interaction_unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.id INTO v_conv_id
  FROM public.conversations c
  WHERE c.type = 'direct'
    AND c.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.conversation_participants
                 WHERE conversation_id = c.id AND user_id = v_me)
    AND EXISTS (SELECT 1 FROM public.conversation_participants
                 WHERE conversation_id = c.id AND user_id = other_user_id)
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (type, created_by) VALUES ('direct', v_me)
    RETURNING id INTO v_conv_id;
    INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, v_me), (v_conv_id, other_user_id);
  END IF;

  RETURN v_conv_id;
END;
$$;

-- Group creation: silently drop blocked users from the participant list rather
-- than failing the whole call. Failing would tell the creator something about a
-- block they may not own, and would block a legitimate group over one bad id.
CREATE OR REPLACE FUNCTION public.create_group_chat(
  p_name text, p_participant_ids uuid[],
  p_first_message text DEFAULT NULL::text, p_client_tag uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me        uuid := (SELECT auth.uid());
  v_conv_id   uuid;
  v_uid       uuid;
  v_clean_ids uuid[];
  v_blocked   uuid[];
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_blocked := public.blocked_user_ids();

  SELECT ARRAY(
    SELECT DISTINCT pid FROM unnest(COALESCE(p_participant_ids, '{}')) pid
    WHERE pid IS NOT NULL AND pid <> v_me
      AND pid <> ALL (v_blocked)                    -- ← blocked pair excluded
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = pid)
  ) INTO v_clean_ids;

  IF array_length(v_clean_ids, 1) IS NULL OR array_length(v_clean_ids, 1) < 1 THEN
    RAISE EXCEPTION 'need_participants';
  END IF;
  IF array_length(v_clean_ids, 1) > 100 THEN
    RAISE EXCEPTION 'too_many_participants';
  END IF;

  -- Serialize against a block committing mid-call, for every pair involved.
  --
  -- DEADLOCK SAFETY: locks are taken in ascending LOCK-KEY order, which is a
  -- total order shared by every transaction in the system. Two concurrent group
  -- creations with overlapping members therefore acquire their common locks in
  -- the same relative sequence and cannot form a cycle. Ordering by participant
  -- id would NOT be sufficient — the key is a hash of the unordered pair, so id
  -- order and key order differ.
  PERFORM pg_advisory_xact_lock(k)
     FROM (SELECT DISTINCT private.user_pair_lock_key(v_me, pid) AS k
             FROM unnest(v_clean_ids) pid
            ORDER BY 1) locks;

  -- Re-filter under the locks: v_blocked was read before them and may be stale.
  SELECT ARRAY(
    SELECT pid FROM unnest(v_clean_ids) pid
     WHERE NOT public.users_have_block_relationship(v_me, pid)
  ) INTO v_clean_ids;

  IF array_length(v_clean_ids, 1) IS NULL OR array_length(v_clean_ids, 1) < 1 THEN
    RAISE EXCEPTION 'need_participants';
  END IF;

  IF p_client_tag IS NOT NULL THEN
    SELECT m.conversation_id INTO v_conv_id
    FROM public.messages m WHERE m.sender_id = v_me AND m.client_tag = p_client_tag;
    IF FOUND THEN RETURN v_conv_id; END IF;
  END IF;

  INSERT INTO public.conversations (type, name, created_by)
  VALUES ('group', NULLIF(btrim(COALESCE(p_name,'')), ''), v_me)
  RETURNING id INTO v_conv_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (v_conv_id, v_me);
  FOREACH v_uid IN ARRAY v_clean_ids LOOP
    INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, v_uid) ON CONFLICT DO NOTHING;
  END LOOP;

  IF p_first_message IS NOT NULL AND btrim(p_first_message) <> '' THEN
    INSERT INTO public.messages (conversation_id, sender_id, content, message_type, client_tag)
    VALUES (v_conv_id, v_me, btrim(p_first_message), 'text', p_client_tag);
  END IF;

  BEGIN
    INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
    SELECT v_uid2, v_me, 'group_chat_added', v_conv_id, 'message', false,
           'You were added to a group chat.'
    FROM unnest(v_clean_ids) v_uid2;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'create_group_chat notifications failed: %', SQLERRM;
  END;

  RETURN v_conv_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_group_participants(p_conversation_id uuid, p_user_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me      uuid := (SELECT auth.uid());
  v_uid     uuid;
  v_blocked uuid[];
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = p_conversation_id AND type = 'group'
      AND created_by = v_me AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Lock every pair first, in ascending LOCK-KEY order (see create_group_chat
  -- for why key order rather than id order), then read the relationship under
  -- the locks so a block committing mid-call cannot be missed.
  PERFORM pg_advisory_xact_lock(k)
     FROM (SELECT DISTINCT private.user_pair_lock_key(v_me, pid) AS k
             FROM unnest(COALESCE(p_user_ids,'{}')) pid
            WHERE pid IS NOT NULL AND pid <> v_me
            ORDER BY 1) locks;

  v_blocked := public.blocked_user_ids();

  FOREACH v_uid IN ARRAY COALESCE(p_user_ids,'{}') LOOP
    IF v_uid IS NOT NULL
       AND v_uid <> ALL (v_blocked)                 -- ← blocked pair excluded
       AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
      INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (p_conversation_id, v_uid)
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET hidden_at = NULL;
      BEGIN
        INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
        VALUES (v_uid, v_me, 'group_chat_added', p_conversation_id, 'message', false,
                'You were added to a group chat.');
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END LOOP;
END;
$$;

-- ===========================================================================
-- 7. NOTIFICATION SUPPRESSION — explicit classification + a DATABASE trigger
--
-- WHY A TRIGGER AND NOT JUST A HELPER GUARD:
-- the audit found that `create_group_chat` and `add_group_participants` INSERT
-- into `notifications` DIRECTLY, bypassing `insert_notification_once()`. A guard
-- placed only in the helper would leave a live notification channel between
-- blocked users. The trigger covers EVERY insertion path, present and future.
-- ===========================================================================

-- Explicit, data-driven classification. `blockable = true` means "this
-- notification is a DIRECT or PERSONAL interaction between two students and
-- must be suppressed between a blocked pair".
ALTER TABLE public.notification_types
  ADD COLUMN IF NOT EXISTS blockable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_types.blockable IS
  'true  = personal/direct interaction; suppressed between blocked pairs. '
  'false = shared-context, official or system notice; NEVER suppressed, so a '
  'club announcement or safety notice still reaches every member regardless of '
  'who authored it.';

-- NEVER suppressed: shared-context, official club/event, and system notices.
-- A student who blocks an officer must still receive the club's announcements,
-- event changes, reminders and their own membership/role notices.
UPDATE public.notification_types SET blockable = false
 WHERE type IN (
   -- official club content and status
   'club_post', 'club_joined', 'club_removed', 'club_inactive',
   'officer_role', 'officer_removed',
   'club_chat_added', 'officer_chat_added',
   -- official event information
   'new_event', 'event_canceled', 'event_updated',
   'event_reminder_hour', 'event_reminder_now', 'event_reminder_tomorrow',
   'event_last_chance',
   -- APPROVED shared-context conversations (founder decision 2): a blocked pair
   -- sharing a group or club chat keeps receiving that room's activity.
   'club_chat_message', 'group_message', 'new_message'
 );

-- Suppressed between blocked pairs: personal/direct interaction.
UPDATE public.notification_types SET blockable = true
 WHERE type IN (
   'follow_request', 'new_follower', 'follow_accepted', 'gluemate',
   'like', 'comment',
   'dm_message',
   'event_rsvp',
   'group_chat_added', 'chat_invite_joined',
   'member_joined', 'student_joined'
 );

-- The guard itself.
--
-- Deliberately WITHOUT a catch-all EXCEPTION handler. The neighbouring
-- `notifications_prepare()` swallows errors with `WHEN OTHERS`, which is right
-- for a best-effort formatting step and WRONG for a security control: a guard
-- that fails open is not a guard. If this cannot evaluate, the INSERT fails.
CREATE OR REPLACE FUNCTION public.notifications_block_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_blockable boolean;
BEGIN
  -- No actor means no interpersonal interaction to suppress.
  IF NEW.actor_id IS NULL OR NEW.user_id IS NULL OR NEW.actor_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- Cheapest discriminator first: no block relationship, nothing to do.
  IF NOT public.users_have_block_relationship(NEW.user_id, NEW.actor_id) THEN
    RETURN NEW;
  END IF;

  SELECT nt.blockable INTO v_blockable
    FROM public.notification_types nt
   WHERE nt.type = NEW.type;

  -- COALESCE(..., true) fails CLOSED: a notification type that nobody has
  -- classified yet is treated as personal and IS suppressed between a blocked
  -- pair. A future type added without a classification therefore errs toward
  -- silence rather than toward leaking an interaction.
  IF COALESCE(v_blockable, true) THEN
    RETURN NULL;   -- suppressed BEFORE the row is committed. No push follows.
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger ORDER MATTERS. PostgreSQL fires BEFORE triggers in alphabetical order
-- by name, and 'trg_notifications_block_guard' sorts before
-- 'trg_notifications_prepare', so a suppressed row never reaches the grouping
-- logic and can never be merged into an existing group notification.
DROP TRIGGER IF EXISTS trg_notifications_block_guard ON public.notifications;
CREATE TRIGGER trg_notifications_block_guard
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_block_guard();

-- ── Notifications that already existed BEFORE the block ─────────────────────
--
-- The trigger above stops NEW rows. It cannot retract rows that were written
-- while the two students were still interacting normally. Those are NOT
-- deleted — destroying the blocker's own history would be worse, and a change
-- in row counts is itself inferable by the other party. They are hidden from
-- the blocker by RLS instead, which is server-side and therefore cannot be
-- undone by a modified client.
--
-- The same `blockable` classification decides it, so an OFFICIAL club or event
-- notification stays visible even when its actor is blocked (decision 3).
CREATE OR REPLACE FUNCTION public.blockable_notification_types()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(nt.type), ARRAY[]::text[])
    FROM public.notification_types nt
   WHERE nt.blockable;
$$;

COMMENT ON FUNCTION public.blockable_notification_types() IS
  'Personal/direct notification types, as a once-per-statement InitPlan array. '
  'Pairs with blocked_user_ids() so the notifications SELECT policy costs two '
  'constant lookups per statement instead of a per-row join to notification_types.';

REVOKE ALL ON FUNCTION public.blockable_notification_types() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.blockable_notification_types() TO authenticated, service_role;

DROP POLICY IF EXISTS "notifications: users read own" ON public.notifications;
DROP POLICY IF EXISTS "notifications: users read own, block-aware" ON public.notifications;
CREATE POLICY "notifications: users read own, block-aware"
  ON public.notifications FOR SELECT TO authenticated
  USING (
        user_id = (SELECT auth.uid())
    AND (
          actor_id IS NULL
      OR  actor_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
      OR  type     <> ALL ((SELECT public.blockable_notification_types())::text[])
    )
  );

-- Defense in depth: the helper most triggers use also refuses early, so the
-- common path does not even build a row.
CREATE OR REPLACE FUNCTION public.insert_notification_once(
  p_user_id uuid, p_actor_id uuid, p_type text,
  p_entity_id uuid DEFAULT NULL::uuid, p_entity_type text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL OR p_actor_id IS NULL OR p_user_id = p_actor_id THEN
    RETURN;
  END IF;

  IF public.users_have_block_relationship(p_user_id, p_actor_id)
     AND COALESCE((SELECT nt.blockable FROM public.notification_types nt
                    WHERE nt.type = p_type), true) THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, read)
  SELECT p_user_id, p_actor_id, p_type, p_entity_id, p_entity_type, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id
      AND n.actor_id = p_actor_id
      AND n.type = p_type
      AND n.entity_id IS NOT DISTINCT FROM p_entity_id
  );
END;
$$;

-- ===========================================================================
-- 8. PUSH SUPPRESSION
--
-- The notification trigger already prevents the row that would trigger a push.
-- This is the independent second barrier, for any future path that enqueues a
-- push without inserting a notification first.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.enqueue_push(
  p_user uuid, p_notification_id uuid, p_type text, p_title text, p_body text,
  p_route jsonb, p_collapse_key text DEFAULT NULL::text,
  p_dedupe_key text DEFAULT NULL::text, p_min_gap_minutes integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg       public.notification_types%ROWTYPE;
  v_cap       INT;
  v_sent_hour INT;
  v_actor     uuid;
BEGIN
  SELECT * INTO v_reg FROM public.notification_types WHERE type = p_type;
  IF NOT FOUND OR NOT v_reg.enabled OR NOT v_reg.push THEN RETURN; END IF;

  -- Block recheck immediately before enqueueing. Resolves the actor from the
  -- originating notification, because push_queue itself has no actor column.
  IF p_notification_id IS NOT NULL AND COALESCE(v_reg.blockable, true) THEN
    SELECT n.actor_id INTO v_actor
      FROM public.notifications n WHERE n.id = p_notification_id;
    IF v_actor IS NOT NULL
       AND public.users_have_block_relationship(p_user, v_actor) THEN
      RETURN;
    END IF;
  END IF;

  IF NOT public.user_wants_push(p_user, v_reg.category) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.push_tokens
                  WHERE user_id = p_user AND status = 'active') THEN
    RETURN;
  END IF;

  v_cap := COALESCE((
    SELECT (value ->> v_reg.category)::INT FROM public.notification_config
     WHERE key = 'push.hourly_caps'
  ), 30);
  IF v_cap <= 0 THEN RETURN; END IF;
  SELECT count(*) INTO v_sent_hour
  FROM public.push_queue
  WHERE user_id = p_user AND category = v_reg.category
    AND created_at > now() - interval '1 hour'
    AND status IN ('pending','processing','sent');
  IF v_sent_hour >= v_cap THEN RETURN; END IF;

  IF p_collapse_key IS NOT NULL AND p_min_gap_minutes > 0 AND EXISTS (
    SELECT 1 FROM public.push_queue
    WHERE user_id = p_user AND collapse_key = p_collapse_key
      AND status = 'sent' AND sent_at > now() - make_interval(mins => p_min_gap_minutes)
  ) THEN
    RETURN;
  END IF;

  IF p_collapse_key IS NOT NULL THEN
    UPDATE public.push_queue
    SET title = p_title, body = p_body, route = p_route,
        notification_id = COALESCE(p_notification_id, notification_id),
        created_at = now()
    WHERE user_id = p_user AND collapse_key = p_collapse_key AND status = 'pending';
    IF FOUND THEN RETURN; END IF;
  END IF;

  INSERT INTO public.push_queue (user_id, notification_id, category, title, body,
                                 route, collapse_key, dedupe_key)
  VALUES (p_user, p_notification_id, v_reg.category, p_title, p_body,
          COALESCE(p_route, '{}'::jsonb), p_collapse_key, p_dedupe_key)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

-- Dispatch-time recheck: a push that was queued BEFORE a block must not be
-- delivered AFTER it. claim_push_batch is the single point where the worker
-- takes items, so filtering here covers every delivery.
-- Signature, default and clamp are preserved EXACTLY as they exist in
-- production (p_limit integer DEFAULT 100, LEAST(GREATEST(p_limit,1),500)), so
-- `invoke_push_dispatch()` and the send-push edge function are unaffected. Only
-- the language changes, from sql to plpgsql, to allow the pre-claim sweep.
--
-- 'suppressed' is used rather than a new status value because
-- push_queue_status_check allows exactly: pending, processing, sent,
-- suppressed, failed, skipped. Inventing 'canceled' would violate the CHECK.
CREATE OR REPLACE FUNCTION public.claim_push_batch(p_limit integer DEFAULT 100)
RETURNS SETOF public.push_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- A push queued BEFORE a block must not be delivered AFTER it.
  UPDATE public.push_queue pq
     SET status = 'suppressed', error = 'block_relationship'
   WHERE pq.status = 'pending'
     AND pq.scheduled_for <= now()
     AND EXISTS (
           SELECT 1
             FROM public.notifications n
             JOIN public.notification_types nt ON nt.type = n.type
            WHERE n.id = pq.notification_id
              AND COALESCE(nt.blockable, true)
              AND n.actor_id IS NOT NULL
              AND public.users_have_block_relationship(n.user_id, n.actor_id)
         );

  RETURN QUERY
  UPDATE public.push_queue q
     SET status = 'processing', attempts = q.attempts + 1, claimed_at = now()
   WHERE q.id IN (
     SELECT p.id FROM public.push_queue p
      WHERE p.status = 'pending' AND p.scheduled_for <= now()
      ORDER BY p.scheduled_for
      LIMIT LEAST(GREATEST(p_limit, 1), 500)
      FOR UPDATE SKIP LOCKED
   )
   RETURNING q.*;
END;
$$;

COMMIT;

-- ===========================================================================
-- WHAT THIS MIGRATION DELIBERATELY DID NOT TOUCH
--
--   messages SELECT policies      — shared group/club history is never filtered
--                                   and DM history stays readable (decision 2)
--   conversations / participants  — nobody is removed from a shared room
--   club_members / club_officers  — memberships, officer roles unchanged
--   event_rsvps                   — attendance is not contact
--   clubs / events                — official information, always visible
--   delete_own_account_atomic     — user_blocks cascades from profiles; no edit
--   reports                       — reporting a blocked user still works
--   storage.objects               — public buckets stay public (decision 6)
--   admin_audit_*                 — no administrator action exists in 10B1
--   ADMIN_WRITES_ENABLED          — still false
-- ===========================================================================
