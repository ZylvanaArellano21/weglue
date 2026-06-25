-- ============================================================
-- We Glue – Home Tab Schema
-- Migration: 004_home_tab.sql
-- ============================================================

-- ============================================================
-- 1. EXTEND NOTIFICATION TYPES (+like, +comment, +post entity)
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'follow_request', 'follow_accepted', 'event_rsvp',
    'new_event', 'new_message', 'gluemate', 'like', 'comment'
  ));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_entity_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type IN ('event', 'club', 'message', 'post'));

-- ============================================================
-- 2. POST INTERACTIONS (likes + comments)
-- ============================================================

CREATE TABLE IF NOT EXISTS post_likes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON post_likes(user_id);

CREATE TABLE IF NOT EXISTS post_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_user_id ON post_comments(user_id);

ALTER TABLE post_likes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_likes: anyone authenticated can read"
  ON post_likes FOR SELECT TO authenticated USING (true);

CREATE POLICY "post_likes: users manage own"
  ON post_likes FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "post_comments: anyone authenticated can read"
  ON post_comments FOR SELECT TO authenticated USING (true);

CREATE POLICY "post_comments: users insert own"
  ON post_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "post_comments: users delete own"
  ON post_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- 3. STORAGE BUCKET FOR POSTS IMAGES
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'posts',
  'posts',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "posts bucket: authenticated can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'posts');

CREATE POLICY "posts bucket: public can read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'posts');

CREATE POLICY "posts bucket: users delete own"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'posts' AND owner = auth.uid());

-- ============================================================
-- 4. AUTO GROUP CHAT TRIGGERS
-- ============================================================

-- Join club → add to club_group conversation
CREATE OR REPLACE FUNCTION handle_club_join()
RETURNS TRIGGER AS $$
DECLARE
  v_conv_id UUID;
BEGIN
  SELECT id INTO v_conv_id
  FROM conversations
  WHERE club_id = NEW.club_id AND type = 'club_group'
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, NEW.user_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_club_join_add_to_gc ON club_members;
CREATE TRIGGER trg_club_join_add_to_gc
  AFTER INSERT ON club_members
  FOR EACH ROW EXECUTE FUNCTION handle_club_join();

-- Leave club → remove from member GC + officer chat + club_officers entry
CREATE OR REPLACE FUNCTION handle_club_leave()
RETURNS TRIGGER AS $$
DECLARE
  v_club_conv_id    UUID;
  v_officer_conv_id UUID;
BEGIN
  SELECT id INTO v_club_conv_id
  FROM conversations
  WHERE club_id = OLD.club_id AND type = 'club_group'
  LIMIT 1;

  IF v_club_conv_id IS NOT NULL THEN
    DELETE FROM conversation_participants
    WHERE conversation_id = v_club_conv_id AND user_id = OLD.user_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM club_officers
    WHERE club_id = OLD.club_id AND user_id = OLD.user_id
  ) THEN
    SELECT id INTO v_officer_conv_id
    FROM conversations
    WHERE club_id = OLD.club_id AND type = 'officer_chat'
    LIMIT 1;

    IF v_officer_conv_id IS NOT NULL THEN
      DELETE FROM conversation_participants
      WHERE conversation_id = v_officer_conv_id AND user_id = OLD.user_id;
    END IF;

    DELETE FROM club_officers
    WHERE club_id = OLD.club_id AND user_id = OLD.user_id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_club_leave_remove_from_gc ON club_members;
CREATE TRIGGER trg_club_leave_remove_from_gc
  AFTER DELETE ON club_members
  FOR EACH ROW EXECUTE FUNCTION handle_club_leave();

-- Add to club_officers → join officer_chat conversation
CREATE OR REPLACE FUNCTION handle_officer_addition()
RETURNS TRIGGER AS $$
DECLARE
  v_officer_conv_id UUID;
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    SELECT id INTO v_officer_conv_id
    FROM conversations
    WHERE club_id = NEW.club_id AND type = 'officer_chat'
    LIMIT 1;

    IF v_officer_conv_id IS NOT NULL THEN
      INSERT INTO conversation_participants (conversation_id, user_id)
      VALUES (v_officer_conv_id, NEW.user_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_officer_addition_to_gc ON club_officers;
CREATE TRIGGER trg_officer_addition_to_gc
  AFTER INSERT ON club_officers
  FOR EACH ROW EXECUTE FUNCTION handle_officer_addition();

-- Remove from club_officers → leave officer_chat only (stay in member GC)
CREATE OR REPLACE FUNCTION handle_officer_removal()
RETURNS TRIGGER AS $$
DECLARE
  v_officer_conv_id UUID;
BEGIN
  IF OLD.user_id IS NOT NULL THEN
    SELECT id INTO v_officer_conv_id
    FROM conversations
    WHERE club_id = OLD.club_id AND type = 'officer_chat'
    LIMIT 1;

    IF v_officer_conv_id IS NOT NULL THEN
      DELETE FROM conversation_participants
      WHERE conversation_id = v_officer_conv_id AND user_id = OLD.user_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_officer_removal_from_gc ON club_officers;
CREATE TRIGGER trg_officer_removal_from_gc
  AFTER DELETE ON club_officers
  FOR EACH ROW EXECUTE FUNCTION handle_officer_removal();
