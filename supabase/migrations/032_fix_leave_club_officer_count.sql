-- ============================================================================
-- Migration: 032_fix_leave_club_officer_count.sql
--
-- Fixes leave_club() from migration 029. Its officer-count check used
--   SELECT count(*) ... FOR UPDATE;
-- which PostgreSQL rejects at RUNTIME ("FOR UPDATE is not allowed with
-- aggregate functions") — CREATE FUNCTION succeeded because plpgsql bodies
-- are only parsed, not planned. Result: every officer leave attempt errored
-- and the app showed "Failed to leave club."
--
-- The row locks are kept (serializing concurrent officer leaves) by taking
-- FOR UPDATE inside a subquery and aggregating outside it.
-- ============================================================================

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
    -- then count the locked rows. If the caller is the last officer, refuse.
    SELECT count(*) INTO v_officer_count
    FROM (
      SELECT 1
      FROM club_members
      WHERE club_id = p_club_id AND role = 'officer'
      FOR UPDATE
    ) AS locked_officers;

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
