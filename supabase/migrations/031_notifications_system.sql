-- ============================================================
-- We Glue – Instagram-style notification system + follow requests
-- Migration: 031_notifications_system.sql
--
-- AUDIT RESULT (2026-07-08): the notifications table, type CHECK
-- and read/unread state already existed, but almost nothing wrote
-- to it — only the mobile client inserted follow_request /
-- follow_accepted rows by hand (and used the wrong entity_type).
-- Likes, comments, new followers, accepted requests, gluemates and
-- new events produced NO notifications at all, and declining a
-- request didn't exist.
--
-- THIS MIGRATION centralizes all notification creation in
-- SECURITY DEFINER triggers so every write path (mobile, web,
-- future API) produces exactly one notification per action:
--
--   follows INSERT  pending  -> follow_request  (to the private user)
--   follows INSERT  accepted -> new_follower    (public follow)
--                               + gluemate to both when mutual
--   follows UPDATE  pending->accepted
--                            -> deletes the follow_request row,
--                               new_follower   (to the accepter),
--                               follow_accepted (to the requester),
--                               + gluemate to both when mutual
--   follows DELETE  pending  -> removes the stale follow_request
--   post_likes INSERT        -> like    (to the post author)
--   post_likes DELETE        -> removes the matching like row
--   post_comments INSERT     -> comment (to the post author)
--   events INSERT            -> new_event (to the club's members,
--                               honoring event visibility)
--
-- Every trigger body swallows its own errors: a notification
-- hiccup must never roll back the user action that caused it.
-- Deduping is done with NOT EXISTS guards — no duplicate rows for
-- the same actor/action/entity.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Type CHECK: add 'new_follower' (someone started following
--    you) so it is distinct from 'follow_accepted' (they accepted
--    YOUR request). Existing values stay valid.
-- ------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'follow_request', 'follow_accepted', 'new_follower', 'event_rsvp',
    'new_event', 'new_message', 'gluemate', 'like', 'comment', 'club_inactive'
  ));

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, read) WHERE read = false;

-- ------------------------------------------------------------
-- 2. Small helper: insert once (deduped on user/actor/type/entity)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION insert_notification_once(
  p_user_id UUID,
  p_actor_id UUID,
  p_type TEXT,
  p_entity_id UUID DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_actor_id IS NULL OR p_user_id = p_actor_id THEN
    RETURN;
  END IF;

  INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read)
  SELECT p_user_id, p_actor_id, p_type, p_entity_id, p_entity_type, false
  WHERE NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.user_id = p_user_id
      AND n.actor_id = p_actor_id
      AND n.type = p_type
      AND n.entity_id IS NOT DISTINCT FROM p_entity_id
  );
END;
$$;

-- ------------------------------------------------------------
-- 3. Follows: request / new follower / accepted / gluemate
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_follow_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.status = 'pending' THEN
      PERFORM insert_notification_once(NEW.following_id, NEW.follower_id, 'follow_request');
    ELSIF NEW.status = 'accepted' THEN
      PERFORM insert_notification_once(NEW.following_id, NEW.follower_id, 'new_follower');
      -- Mutual accepted follow = Gluemates. Tell both users.
      IF EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = NEW.following_id
          AND f.following_id = NEW.follower_id
          AND f.status = 'accepted'
      ) THEN
        PERFORM insert_notification_once(NEW.following_id, NEW.follower_id, 'gluemate');
        PERFORM insert_notification_once(NEW.follower_id, NEW.following_id, 'gluemate');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_follow_insert notification failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_follow_insert_notify ON follows;
CREATE TRIGGER trg_follow_insert_notify
  AFTER INSERT ON follows
  FOR EACH ROW EXECUTE FUNCTION handle_follow_insert();

CREATE OR REPLACE FUNCTION handle_follow_accept()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
      -- The request is resolved — replace it in the accepter's list.
      DELETE FROM notifications
      WHERE user_id = NEW.following_id
        AND actor_id = NEW.follower_id
        AND type = 'follow_request';

      PERFORM insert_notification_once(NEW.following_id, NEW.follower_id, 'new_follower');
      PERFORM insert_notification_once(NEW.follower_id, NEW.following_id, 'follow_accepted');

      IF EXISTS (
        SELECT 1 FROM follows f
        WHERE f.follower_id = NEW.following_id
          AND f.following_id = NEW.follower_id
          AND f.status = 'accepted'
      ) THEN
        PERFORM insert_notification_once(NEW.following_id, NEW.follower_id, 'gluemate');
        PERFORM insert_notification_once(NEW.follower_id, NEW.following_id, 'gluemate');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_follow_accept notification failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_follow_accept_notify ON follows;
