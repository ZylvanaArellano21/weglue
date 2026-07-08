-- ============================================================================
-- We Glue – Event visibility + safe club-leave (officer rules)
-- Migration: 029_event_visibility_and_leave_club.sql
-- ============================================================================
--
-- Works identically on iOS (App Store) and Android (Play Store) — this is pure
-- Postgres/RLS, no platform-specific code.
--
-- 1. Rewrites the events SELECT policy so restricted events are only readable by
--    the people who should see them, enforced at the DATABASE layer (not just
--    the client feed filter):
--      • everyone-visibility  → all authenticated users
--      • creator              → always sees their own event
--      • hosting-club officer → always sees their club's events (any visibility)
--      • members-visibility   → members of the hosting club
--      • specific-visibility  → users listed in specific_user_ids
--
-- 2. Adds a race-safe leave_club(p_club_id) RPC that:
--      • blocks the SOLE officer of a club from leaving (would orphan the club)
--      • otherwise removes the caller's membership row, letting the existing
--        AFTER DELETE triggers (handle_club_leave in 010, rsvp cleanup in 023)
--        strip officer role, officer/club group-chat access, club_officers row
--        and members-only RSVPs — all atomically.
--    Concurrent leaves are serialized with FOR UPDATE row locks so two officers
--    leaving at the same moment can never drop the club to zero officers.
-- ============================================================================

-- 1. Event visibility RLS ----------------------------------------------------

DROP POLICY IF EXISTS "events: everyone can read public events" ON events;

CREATE POLICY "events: visibility-aware read"
  ON events FOR SELECT
  TO authenticated
  USING (
    visibility = 'everyone'
    OR created_by = auth.uid()
    OR is_club_officer(club_id)
    OR (
      visibility = 'members'
      AND EXISTS (
        SELECT 1 FROM club_members
        WHERE club_id = events.club_id AND user_id = auth.uid()
      )
    )
    OR (
      visibility = 'specific'
      AND specific_user_ids IS NOT NULL
      AND auth.uid() = ANY (specific_user_ids)
    )
  );

-- 2. Safe club-leave RPC -----------------------------------------------------

CREATE OR REPLACE FUNCTION leave_club(p_club_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user          UUID := auth.uid();
  v_role          TEXT;
  v_officer_count INT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Lock the caller's own membership row so their role can't change mid-check.
  SELECT role INTO v_role
  FROM club_members
  WHERE club_id = p_club_id AND user_id = v_user
  FOR UPDATE;

  IF v_role IS NULL THEN
    RETURN 'not_member';
  END IF;

  IF v_role = 'officer' THEN
    -- Lock every officer row for this club to serialize concurrent leaves,
    -- then count. If the caller is the last officer, refuse.
    SELECT count(*) INTO v_officer_count
    FROM club_members
    WHERE club_id = p_club_id AND role = 'officer'
    FOR UPDATE;

    IF v_officer_count <= 1 THEN
      RETURN 'blocked_only_officer';
    END IF;
  END IF;

  -- Only ever removes the caller (auth.uid()) — SECURITY DEFINER cannot be
  -- abused to remove other members.
  DELETE FROM club_members
  WHERE club_id = p_club_id AND user_id = v_user;

  RETURN 'left';
END;
$$;

GRANT EXECUTE ON FUNCTION leave_club(UUID) TO authenticated;
