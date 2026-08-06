-- =============================================================================
-- 073 — Blocking overrides the club-tag exception, block access sync, and
--       university-scoped club name/handle identity
--
-- Three confirmed gaps, each fixed by correcting the EXISTING canonical object
-- rather than adding a parallel one:
--
--   1. 069's posts policy treats `club_id IS NOT NULL` as a bypass of BOTH the
--      private-account branch AND the blocking branch. The club-tag exception
--      for private accounts is deliberate product behaviour and is kept; the
--      blocking bypass is not, and is removed. A blocked person could otherwise
--      still read the blocker's club-tagged post from the club profile, a
--      direct link, saved content, a notification, or a shared message.
--
--   2. user_blocks changes emitted no realtime signal at all, so an unblocked
--      student's client had no way to learn access was restored short of a
--      stale-cache timeout. This reuses 066's existing per-user access topic
--      and its opaque `{}` payload — no new channel, no content in the signal.
--
--   3. clubs.handle was GLOBALLY unique (001) and client-supplied. Product rule:
--      names and handles are unique per university, the handle is derived from
--      the name by the backend, and the two always move together.
-- =============================================================================

BEGIN;

-- ── 1. Blocking overrides the club-tag exception ───────────────────────────
-- Replaces 069's policy in place. There is exactly one permissive SELECT policy
-- on posts before and after, so nothing can combine to re-open the bypass.
DROP POLICY IF EXISTS "posts: read respecting privacy, blocking, and lifecycle" ON public.posts;
CREATE POLICY "posts: read respecting privacy, blocking, and lifecycle"
  ON public.posts FOR SELECT TO authenticated
  USING (
    public.content_is_student_visible('post', id)
    AND (
      author_id = (SELECT auth.uid())
      OR (
        -- Blocking is now evaluated FIRST and applies to every post, including
        -- club-tagged ones, in both directions (blocked_user_ids is symmetric).
        author_id <> ALL((SELECT public.blocked_user_ids())::uuid[])
        AND (
          -- Deliberate exception, unchanged: a private student who tags a club
          -- has chosen to share that post into the club's context.
          club_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.user_privacy up
             WHERE up.user_id = posts.author_id AND up.is_private
          )
          OR EXISTS (
            SELECT 1 FROM public.follows f
             WHERE f.follower_id = (SELECT auth.uid())
               AND f.following_id = posts.author_id
               AND f.status = 'accepted'
          )
        )
      )
    )
  );

-- ── 2. Block / unblock access convergence ──────────────────────────────────
-- Both parties are signalled: the blocker's own caches change too, because
-- blocking is mutual content separation.
CREATE OR REPLACE FUNCTION private.broadcast_block_access_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_blocker uuid := COALESCE(NEW.blocker_id, OLD.blocker_id);
  v_blocked uuid := COALESCE(NEW.blocked_id, OLD.blocked_id);
BEGIN
  IF v_blocker IS NOT NULL THEN
    PERFORM realtime.send('{}'::jsonb, 'invalidate', 'sync:access:' || v_blocker::text, true);
  END IF;
  IF v_blocked IS NOT NULL THEN
    PERFORM realtime.send('{}'::jsonb, 'invalidate', 'sync:access:' || v_blocked::text, true);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Convergence is an optimisation, never a reason to roll back the block.
  RAISE WARNING 'broadcast_block_access_sync failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.broadcast_block_access_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_user_blocks_access_sync ON public.user_blocks;
CREATE TRIGGER trg_user_blocks_access_sync
  AFTER INSERT OR DELETE ON public.user_blocks
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_block_access_sync();

-- ── 3. Club name and handle identity ───────────────────────────────────────
-- ONE normalization contract, used by both the uniqueness indexes and the
-- collision check, so the two can never disagree.
CREATE OR REPLACE FUNCTION public.normalized_club_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- case-insensitive, trimmed, internal whitespace collapsed
  SELECT lower(pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_name, '')), '\s+', ' ', 'g'));
$$;

-- Handle is DERIVED, never supplied: "Forest Club" -> "ForestClub". The
-- officer's own capitalisation is preserved for display; comparison is
-- case-insensitive so "forestclub" and "ForestClub" collide.
CREATE OR REPLACE FUNCTION public.club_handle_from_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.regexp_replace(pg_catalog.btrim(COALESCE(p_name, '')), '[^a-zA-Z0-9]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION private.derive_club_handle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_handle text;
  v_norm   text;
BEGIN
  v_norm   := public.normalized_club_name(NEW.name);
  v_handle := public.club_handle_from_name(NEW.name);

  IF v_norm = '' OR v_handle = '' THEN
    RAISE EXCEPTION 'club_name_must_contain_letters_or_numbers' USING ERRCODE = '23514';
  END IF;

  -- The handle is always re-derived, so a client that supplies its own handle,
  -- or tries to change the handle independently of the name, is ignored rather
  -- than trusted. Name and handle therefore always move together or not at all.
  NEW.handle := v_handle;

  -- Explicit collision check so the caller gets a meaningful error instead of a
  -- raw index violation. The unique indexes below remain the real guarantee
  -- (they also cover concurrent inserts). NO numeric suffix is ever invented:
  -- a collision is rejected outright.
  IF EXISTS (
    SELECT 1 FROM public.clubs c
     WHERE c.id <> NEW.id
       AND c.university_id IS NOT DISTINCT FROM NEW.university_id
       AND (
         public.normalized_club_name(c.name) = v_norm
         OR lower(c.handle) = lower(v_handle)
       )
  ) THEN
    RAISE EXCEPTION 'club_name_already_exists_at_university' USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.derive_club_handle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_clubs_derive_handle ON public.clubs;
CREATE TRIGGER trg_clubs_derive_handle
  BEFORE INSERT OR UPDATE OF name, handle, university_id ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION private.derive_club_handle();

-- 001 made the handle globally unique, which would stop two universities from
-- each having a "Forest Club". Uniqueness becomes university-scoped instead.
ALTER TABLE public.clubs DROP CONSTRAINT IF EXISTS clubs_handle_key;

CREATE UNIQUE INDEX IF NOT EXISTS clubs_university_normalized_name_key
  ON public.clubs (university_id, public.normalized_club_name(name));

CREATE UNIQUE INDEX IF NOT EXISTS clubs_university_normalized_handle_key
  ON public.clubs (university_id, lower(handle));

COMMIT;
