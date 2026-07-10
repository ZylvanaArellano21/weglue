-- ============================================================
-- We Glue – officers can see (and therefore hide) hidden photos
-- Migration: 037_club_photos_officer_visibility.sql
-- ============================================================
-- "Hide from this club" (UPDATE is_visible=false) was rejected with
-- "new row violates row-level security": the SELECT policy
-- (is_visible = true) is applied to the post-update row, so an
-- officer could never actually flip a photo to hidden. Officers of
-- the club may see hidden rows — regular users still only see
-- visible ones, and every app query additionally filters
-- is_visible = true.
-- ============================================================

DROP POLICY IF EXISTS "club_photos: anyone can read visible" ON club_photos;
CREATE POLICY "club_photos: anyone can read visible"
  ON club_photos FOR SELECT TO authenticated
  USING (is_visible = true OR is_club_officer(club_id));
