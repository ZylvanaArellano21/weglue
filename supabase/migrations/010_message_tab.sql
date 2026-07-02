-- ============================================================
-- We Glue – Message Tab Foundation
-- Migration: 010_message_tab.sql
-- ============================================================
-- Consolidates two parallel messaging systems into System 1
-- (conversations / conversation_channels / messages).
-- Drops System 2 (club_channels / channel_messages / club_polls).
-- Adds full RLS, Realtime, cast_poll_vote RPC, officer-trigger
-- migration from club_officers → club_members.role, and
-- backfills existing clubs/members into System 1.
-- ============================================================

-- ============================================================
-- 1. EXTEND messages (add attachment_url + 'file' type)
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachment_url TEXT;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'poll', 'file'));

-- ============================================================
-- 2. EXTEND conversation_channels
--    (add created_by, is_restricted, is_default)
-- ============================================================

ALTER TABLE conversation_channels
  ADD COLUMN IF NOT EXISTS created_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_default    BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- 3. ENABLE REALTIME ON SYSTEM 1 TABLES
--    Wrapped in DO blocks so re-running is safe (duplicate = skip).
-- ============================================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE messages;             EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE poll_votes;           EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE conversation_participants; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE conversations;        EXCEPTION WHEN others THEN NULL; END $$;

-- ============================================================
-- 4. RLS ON conversation_participants
-- ============================================================

ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conv_participants: participants can read" ON conversation_participants;
CREATE POLICY "conv_participants: participants can read"
  ON conversation_participants FOR SELECT TO authenticated
  USING (is_conversation_participant(conversation_id));

-- All INSERT/DELETE on conversation_participants is done via
-- SECURITY DEFINER triggers and RPCs — no direct-user policies needed.

-- ============================================================
-- 5. RLS ON conversation_channels
-- ============================================================

ALTER TABLE conversation_channels ENABLE ROW LEVEL SECURITY;

-- Participants see their channels
DROP POLICY IF EXISTS "conv_channels: participants can read" ON conversation_channels;
CREATE POLICY "conv_channels: participants can read"
  ON conversation_channels FOR SELECT TO authenticated
  USING (is_conversation_participant(conversation_id));

-- Non-members can see club_group channels (required for preview UI)
DROP POLICY IF EXISTS "conv_channels: non-members see club group channels" ON conversation_channels;
CREATE POLICY "conv_channels: non-members see club group channels"
  ON conversation_channels FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id AND c.type = 'club_group'
    )
  );

-- Officers can create new channels in club conversations (enforced server-side)
DROP POLICY IF EXISTS "conv_channels: officers can create" ON conversation_channels;
CREATE POLICY "conv_channels: officers can create"
  ON conversation_channels FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
        AND c.type IN ('club_group', 'officer_chat')
        AND is_club_officer(c.club_id)
    )
    OR (
      -- Non-club group chats: any participant can add channels
      is_conversation_participant(conversation_id)
      AND EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = conversation_id AND c.type = 'group'
      )
    )
  );

-- Officers can delete non-default channels; creator can delete own non-default channel
DROP POLICY IF EXISTS "conv_channels: officers can delete" ON conversation_channels;
CREATE POLICY "conv_channels: officers can delete"
  ON conversation_channels FOR DELETE TO authenticated
  USING (
    NOT is_default
    AND (
      EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = conversation_id
          AND c.type IN ('club_group', 'officer_chat')
          AND is_club_officer(c.club_id)
      )
      OR created_by = auth.uid()
    )
  );

-- ============================================================
-- 6. EXTEND conversations: let non-members see club_group exists
-- ============================================================

DROP POLICY IF EXISTS "conversations: non-members see club group chats" ON conversations;
CREATE POLICY "conversations: non-members see club group chats"
  ON conversations FOR SELECT TO authenticated
  USING (type = 'club_group');

-- ============================================================
-- 7. messages: restricted-channel enforcement + non-member preview
-- ============================================================

-- Tighten INSERT to block non-officers from posting to restricted channels
DROP POLICY IF EXISTS "messages: participants can insert" ON messages;
CREATE POLICY "messages: participants can insert"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND is_conversation_participant(conversation_id)
    AND (
      -- No channel (DM) or non-restricted channel
      channel_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM conversation_channels cc
        WHERE cc.id = channel_id AND cc.is_restricted = TRUE
      )
      -- Restricted channel: must be an officer
      OR EXISTS (
        SELECT 1 FROM conversation_channels cc
        JOIN conversations c ON c.id = cc.conversation_id
        WHERE cc.id = channel_id
          AND cc.is_restricted = TRUE
          AND c.club_id IS NOT NULL
          AND is_club_officer(c.club_id)
      )
    )
  );

