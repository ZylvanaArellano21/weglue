-- ============================================================
-- We Glue – Reports system, deletion integrity, chat-sync
-- notifications, multi-day meeting schedule, officer RPCs
-- Migration: 033_reports_deletion_chat_sync_schedule.sql
-- ============================================================
-- ROOT CAUSES FIXED HERE (2026-07-09 audit):
--
-- 1. Account deletion was failing with a live error:
--      "new row for messages violates messages_shared_content_check"
--    DELETE FROM posts fires messages.shared_post_id ON DELETE SET
--    NULL, which produces a shared_post message with no post — a row
--    the CHECK constraint forbids. The same bomb existed for event
--    deletion via shared_event_id, and it also broke ordinary
--    "delete my post" whenever that post had been shared in a DM.
--    FIX: share messages now CASCADE with their content ("behaves
--    like the post never existed").
--
-- 2. club_photos.post_id was ON DELETE SET NULL, so deleting a post
--    left a ghost photo row in Photos that Glue (the BUG 4 data
--    inconsistency). FIX: cascade + cleanup of existing ghosts.
--
-- 3. Joining/leaving clubs synced group-chat membership (mig 010)
--    but produced NO notifications. FIX: triggers now write
--    club_chat_added / officer_chat_added / officer_role rows with
--    a pre-rendered message (notifications.message).
--
-- 4. There was no reports table at all — the Report menus were
--    dead UI. FIX: reports table + RLS.
--
-- 5. Officers could not be added from the app: club_members had no
--    UPDATE policy, so the member→officer upsert was silently
--    blocked by RLS. FIX: add_club_officer() SECURITY DEFINER RPC
--    with an explicit permission check.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. REPORTS TABLE
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reports (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  reporter_username TEXT,
  reporter_email    TEXT,
  entity_type       TEXT        NOT NULL CHECK (entity_type IN ('club','event','post','user','message','chat')),
  entity_id         UUID,
  entity_name       TEXT,
  club_id           UUID        REFERENCES clubs(id) ON DELETE SET NULL,
  reason            TEXT,
  details           TEXT,
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','reviewing','resolved','dismissed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_status  ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports: users insert own" ON reports;
CREATE POLICY "reports: users insert own"
  ON reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

DROP POLICY IF EXISTS "reports: users read own" ON reports;
CREATE POLICY "reports: users read own"
  ON reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS "reports: service role manages" ON reports;
CREATE POLICY "reports: service role manages"
  ON reports FOR ALL TO service_role
  USING (true);

-- ──────────────────────────────────────────────────────────────
-- 2. DELETION INTEGRITY — share messages + club photos follow
--    their content instead of orphaning
-- ──────────────────────────────────────────────────────────────

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_shared_post_id_fkey;
ALTER TABLE messages
  ADD CONSTRAINT messages_shared_post_id_fkey
  FOREIGN KEY (shared_post_id) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_shared_event_id_fkey;
ALTER TABLE messages
  ADD CONSTRAINT messages_shared_event_id_fkey
  FOREIGN KEY (shared_event_id) REFERENCES events(id) ON DELETE CASCADE;

ALTER TABLE club_photos DROP CONSTRAINT IF EXISTS club_photos_post_id_fkey;
ALTER TABLE club_photos
  ADD CONSTRAINT club_photos_post_id_fkey
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

-- Ghost rows left behind by the old SET NULL behavior: a tagged_post
-- photo whose post no longer exists must not appear anywhere.
DELETE FROM club_photos WHERE source = 'tagged_post' AND post_id IS NULL;

-- De-dupe before adding the uniqueness that ON CONFLICT needs.
DELETE FROM club_photos a
USING club_photos b
WHERE a.post_id IS NOT NULL
  AND a.post_id = b.post_id
  AND a.club_id = b.club_id
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_club_photos_club_post
  ON club_photos(club_id, post_id) WHERE post_id IS NOT NULL;

-- Multi-club tagged posts: the primary club tag already syncs into
-- club_photos (trg_post_tagged_club_photo); extra tags now do too,
-- so every tagged club shows the photo.
CREATE OR REPLACE FUNCTION handle_post_club_tag_photo()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post posts%ROWTYPE;
BEGIN
  SELECT * INTO v_post FROM posts WHERE id = NEW.post_id;
  IF v_post.id IS NOT NULL AND v_post.image_url IS NOT NULL THEN
    INSERT INTO club_photos (club_id, url, uploaded_by, source, post_id, is_visible)
    VALUES (NEW.club_id, v_post.image_url, v_post.author_id, 'tagged_post', v_post.id, true)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_club_tag_photo ON post_club_tags;
CREATE TRIGGER trg_post_club_tag_photo
  AFTER INSERT ON post_club_tags
  FOR EACH ROW EXECUTE FUNCTION handle_post_club_tag_photo();

-- Backfill: existing extra tags that never produced a photo row.
INSERT INTO club_photos (club_id, url, uploaded_by, source, post_id, is_visible)
SELECT t.club_id, p.image_url, p.author_id, 'tagged_post', p.id, true
FROM post_club_tags t
JOIN posts p ON p.id = t.post_id
WHERE p.image_url IS NOT NULL
ON CONFLICT DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- 3. NOTIFICATIONS — pre-rendered message + club/chat types
-- ──────────────────────────────────────────────────────────────

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message TEXT;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'follow_request', 'follow_accepted', 'new_follower', 'event_rsvp',
    'new_event', 'new_message', 'gluemate', 'like', 'comment', 'club_inactive',
    'club_chat_added', 'officer_chat_added', 'officer_role'
  ));

