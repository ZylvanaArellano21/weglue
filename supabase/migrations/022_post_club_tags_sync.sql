-- ============================================================
-- We Glue – Post Club Tags sync
-- Migration: 022_post_club_tags_sync.sql
-- ============================================================
-- post_club_tags already exists in production (created directly
-- against Supabase without a migration file). This migration brings
-- it into version control so local/GitHub schema history matches
-- production exactly. All statements are idempotent no-ops against
-- the current production database.
-- ============================================================

CREATE TABLE IF NOT EXISTS post_club_tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  club_id    UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, club_id)
);

CREATE INDEX IF NOT EXISTS idx_post_club_tags_post_id ON post_club_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_post_club_tags_club_id ON post_club_tags(club_id);

ALTER TABLE post_club_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_club_tags_select_public" ON post_club_tags;
CREATE POLICY "post_club_tags_select_public"
  ON post_club_tags FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "post_club_tags_insert_own" ON post_club_tags;
CREATE POLICY "post_club_tags_insert_own"
  ON post_club_tags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = post_club_tags.post_id AND posts.author_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "post_club_tags_delete_own" ON post_club_tags;
CREATE POLICY "post_club_tags_delete_own"
  ON post_club_tags FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.id = post_club_tags.post_id AND posts.author_id = auth.uid()
    )
  );
