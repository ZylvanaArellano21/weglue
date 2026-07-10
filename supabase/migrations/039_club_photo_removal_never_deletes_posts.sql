-- ============================================================
-- We Glue – Club photo removal can never delete a student's post
-- Migration: 039_club_photo_removal_never_deletes_posts.sql
-- ============================================================
-- delete_club_photo_everywhere() deleted the underlying POST when
-- the photo came from a tagged post — an officer moderating their
-- club's Photos that Glue could destroy another student's post,
-- its caption, likes, comments and shares app-wide. Officers may
-- only remove the post FROM THEIR CLUB. The function now strips
-- this club's association (same contract as remove_post_from_club)
-- and deletes only officer-upload photo rows. Server-side officer
-- authorization is unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION delete_club_photo_everywhere(p_photo_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_photo club_photos%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_photo FROM club_photos WHERE id = p_photo_id;
  IF v_photo.id IS NULL THEN
    RETURN; -- already gone — treat as success (idempotent)
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id = v_photo.club_id AND user_id = auth.uid() AND role = 'officer'
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_photo.post_id IS NOT NULL THEN
    -- Tagged post: remove ONLY this club's association. The post, its
    -- caption, image, owner, likes, comments and shares are preserved
    -- everywhere else; other clubs' tags stay.
    UPDATE posts SET club_id = NULL
    WHERE id = v_photo.post_id AND club_id = v_photo.club_id;

    DELETE FROM post_club_tags
    WHERE post_id = v_photo.post_id AND club_id = v_photo.club_id;

    DELETE FROM club_photos
    WHERE post_id = v_photo.post_id AND club_id = v_photo.club_id;
  ELSE
    DELETE FROM club_photos WHERE id = p_photo_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_club_photo_everywhere(UUID) TO authenticated;
