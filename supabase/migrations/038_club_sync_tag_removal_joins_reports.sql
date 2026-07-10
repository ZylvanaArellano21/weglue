-- ============================================================
-- We Glue – Club-data consistency pass
-- Migration: 038_club_sync_tag_removal_joins_reports.sql
-- ============================================================
-- ROOT CAUSES FIXED HERE (2026-07-10 audit):
--
-- 1. Club conversations stored the club name as duplicated text
--    ("Eich club · Members") written once at creation and never
--    updated on rename. FIX: rename trigger keeps both
--    conversations in sync + one-time repair of stale rows.
--
-- 2. Officers had no safe way to remove a tagged post from their
--    club: "Hide from this club" left the tag visible on the post
--    everywhere, "Delete everywhere" destroyed the student's post.
--    FIX: remove_post_from_club() strips ONLY this club's
--    association (posts.club_id / post_club_tags / club_photos)
--    and preserves the post, caption, likes, comments and shares.
--
-- 3. Officer removal ran as two unchecked client mutations (role
--    downgrade + display-row delete) with no notification. FIX:
--    remove_club_officer() — atomic, permission-checked, notifies
--    the removed officer, and the existing role-change trigger
--    still revokes officer-chat access.
--
-- 4. Deleting an event/post CASCADE-deleted the chat messages it
--    was shared in (migration 033 overshot). FIX: share messages
--    survive with a NULL shared id and render "This event/post is
--    no longer available."
--
-- 5. Joining a club produced no join notifications. FIX:
--    handle_club_join now writes "You joined X." to the joiner and
--    "Name joined X." to every existing member/officer (deduped by
--    club_members being the single membership table; the trigger
--    only fires on a genuinely new membership INSERT, so retries /
--    double taps / re-upserts cannot duplicate).
--
-- 6. Report emails had no delivery bookkeeping. FIX: reports gains
--    email_sent_at / email_error so send-report-email is idempotent
--    and failures are recorded for retry.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. CLUB RENAME → conversation names stay in sync
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_club_renamed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE conversations
  SET name = NEW.name || ' · Members'
  WHERE club_id = NEW.id AND type = 'club_group';

  UPDATE conversations
  SET name = NEW.name || ' · Officers'
  WHERE club_id = NEW.id AND type = 'officer_chat';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_renamed_conversations ON clubs;