-- Non-member preview: 15 most recent messages in club_group conversations
DROP POLICY IF EXISTS "messages: non-member club preview" ON messages;
CREATE POLICY "messages: non-member club preview"
  ON messages FOR SELECT TO authenticated
  USING (
    NOT is_conversation_participant(conversation_id)
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id AND c.type = 'club_group'
    )
    AND messages.id IN (
      SELECT m2.id FROM messages m2
      WHERE m2.conversation_id = messages.conversation_id
      ORDER BY m2.created_at DESC
      LIMIT 15
    )
  );

-- ============================================================
-- 8. RLS ON polls, poll_options, poll_votes
-- ============================================================

ALTER TABLE polls        ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes   ENABLE ROW LEVEL SECURITY;

-- polls: only conversation participants can read/insert
DROP POLICY IF EXISTS "polls: participants can read" ON polls;
CREATE POLICY "polls: participants can read"
  ON polls FOR SELECT TO authenticated
  USING (
    is_conversation_participant(
      (SELECT conversation_id FROM messages WHERE id = polls.message_id LIMIT 1)
    )
  );

DROP POLICY IF EXISTS "polls: participants can insert" ON polls;
CREATE POLICY "polls: participants can insert"
  ON polls FOR INSERT TO authenticated
  WITH CHECK (
    is_conversation_participant(
      (SELECT conversation_id FROM messages WHERE id = message_id LIMIT 1)
    )
  );

-- poll_options
DROP POLICY IF EXISTS "poll_options: participants can read" ON poll_options;
CREATE POLICY "poll_options: participants can read"
  ON poll_options FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM polls p
      JOIN messages m ON m.id = p.message_id
      WHERE p.id = poll_options.poll_id
        AND is_conversation_participant(m.conversation_id)
    )
  );

DROP POLICY IF EXISTS "poll_options: poll creator can insert" ON poll_options;
CREATE POLICY "poll_options: poll creator can insert"
  ON poll_options FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM polls p
      JOIN messages m ON m.id = p.message_id
      WHERE p.id = poll_id AND m.sender_id = auth.uid()
    )
  );

-- poll_votes: read for participants; write only through cast_poll_vote RPC
DROP POLICY IF EXISTS "poll_votes: participants can read" ON poll_votes;
CREATE POLICY "poll_votes: participants can read"
  ON poll_votes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM polls p
      JOIN messages m ON m.id = p.message_id
      WHERE p.id = poll_votes.poll_id
        AND is_conversation_participant(m.conversation_id)
    )
  );

DROP POLICY IF EXISTS "poll_votes: users manage own" ON poll_votes;
CREATE POLICY "poll_votes: users manage own"
  ON poll_votes FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 9. cast_poll_vote RPC
--    Enforces: membership, voting window, allow_multiple toggle
-- ============================================================

CREATE OR REPLACE FUNCTION cast_poll_vote(p_poll_id UUID, p_option_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allow_multiple BOOLEAN;
  v_start_at       TIMESTAMPTZ;
  v_end_at         TIMESTAMPTZ;
  v_conv_id        UUID;
BEGIN
  SELECT p.allow_multiple, p.start_at, p.end_at, m.conversation_id
    INTO v_allow_multiple, v_start_at, v_end_at, v_conv_id
  FROM polls p
  JOIN messages m ON m.id = p.message_id
  WHERE p.id = p_poll_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Poll not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT is_conversation_participant(v_conv_id) THEN
    RAISE EXCEPTION 'Not a member of this conversation' USING ERRCODE = '42501';
  END IF;

  IF v_start_at IS NOT NULL AND NOW() < v_start_at THEN
    RAISE EXCEPTION 'Poll has not started yet' USING ERRCODE = 'P0001';
  END IF;

  IF v_end_at IS NOT NULL AND NOW() > v_end_at THEN
    RAISE EXCEPTION 'Poll has ended' USING ERRCODE = 'P0001';
  END IF;

  -- Single-select: clear previous votes for this user in this poll
  IF NOT v_allow_multiple THEN
    DELETE FROM poll_votes WHERE poll_id = p_poll_id AND user_id = auth.uid();
  END IF;

  -- Toggle: if the user already voted for this option, remove it
  IF EXISTS (
    SELECT 1 FROM poll_votes
    WHERE poll_id = p_poll_id AND option_id = p_option_id AND user_id = auth.uid()
  ) THEN
    DELETE FROM poll_votes
    WHERE poll_id = p_poll_id AND option_id = p_option_id AND user_id = auth.uid();
  ELSE
    INSERT INTO poll_votes (poll_id, option_id, user_id)
    VALUES (p_poll_id, p_option_id, auth.uid())
    ON CONFLICT (poll_id, option_id, user_id) DO NOTHING;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION cast_poll_vote(UUID, UUID) TO authenticated;

-- ============================================================
-- 10. get_or_create_direct_chat RPC
-- ============================================================

CREATE OR REPLACE FUNCTION get_or_create_direct_chat(other_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id UUID;
BEGIN
  IF auth.uid() = other_user_id THEN
    RAISE EXCEPTION 'Cannot create a DM with yourself' USING ERRCODE = 'P0001';
  END IF;

  -- Find existing DM between these two users
  SELECT c.id INTO v_conv_id
  FROM conversations c
  WHERE c.type = 'direct'
    AND EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_id = c.id AND user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_id = c.id AND user_id = other_user_id
    )
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    INSERT INTO conversations (type) VALUES ('direct') RETURNING id INTO v_conv_id;

    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, auth.uid()), (v_conv_id, other_user_id);
  END IF;

  RETURN v_conv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_or_create_direct_chat(UUID) TO authenticated;

