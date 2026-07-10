-- ============================================================
-- We Glue – Officer chats get their own #general channel
-- Migration: 035_officer_chat_channels.sql
-- ============================================================
-- Officer conversations were created with ZERO channels
-- (handle_club_created only seeded channels for the member chat).
-- The chat screen resolves channels by CLUB, so opening Admin Chat
-- redirected into the MEMBER chat's #general — the wrong-chat /
-- double-chat flicker bug. Every officer chat now has its own
-- #general, and future clubs get one automatically.
--
-- NOTE: is_default marks "seeded system channel" in this schema
-- (all three member channels carry it), matching how the club
-- creation trigger has always used the flag.
-- ============================================================

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

  -- Default channels: members get general/announcements/events,
  -- officers get their own general.
  INSERT INTO conversation_channels (conversation_id, name, display_order, is_default, is_restricted)
  VALUES
    (v_member_conv_id,  'general',       0, TRUE, FALSE),
    (v_member_conv_id,  'announcements', 1, TRUE, TRUE),
    (v_member_conv_id,  'events',        2, TRUE, FALSE),
    (v_officer_conv_id, 'general',       0, TRUE, FALSE);

  RETURN NEW;
END;
$$;

-- Backfill every existing officer chat that has no channel yet.
INSERT INTO conversation_channels (conversation_id, name, display_order, is_default, is_restricted)
SELECT c.id, 'general', 0, TRUE, FALSE
FROM conversations c
WHERE c.type = 'officer_chat'
  AND NOT EXISTS (
    SELECT 1 FROM conversation_channels ch WHERE ch.conversation_id = c.id
  );
