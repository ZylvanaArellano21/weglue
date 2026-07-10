-- ============================================================
-- We Glue – club_members UPDATE policy for officers
-- Migration: 034_club_members_update_policy.sql
-- ============================================================
-- club_members had INSERT/SELECT/DELETE policies but no UPDATE
-- policy, so every role change issued from the app (demote officer
-- → member via removeOfficer) silently updated 0 rows. Officers of
-- a club may update membership rows of that club (promotions go
-- through the add_club_officer RPC; demotions may come from the
-- Edit Club screen directly).
-- ============================================================

DROP POLICY IF EXISTS "club_members: officers can update roles" ON club_members;
CREATE POLICY "club_members: officers can update roles"
  ON club_members FOR UPDATE TO authenticated
  USING (is_club_officer(club_id))
  WITH CHECK (is_club_officer(club_id));