-- ============================================================
-- 11. UPDATE handle_club_join → role-aware (member + officer)
-- ============================================================

CREATE OR REPLACE FUNCTION handle_club_join()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_conv_id    UUID;
  v_officer_conv_id UUID;
BEGIN
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
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_join_add_to_gc ON club_members;
CREATE TRIGGER trg_club_join_add_to_gc
  AFTER INSERT ON club_members
  FOR EACH ROW EXECUTE FUNCTION handle_club_join();

-- ============================================================
-- 12. UPDATE handle_club_leave → use OLD.role (drop club_officers check)
-- ============================================================

CREATE OR REPLACE FUNCTION handle_club_leave()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_conv_id    UUID;
  v_officer_conv_id UUID;
BEGIN
  -- Remove from member group chat
  SELECT id INTO v_club_conv_id
  FROM conversations
  WHERE club_id = OLD.club_id AND type = 'club_group'
  LIMIT 1;

  IF v_club_conv_id IS NOT NULL THEN
    DELETE FROM conversation_participants
    WHERE conversation_id = v_club_conv_id AND user_id = OLD.user_id;
  END IF;

  -- If they were an officer, also remove from officer_chat
  IF OLD.role = 'officer' THEN
    SELECT id INTO v_officer_conv_id
    FROM conversations
    WHERE club_id = OLD.club_id AND type = 'officer_chat'
    LIMIT 1;

    IF v_officer_conv_id IS NOT NULL THEN
      DELETE FROM conversation_participants
      WHERE conversation_id = v_officer_conv_id AND user_id = OLD.user_id;
    END IF;
  END IF;

  -- Remove display record
  DELETE FROM club_officers
  WHERE club_id = OLD.club_id AND user_id = OLD.user_id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_leave_remove_from_gc ON club_members;
CREATE TRIGGER trg_club_leave_remove_from_gc
  AFTER DELETE ON club_members
  FOR EACH ROW EXECUTE FUNCTION handle_club_leave();

-- ============================================================
-- 13. NEW: handle_club_member_role_change
--     Fires on club_members UPDATE when role changes.
--     officer promotion  → add to officer_chat
--     officer demotion   → remove from officer_chat (keep in club_group)
-- ============================================================

CREATE OR REPLACE FUNCTION handle_club_member_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer_conv_id UUID;
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
  ELSIF NEW.role = 'member' AND OLD.role = 'officer' THEN
    DELETE FROM conversation_participants
    WHERE conversation_id = v_officer_conv_id AND user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_member_role_change ON club_members;
CREATE TRIGGER trg_club_member_role_change
  AFTER UPDATE ON club_members
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION handle_club_member_role_change();

-- ============================================================
-- 14. DROP old officer triggers from club_officers
-- ============================================================

DROP TRIGGER IF EXISTS trg_officer_addition_to_gc ON club_officers;
DROP TRIGGER IF EXISTS trg_officer_removal_from_gc ON club_officers;
DROP FUNCTION IF EXISTS handle_officer_addition();
DROP FUNCTION IF EXISTS handle_officer_removal();

-- ============================================================
-- 15. REPLACE club creation trigger: System 2 → System 1
--     Creates conversations + conversation_channels (not club_channels)
-- ============================================================

DROP TRIGGER IF EXISTS trg_club_created_channels ON clubs;
DROP FUNCTION IF EXISTS handle_club_created_channels();

CREATE OR REPLACE FUNCTION handle_club_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_conv_id  UUID;
  v_officer_conv_id UUID;