CREATE TRIGGER trg_follow_accept_notify
  AFTER UPDATE ON follows
  FOR EACH ROW EXECUTE FUNCTION handle_follow_accept();

-- Declining / cancelling a pending request removes the stale
-- follow_request notification so it can't be accepted twice.
CREATE OR REPLACE FUNCTION handle_follow_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF OLD.status = 'pending' THEN
      DELETE FROM notifications
      WHERE user_id = OLD.following_id
        AND actor_id = OLD.follower_id
        AND type = 'follow_request';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_follow_delete notification failed: %', SQLERRM;
  END;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_follow_delete_notify ON follows;
CREATE TRIGGER trg_follow_delete_notify
  AFTER DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION handle_follow_delete();

-- ------------------------------------------------------------
-- 4. Likes
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_post_like_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author UUID;
BEGIN
  BEGIN
    SELECT author_id INTO v_author FROM posts WHERE id = NEW.post_id;
    PERFORM insert_notification_once(v_author, NEW.user_id, 'like', NEW.post_id, 'post');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_post_like_notify failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_like_notify ON post_likes;
CREATE TRIGGER trg_post_like_notify
  AFTER INSERT ON post_likes
  FOR EACH ROW EXECUTE FUNCTION handle_post_like_notify();

CREATE OR REPLACE FUNCTION handle_post_unlike_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author UUID;
BEGIN
  BEGIN
    SELECT author_id INTO v_author FROM posts WHERE id = OLD.post_id;
    DELETE FROM notifications
    WHERE user_id = v_author
      AND actor_id = OLD.user_id
      AND type = 'like'
      AND entity_id = OLD.post_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_post_unlike_notify failed: %', SQLERRM;
  END;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_unlike_notify ON post_likes;
CREATE TRIGGER trg_post_unlike_notify
  AFTER DELETE ON post_likes
  FOR EACH ROW EXECUTE FUNCTION handle_post_unlike_notify();

-- ------------------------------------------------------------
-- 5. Comments (one notification per comment, like Instagram)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_post_comment_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author UUID;
BEGIN
  BEGIN
    SELECT author_id INTO v_author FROM posts WHERE id = NEW.post_id;
    IF v_author IS NOT NULL AND v_author <> NEW.user_id THEN
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read)
      VALUES (v_author, NEW.user_id, 'comment', NEW.post_id, 'post', false);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_post_comment_notify failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_comment_notify ON post_comments;
CREATE TRIGGER trg_post_comment_notify
  AFTER INSERT ON post_comments
  FOR EACH ROW EXECUTE FUNCTION handle_post_comment_notify();

-- ------------------------------------------------------------
-- 6. New event → notify the hosting club's members
--    (honors event visibility; 'specific' notifies only the list)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_event_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.visibility = 'specific' THEN
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read)
      SELECT uid, NEW.created_by, 'new_event', NEW.id, 'event', false
      FROM unnest(COALESCE(NEW.specific_user_ids, ARRAY[]::uuid[])) AS uid
      WHERE uid <> NEW.created_by;
    ELSE
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read)
      SELECT cm.user_id, NEW.created_by, 'new_event', NEW.id, 'event', false
      FROM club_members cm
      WHERE cm.club_id = NEW.club_id
        AND cm.user_id <> NEW.created_by;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_event_notify failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_new_event_notify ON events;
CREATE TRIGGER trg_new_event_notify
  AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION handle_new_event_notify();

-- ------------------------------------------------------------
-- 7. Realtime + delete policy (accept flow cleans its own rows;
--    users may also clear their own notifications later)
-- ------------------------------------------------------------
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications; EXCEPTION WHEN others THEN NULL; END $$;

DROP POLICY IF EXISTS "notifications: users delete own" ON notifications;
CREATE POLICY "notifications: users delete own"
  ON notifications FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