-- ──────────────────────────────────────────────────────────────
-- 4. CLUB JOIN / ROLE CHANGE → chat membership + notifications
--    (idempotent chat inserts; notifications fire once per event,
--    and fire AGAIN on re-join / re-assignment, per product spec)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_club_join()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_conv_id    UUID;
  v_officer_conv_id UUID;
  v_club_name       TEXT;
  v_added_member    BOOLEAN := false;
  v_added_officer   BOOLEAN := false;
BEGIN
  SELECT name INTO v_club_name FROM clubs WHERE id = NEW.club_id;

  -- Always add to member group chat
  SELECT id INTO v_club_conv_id
  FROM conversations
  WHERE club_id = NEW.club_id AND type = 'club_group'
  LIMIT 1;

  IF v_club_conv_id IS NOT NULL THEN
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_club_conv_id, NEW.user_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
    v_added_member := FOUND;
  END IF;

  -- If joining as officer, also add to officer_chat
  IF NEW.role = 'officer' THEN
    SELECT id INTO v_officer_conv_id
    FROM conversations
    WHERE club_id = NEW.club_id AND type = 'officer_chat'
    LIMIT 1;

    IF v_officer_conv_id IS NOT NULL THEN
      INSERT INTO conversation_participants (conversation_id, user_id)
      VALUES (v_officer_conv_id, NEW.user_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
      v_added_officer := FOUND;
    END IF;
  END IF;

  -- Notifications are best-effort: a notification failure must never
  -- block a join (mirrors migration 031's error-swallowing rule).
  BEGIN
    IF v_added_member AND v_club_name IS NOT NULL THEN
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
      VALUES (
        NEW.user_id, COALESCE(auth.uid(), NEW.user_id), 'club_chat_added',
        NEW.club_id, 'club', false,
        'You were added to ' || v_club_name || ' members group chat.'
      );
    END IF;
    IF v_added_officer AND v_club_name IS NOT NULL THEN
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
      VALUES (
        NEW.user_id, COALESCE(auth.uid(), NEW.user_id), 'officer_chat_added',
        NEW.club_id, 'club', false,
        'You were added to ' || v_club_name || ' officers group chat.'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_club_join notification failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION handle_club_member_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer_conv_id UUID;
  v_club_name       TEXT;
  v_added           BOOLEAN := false;
BEGIN
  SELECT id INTO v_officer_conv_id
  FROM conversations
  WHERE club_id = NEW.club_id AND type = 'officer_chat'
  LIMIT 1;

  IF v_officer_conv_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.role = 'officer' AND OLD.role = 'member' THEN
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_officer_conv_id, NEW.user_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
    v_added := FOUND;

    BEGIN
      SELECT name INTO v_club_name FROM clubs WHERE id = NEW.club_id;
      IF v_added AND v_club_name IS NOT NULL THEN
        INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
        VALUES (
          NEW.user_id, COALESCE(auth.uid(), NEW.user_id), 'officer_chat_added',
          NEW.club_id, 'club', false,
          'You were added to ' || v_club_name || ' officers group chat.'
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_club_member_role_change notification failed: %', SQLERRM;
    END;
  ELSIF NEW.role = 'member' AND OLD.role = 'officer' THEN
    DELETE FROM conversation_participants
    WHERE conversation_id = v_officer_conv_id AND user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Officer display record created/updated → "added as [Role] of [Club]".
CREATE OR REPLACE FUNCTION handle_club_officer_role_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_name TEXT;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT name INTO v_club_name FROM clubs WHERE id = NEW.club_id;
    IF v_club_name IS NOT NULL THEN
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
      VALUES (
        NEW.user_id, COALESCE(auth.uid(), NEW.user_id), 'officer_role',
        NEW.club_id, 'club', false,
        'You have been added as ' || NEW.role_title || ' of ' || v_club_name || '.'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_club_officer_role_notify failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_officer_role_notify ON club_officers;
CREATE TRIGGER trg_club_officer_role_notify
  AFTER INSERT OR UPDATE OF role_title ON club_officers
  FOR EACH ROW EXECUTE FUNCTION handle_club_officer_role_notify();

-- ──────────────────────────────────────────────────────────────
-- 5. ADD OFFICER — atomic, permission-checked, idempotent
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION add_club_officer(
  p_club_id    UUID,
  p_user_id    UUID,
  p_role_title TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_title   TEXT := btrim(COALESCE(p_role_title, ''));
  v_display_name TEXT;
  v_avatar_url   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id = p_club_id AND user_id = auth.uid() AND role = 'officer'
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF length(v_role_title) < 2 OR length(v_role_title) > 40 THEN
    RAISE EXCEPTION 'invalid_role_title';
  END IF;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), username), avatar_url
  INTO v_display_name, v_avatar_url
  FROM profiles WHERE id = p_user_id;

  IF v_display_name IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  -- Member row: insert as officer, or promote an existing member.
  -- Fires handle_club_join / handle_club_member_role_change, which
  -- handle both group chats + notifications idempotently.
  INSERT INTO club_members (club_id, user_id, role)
  VALUES (p_club_id, p_user_id, 'officer')
  ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'officer'
  WHERE club_members.role IS DISTINCT FROM 'officer';

  -- Display record with the typed role title. The conflict target names the
  -- partial unique index uq_club_officers_club_user (user_id IS NOT NULL) —
  -- p_user_id is always non-null here.
  INSERT INTO club_officers (club_id, user_id, role_title, display_name, avatar_url)
  VALUES (p_club_id, p_user_id, v_role_title, v_display_name, v_avatar_url)
  ON CONFLICT (club_id, user_id) WHERE user_id IS NOT NULL DO UPDATE
    SET role_title = EXCLUDED.role_title,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url;
END;
$$;

GRANT EXECUTE ON FUNCTION add_club_officer(UUID, UUID, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 6. DELETE CLUB POST EVERYWHERE — officer moderation of
--    Photos that Glue (tagged posts + officer uploads)
-- ──────────────────────────────────────────────────────────────

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
    -- Full post deletion: cascades clean post_likes, post_comments,
    -- post_club_tags, share messages, and every club_photos row for
    -- this post (all clubs) — it behaves like the post never existed.
    DELETE FROM posts WHERE id = v_photo.post_id;
  ELSE
    DELETE FROM club_photos WHERE id = p_photo_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_club_photo_everywhere(UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 7. MULTI-DAY MEETING SCHEDULE
--    meeting_schedule: JSONB array of {day, start, end}. Legacy
--    single-day columns stay populated with the first entry so
--    older builds keep rendering a schedule.
-- ──────────────────────────────────────────────────────────────

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS meeting_schedule JSONB;

UPDATE clubs
SET meeting_schedule = jsonb_build_array(
  jsonb_build_object(
    'day',   meeting_day,
    'start', meeting_time_start::text,
    'end',   meeting_time_end::text
  )
)
WHERE meeting_day IS NOT NULL AND meeting_schedule IS NULL;