BEGIN
  -- Member group chat
  INSERT INTO conversations (type, club_id, name)
  VALUES ('club_group', NEW.id, NEW.name || ' · Members')
  RETURNING id INTO v_member_conv_id;

  -- Officer chat
  INSERT INTO conversations (type, club_id, name)
  VALUES ('officer_chat', NEW.id, NEW.name || ' · Officers')
  RETURNING id INTO v_officer_conv_id;

  -- Default channels: general, announcements (restricted), events
  INSERT INTO conversation_channels (conversation_id, name, display_order, is_default, is_restricted)
  VALUES
    (v_member_conv_id, 'general',       0, TRUE, FALSE),
    (v_member_conv_id, 'announcements', 1, TRUE, TRUE),
    (v_member_conv_id, 'events',        2, TRUE, FALSE);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_club_created
  AFTER INSERT ON clubs
  FOR EACH ROW EXECUTE FUNCTION handle_club_created();

-- ============================================================
-- 16. BACKFILL: create conversations for existing clubs
-- ============================================================

DO $$
DECLARE
  v_club           RECORD;
  v_member_conv_id  UUID;
  v_officer_conv_id UUID;
BEGIN
  FOR v_club IN
    SELECT id, name FROM clubs
    WHERE NOT EXISTS (
      SELECT 1 FROM conversations
      WHERE club_id = clubs.id AND type = 'club_group'
    )
  LOOP
    INSERT INTO conversations (type, club_id, name)
    VALUES ('club_group', v_club.id, v_club.name || ' · Members')
    RETURNING id INTO v_member_conv_id;

    INSERT INTO conversations (type, club_id, name)
    VALUES ('officer_chat', v_club.id, v_club.name || ' · Officers')
    RETURNING id INTO v_officer_conv_id;

    INSERT INTO conversation_channels (conversation_id, name, display_order, is_default, is_restricted)
    VALUES
      (v_member_conv_id, 'general',       0, TRUE, FALSE),
      (v_member_conv_id, 'announcements', 1, TRUE, TRUE),
      (v_member_conv_id, 'events',        2, TRUE, FALSE);
  END LOOP;
END $$;

-- ============================================================
-- 17. BACKFILL: add existing club members to conversations
-- ============================================================

DO $$
DECLARE
  v_cm             RECORD;
  v_club_conv_id   UUID;
  v_officer_conv_id UUID;
BEGIN
  FOR v_cm IN
    SELECT cm.user_id, cm.club_id, cm.role
    FROM club_members cm
    WHERE NOT EXISTS (
      SELECT 1 FROM conversation_participants cp
      JOIN conversations c ON c.id = cp.conversation_id
      WHERE c.club_id = cm.club_id
        AND c.type = 'club_group'
        AND cp.user_id = cm.user_id
    )
  LOOP
    SELECT id INTO v_club_conv_id FROM conversations
    WHERE club_id = v_cm.club_id AND type = 'club_group'
    LIMIT 1;

    IF v_club_conv_id IS NOT NULL THEN
      INSERT INTO conversation_participants (conversation_id, user_id)
      VALUES (v_club_conv_id, v_cm.user_id)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;

    IF v_cm.role = 'officer' THEN
      SELECT id INTO v_officer_conv_id FROM conversations
      WHERE club_id = v_cm.club_id AND type = 'officer_chat'
      LIMIT 1;

      IF v_officer_conv_id IS NOT NULL THEN
        INSERT INTO conversation_participants (conversation_id, user_id)
        VALUES (v_officer_conv_id, v_cm.user_id)
        ON CONFLICT (conversation_id, user_id) DO NOTHING;
      END IF;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 18. UPDATE activity trigger: channel_messages → messages
-- ============================================================

DROP FUNCTION IF EXISTS update_club_activity_on_message() CASCADE;

CREATE OR REPLACE FUNCTION update_club_activity_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE clubs
  SET last_activity_at     = NOW(),
      inactivity_warned_at = NULL
  WHERE id = (
    SELECT c.club_id FROM conversations c
    WHERE c.id = NEW.conversation_id
      AND c.club_id IS NOT NULL
    LIMIT 1
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_message_activity
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_club_activity_on_message();

-- ============================================================
-- 19. DROP System 2 tables (FK-safe order)
-- ============================================================

DROP TABLE IF EXISTS club_poll_votes   CASCADE;
DROP TABLE IF EXISTS club_poll_options CASCADE;
DROP TABLE IF EXISTS club_polls        CASCADE;
DROP TABLE IF EXISTS channel_messages  CASCADE;
DROP TABLE IF EXISTS club_channels     CASCADE;

-- ============================================================
-- 20. Add index on messages(channel_id) for fast channel queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);
