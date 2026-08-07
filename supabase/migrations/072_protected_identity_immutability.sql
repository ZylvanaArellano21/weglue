-- =============================================================================
-- 072 — Protected identity immutability
--
-- Confirmed by probing the real schema as an ordinary `authenticated` caller:
-- several RLS UPDATE policies constrain WHICH row you may touch but not what the
-- row may BECOME. PostgreSQL reuses a policy's USING expression as its WITH
-- CHECK when none is given, so a self-bound predicate like `user_id = auth.uid()`
-- already prevents moving a row to another user — that class of table needed no
-- change and deliberately gets none here.
--
-- The gap is the columns those predicates never mention. An officer policy of
-- `is_club_officer(club_id)` stays true while `university_id`, `created_by`,
-- `created_at` or a system counter is rewritten, so a direct PostgREST request
-- could move a club to another university, reassign event authorship, or move a
-- membership to a different person. Each of the following was reproduced before
-- being fixed, and each is re-tested in
-- supabase/scripts/test_072_protected_identity.sql.
--
-- ONE generic guard is installed rather than a per-table family of triggers or a
-- second permissive policy: existing RLS keeps deciding WHO may write, and this
-- decides WHICH COLUMNS may never change afterwards.
--
-- Trusted paths are intentionally unaffected. The function is SECURITY INVOKER,
-- so `current_user` is the role that actually issued the statement:
--   * PostgREST students run as `authenticated`               -> constrained
--   * SECURITY DEFINER RPCs/triggers owned by postgres        -> unconstrained
--     (update_club_member_count, sync_university_name, handle_new_user,
--      add_club_officer, leave_club, … all keep working unchanged)
--   * service_role admin maintenance and migrations           -> unconstrained
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION private.reject_protected_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_column text;
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
BEGIN
  -- Only the ordinary client role is constrained. Everything else is either a
  -- migration, an approved SECURITY DEFINER operation, or admin maintenance —
  -- the explicitly trusted paths that must still be able to repair data.
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  FOREACH v_column IN ARRAY TG_ARGV LOOP
    -- Change-only: a request that re-sends an identity column with its existing
    -- value (both clients' upsert paths do exactly this) is untouched.
    IF (v_old -> v_column) IS DISTINCT FROM (v_new -> v_column) THEN
      RAISE EXCEPTION
        'protected_identity_is_immutable: %.% cannot be changed by a client',
        TG_TABLE_NAME, v_column
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_protected_identity_change()
  FROM PUBLIC, anon, authenticated;

-- ── profiles ────────────────────────────────────────────────────────────────
-- Students edit username, full_name, avatar, bio, major, year, onboarding and
-- agreement columns. university_id/email_domain are resolved from the verified
-- signup address by handle_new_user and are never written by either client;
-- email_verified is an account-state fact a student must not self-assert.
DROP TRIGGER IF EXISTS trg_profiles_protect_identity ON public.profiles;
CREATE TRIGGER trg_profiles_protect_identity
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.reject_protected_identity_change(
    'id', 'university_id', 'email_domain', 'email_verified', 'is_seed', 'created_at'
  );

-- ── clubs ───────────────────────────────────────────────────────────────────
-- Officers keep full control of club CONTENT: name, description, avatar_url,
-- banner_url, cover_image_url, every meeting_* column, and is_active (mobile's
-- soft delete). member_count is maintained by update_club_member_count, and the
-- `university` display name by sync_university_name — both SECURITY DEFINER, so
-- both remain able to write here while a client cannot.
DROP TRIGGER IF EXISTS trg_clubs_protect_identity ON public.clubs;
CREATE TRIGGER trg_clubs_protect_identity
  BEFORE UPDATE ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION private.reject_protected_identity_change(
    'id', 'university_id', 'created_at', 'is_seed', 'claimed', 'member_count'
  );

-- ── events ──────────────────────────────────────────────────────────────────
-- Officers keep editing every content and audience column. The event may not be
-- moved to another club or reattributed to another creator.
DROP TRIGGER IF EXISTS trg_events_protect_identity ON public.events;
CREATE TRIGGER trg_events_protect_identity
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.reject_protected_identity_change(
    'id', 'club_id', 'created_by', 'created_at'
  );

-- ── club_members ────────────────────────────────────────────────────────────
-- `role` stays mutable: officer promotion/demotion is a legitimate officer
-- action and its canonical RPCs run as postgres. What an officer may not do is
-- reassign a membership row to a different person or a different club.
DROP TRIGGER IF EXISTS trg_club_members_protect_identity ON public.club_members;
CREATE TRIGGER trg_club_members_protect_identity
  BEFORE UPDATE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION private.reject_protected_identity_change(
    'id', 'user_id', 'club_id', 'joined_at'
  );

-- ── posts ───────────────────────────────────────────────────────────────────
-- club_id is deliberately NOT protected: tagging a post to any active club is an
-- existing open product feature in both clients, and official club posts are a
-- documented shared context. Authorship and creation time are not editable.
DROP TRIGGER IF EXISTS trg_posts_protect_identity ON public.posts;
CREATE TRIGGER trg_posts_protect_identity
  BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION private.reject_protected_identity_change(
    'id', 'author_id', 'created_at'
  );

-- ── event_rsvps ─────────────────────────────────────────────────────────────
-- `status` remains freely mutable through the ordinary RSVP flow; the row's
-- identity (which person, which event) does not.
DROP TRIGGER IF EXISTS trg_event_rsvps_protect_identity ON public.event_rsvps;
CREATE TRIGGER trg_event_rsvps_protect_identity
  BEFORE UPDATE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION private.reject_protected_identity_change(
    'id', 'user_id', 'event_id', 'created_at'
  );

COMMIT;