CREATE TRIGGER trg_club_renamed_conversations
  AFTER UPDATE OF name ON clubs
  FOR EACH ROW
  WHEN (OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION handle_club_renamed();

-- One-time repair of every stale conversation title (e.g. the club
-- renamed "Eich club" → "American Association").
UPDATE conversations c
SET name = cl.name || CASE WHEN c.type = 'club_group' THEN ' · Members' ELSE ' · Officers' END
FROM clubs cl
WHERE cl.id = c.club_id
  AND c.type IN ('club_group', 'officer_chat')
  AND c.name IS DISTINCT FROM
      (cl.name || CASE WHEN c.type = 'club_group' THEN ' · Members' ELSE ' · Officers' END);

-- ──────────────────────────────────────────────────────────────
-- 2. REMOVE POST FROM CLUB — officer moderation that preserves
--    the student's post. Strips only THIS club's association:
--    posts.club_id (primary tag), post_club_tags row (extra tag),
--    club_photos row (Photos that Glue). Idempotent.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION remove_post_from_club(p_post_id UUID, p_club_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Current officer authorization checked on the server, per request.
  IF NOT EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id = p_club_id AND user_id = auth.uid() AND role = 'officer'
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Primary tag lives on the post row itself.
  UPDATE posts SET club_id = NULL
  WHERE id = p_post_id AND club_id = p_club_id;

  -- Extra tags live in post_club_tags.
  DELETE FROM post_club_tags
  WHERE post_id = p_post_id AND club_id = p_club_id;

  -- Photos that Glue entry for THIS club only.
  DELETE FROM club_photos
  WHERE post_id = p_post_id AND club_id = p_club_id;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_post_from_club(UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 3. REMOVE OFFICER — atomic, permission-checked, notifies.
--    The role downgrade fires handle_club_member_role_change,
--    which already revokes officer-chat access.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION remove_club_officer(p_club_id UUID, p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_name TEXT;
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

  IF p_user_id = auth.uid() THEN
    -- Officers step down via the leave flow, which protects the
    -- sole-officer case; self-demotion here could orphan the club.
    RAISE EXCEPTION 'cannot_remove_self';
  END IF;

  -- Downgrade the authoritative role (revokes officer chat via trigger).
  UPDATE club_members SET role = 'member'
  WHERE club_id = p_club_id AND user_id = p_user_id AND role = 'officer';

  -- Remove the display record shown on club + personal profiles.
  DELETE FROM club_officers
  WHERE club_id = p_club_id AND user_id = p_user_id;

  -- Best-effort notification (mirrors migration 031/033 rule).
  BEGIN
    SELECT name INTO v_club_name FROM clubs WHERE id = p_club_id;
    IF v_club_name IS NOT NULL THEN
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
      VALUES (
        p_user_id, auth.uid(), 'officer_removed',
        p_club_id, 'club', false,
        'You are no longer an officer of ' || v_club_name || '.'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'remove_club_officer notification failed: %', SQLERRM;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION remove_club_officer(UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────
-- 4. NOTIFICATION TYPES — officer removal + club joins
-- ──────────────────────────────────────────────────────────────

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'follow_request', 'follow_accepted', 'new_follower', 'event_rsvp',
    'new_event', 'new_message', 'gluemate', 'like', 'comment', 'club_inactive',
    'club_chat_added', 'officer_chat_added', 'officer_role',
    'officer_removed', 'club_joined', 'member_joined'
  ));

-- ──────────────────────────────────────────────────────────────
-- 5. CLUB JOIN → chat membership + join notifications
--    (replaces the 033 version; the trigger fires only on INSERT,
--    i.e. a genuinely new membership — an upsert on an existing
--    membership updates instead, so no duplicate notifications from
--    retries / double taps / multiple devices. Leaving and joining
--    again is a fresh INSERT and notifies again, per spec.)
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
  v_joiner_name     TEXT;
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
    IF v_club_name IS NOT NULL THEN
      -- Personal confirmation to the joiner.
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
      VALUES (
        NEW.user_id, NEW.user_id, 'club_joined',
        NEW.club_id, 'club', false,
        'You joined ' || v_club_name || '.'
      );

      -- Broadcast to every unique existing member/officer of the club
      -- (club_members is the single membership table, so officers are
      -- naturally deduped), never to the joiner.
      SELECT COALESCE(NULLIF(btrim(full_name), ''), username)
      INTO v_joiner_name
      FROM profiles WHERE id = NEW.user_id;

      IF v_joiner_name IS NOT NULL THEN
        INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
        SELECT DISTINCT cm.user_id, NEW.user_id, 'member_joined',
               NEW.club_id, 'club', false,
               v_joiner_name || ' joined ' || v_club_name || '.'
        FROM club_members cm
        WHERE cm.club_id = NEW.club_id
          AND cm.user_id <> NEW.user_id;
      END IF;
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

-- ──────────────────────────────────────────────────────────────
-- 6. SHARE MESSAGES SURVIVE CONTENT DELETION
--    Deleting an event/post must NOT delete the chat messages it
--    was shared in. The message keeps its place in the thread and
--    the app renders "This event/post is no longer available."
--    (CHECK is relaxed so the SET NULL result is a legal row; the
--    original account-deletion bug from migration 033 stays fixed
--    because SET NULL no longer violates the constraint.)
-- ──────────────────────────────────────────────────────────────

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_shared_content_check;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_shared_post_id_fkey;
ALTER TABLE messages
  ADD CONSTRAINT messages_shared_post_id_fkey
  FOREIGN KEY (shared_post_id) REFERENCES posts(id) ON DELETE SET NULL;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_shared_event_id_fkey;
ALTER TABLE messages
  ADD CONSTRAINT messages_shared_event_id_fkey
  FOREIGN KEY (shared_event_id) REFERENCES events(id) ON DELETE SET NULL;

-- A share message may outlive its content (NULL id) but a live id is
-- still only legal on the matching message type.
ALTER TABLE messages ADD CONSTRAINT messages_shared_content_check
  CHECK (
    (shared_event_id IS NULL OR message_type = 'shared_event')
    AND (shared_post_id IS NULL OR message_type = 'shared_post')
  );

-- ──────────────────────────────────────────────────────────────
-- 7. EVENT DELETION → stale notifications cleanup
--    Deleted events must not be reachable through old notification
--    rows (tapping one would open a dead event).
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_event_deleted_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM notifications
  WHERE entity_type = 'event' AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_deleted_notifications ON events;
CREATE TRIGGER trg_event_deleted_notifications
  AFTER DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION handle_event_deleted_notifications();

-- ──────────────────────────────────────────────────────────────
-- 8. REPORT EMAIL BOOKKEEPING — idempotent sends + retryable
--    failures (send-report-email reads/writes these columns).
-- ──────────────────────────────────────────────────────────────

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_error   TEXT;
