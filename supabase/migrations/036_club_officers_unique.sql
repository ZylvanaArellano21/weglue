-- ============================================================
-- We Glue – club_officers uniqueness
-- Migration: 036_club_officers_unique.sql
-- ============================================================
-- club_officers had NO unique constraint on (club_id, user_id),
-- so every "upsert ... ON CONFLICT (club_id, user_id)" — both the
-- old client path and the new add_club_officer() RPC — failed with
-- 42P10. De-dupe, then add the partial unique index (user_id can
-- be NULL for legacy/seed display rows).
-- ============================================================

DELETE FROM club_officers a
USING club_officers b
WHERE a.user_id IS NOT NULL
  AND a.user_id = b.user_id
  AND a.club_id = b.club_id
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_club_officers_club_user
  ON club_officers(club_id, user_id) WHERE user_id IS NOT NULL;
