-- ============================================================================
-- 040_messaging_overhaul.sql
-- Complete messaging-system foundation pass.
--
-- Fixes shipped here (see session notes for the client half):
--   • polls.created_at drift — the live table was missing the column the app
--     selects after every poll insert, so EVERY poll send errored after the
--     poll row was already written (orphan poll + message rows).
--   • Soft-delete message model: unsend-for-everyone (deleted_at/deleted_by),
--     delete-for-me (message_hides), official-chat clear, custom-group delete.
--   • Conversation inbox state: hidden_at / cleared_before on participants so
--     deleting a DM never deletes the pair row (which used to create
--     duplicate DM threads on the next message).
--   • Custom groups: conversations.created_by (single administrator).
--   • Non-expiring opaque chat invitations + same-university join RPCs.
--   • Atomic create_poll / create_group_chat RPCs (no partial records).
--   • Attachment metadata + 'video' message type + client_tag send dedupe.
--   • chat-attachments storage re-keyed from club membership to conversation
--     participation (DM/custom-group uploads were impossible before).
--   • RLS tightening: conversation_participants INSERT was WITH CHECK (true)
--     (anyone could add themselves to ANY conversation); conversations INSERT
--     was unrestricted; messages UPDATE had no WITH CHECK.
--   • Message reports with protected moderation snapshots that survive unsend.
--
-- CRITICAL INVARIANT (do not regress): chat participation and club
-- membership are SEPARATE. Leaving/hiding/muting/deleting a conversation
-- NEVER touches club_members / club_officers. Only the club→chat direction
-- is synced (handle_club_join / handle_club_leave triggers).
-- ============================================================================

-- ─── 1. Schema drift fix: polls.created_at ─────────────────────────────────
ALTER TABLE polls ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ─── 2. messages: soft delete, attachment metadata, dedupe tag, video ──────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size BIGINT,
  ADD COLUMN IF NOT EXISTS attachment_mime TEXT,
  ADD COLUMN IF NOT EXISTS client_tag UUID;

-- Retry-safe sends: the client generates one client_tag per logical message;
-- a retried insert with the same tag hits this index instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_sender_client_tag
  ON messages (sender_id, client_tag) WHERE client_tag IS NOT NULL;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type = ANY (ARRAY['text','image','video','poll','file','shared_event','shared_post']));

-- A message's channel must belong to the message's conversation (previously
-- uncheckable cross-links were possible; live data verified clean).
ALTER TABLE conversation_channels
  ADD CONSTRAINT uq_conversation_channels_id_conv UNIQUE (id, conversation_id);
ALTER TABLE messages
  ADD CONSTRAINT messages_channel_conversation_fkey
  FOREIGN KEY (channel_id, conversation_id)
  REFERENCES conversation_channels (id, conversation_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages (conversation_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_conv_media
  ON messages (conversation_id, created_at DESC)
  WHERE deleted_at IS NULL AND message_type IN ('image','video','file');

-- ─── 3. Delete-for-me (per-user message hide) ───────────────────────────────
CREATE TABLE IF NOT EXISTS message_hides (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  hidden_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
ALTER TABLE message_hides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "message_hides: users manage own" ON message_hides
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─── 4. Conversation inbox state ────────────────────────────────────────────
-- hidden_at: conversation removed from THIS user's Message tab (delete-for-me
--   on a conversation, or leaving-an-official-chat's "gone from inbox" state
--   when the row is kept). Any new message clears it (restore-on-message).
-- cleared_before: messages at/before this instant stay hidden for this user
--   even after the conversation restores (Instagram-style DM delete).
ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleared_before TIMESTAMPTZ;

-- Custom groups: single administrator; deleted_at = delete-for-everyone.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Restore-on-message: a new message un-hides the conversation for everyone
-- still participating (their cleared_before keeps old history hidden).
CREATE OR REPLACE FUNCTION unhide_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE conversation_participants
  SET hidden_at = NULL
  WHERE conversation_id = NEW.conversation_id AND hidden_at IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_unhide_conversation_on_message ON messages;
CREATE TRIGGER trg_unhide_conversation_on_message
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION unhide_conversation_on_message();

-- ─── 5. RLS tightening ──────────────────────────────────────────────────────
-- conversation_participants INSERT was WITH CHECK (true): any authenticated
-- user could add anyone (including themselves) to any private conversation.
-- All legitimate adds now flow through SECURITY DEFINER paths (club triggers,
-- DM/group/invite RPCs) except self-REJOIN of an official chat the user is
-- entitled to by club role — that stays direct so "reopen from club profile"
-- works even offline-first.
DROP POLICY IF EXISTS "conv_participants: authenticated can insert" ON conversation_participants;
CREATE POLICY "conv_participants: self rejoin official chats" ON conversation_participants
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
        AND (
          (c.type = 'club_group'   AND is_club_member(c.club_id))
          OR (c.type = 'officer_chat' AND is_club_officer(c.club_id))
        )
    )
  );

-- Users can update ONLY their own participation state (hide/clear/read).
CREATE POLICY "conv_participants: users update own state" ON conversation_participants
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- conversations INSERT was unrestricted (any client could fabricate a
-- club_group conversation for any club). DM/group creation is RPC-only now.
DROP POLICY IF EXISTS "conversations: authenticated can create" ON conversations;

-- Group admins may rename / change picture of their custom group.
CREATE POLICY "conversations: group admin updates meta" ON conversations
  FOR UPDATE USING (type = 'group' AND created_by = auth.uid())
  WITH CHECK (type = 'group' AND created_by = auth.uid());

-- messages UPDATE had no WITH CHECK (sender could move a message to another
-- conversation). Recreate constrained.
DROP POLICY IF EXISTS "messages: senders can update" ON messages;
CREATE POLICY "messages: senders can update own" ON messages
  FOR UPDATE USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());

-- ─── 6. Unsend for everyone (server-authorized) ─────────────────────────────
-- Sender may unsend own message. In official club chats, officers may also
-- remove (moderation "delete for everyone"). Custom groups: the group admin.
CREATE OR REPLACE FUNCTION unsend_message(p_message_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_msg RECORD;
  v_conv RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT m.id, m.sender_id, m.conversation_id INTO v_msg
  FROM messages m WHERE m.id = p_message_id AND m.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT c.type, c.club_id, c.created_by INTO v_conv
  FROM conversations c WHERE c.id = v_msg.conversation_id;

  IF v_msg.sender_id = auth.uid()
     OR (v_conv.type IN ('club_group','officer_chat') AND is_club_officer(v_conv.club_id))
     OR (v_conv.type = 'group' AND v_conv.created_by = auth.uid())
  THEN
    UPDATE messages SET deleted_at = now(), deleted_by = auth.uid()
    WHERE id = p_message_id;
  ELSE
    RAISE EXCEPTION 'not_authorized';
  END IF;
END;
$$;

-- ─── 7. Atomic poll creation ────────────────────────────────────────────────
-- One transaction for message + poll + options; validates the channel belongs
-- to the conversation and restricted-channel officer rules. Retry-safe via
-- p_client_tag (returns the existing poll instead of duplicating).
CREATE OR REPLACE FUNCTION create_poll(
  p_conversation_id UUID,
  p_channel_id UUID,
  p_question TEXT,
  p_options TEXT[],
  p_allow_multiple BOOLEAN DEFAULT false,
  p_start_at TIMESTAMPTZ DEFAULT NULL,
  p_end_at TIMESTAMPTZ DEFAULT NULL,
  p_client_tag UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_message_id UUID;
  v_poll_id UUID;
  v_opt TEXT;
  v_idx INT := 0;
  v_channel RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT is_conversation_participant(p_conversation_id) THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;
  IF btrim(COALESCE(p_question,'')) = '' THEN RAISE EXCEPTION 'question_required'; END IF;
  IF p_options IS NULL OR array_length(array_remove(ARRAY(SELECT btrim(o) FROM unnest(p_options) o WHERE btrim(o) <> ''), NULL), 1) < 2 THEN
    RAISE EXCEPTION 'need_two_options';
  END IF;
  IF p_start_at IS NOT NULL AND p_end_at IS NOT NULL AND p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'end_before_start';
  END IF;

  IF p_channel_id IS NOT NULL THEN
    SELECT cc.conversation_id, cc.is_restricted INTO v_channel
    FROM conversation_channels cc WHERE cc.id = p_channel_id;
    IF NOT FOUND OR v_channel.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION 'channel_mismatch';
    END IF;
    IF v_channel.is_restricted THEN
      IF NOT EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = p_conversation_id AND c.club_id IS NOT NULL AND is_club_officer(c.club_id)
      ) THEN
        RAISE EXCEPTION 'channel_restricted';
      END IF;
    END IF;
  END IF;

  -- Retry: same tag → return the already-created poll.
  IF p_client_tag IS NOT NULL THEN
    SELECT m.id, p.id INTO v_message_id, v_poll_id
    FROM messages m JOIN polls p ON p.message_id = m.id
    WHERE m.sender_id = auth.uid() AND m.client_tag = p_client_tag;
    IF FOUND THEN
      RETURN json_build_object('message_id', v_message_id, 'poll_id', v_poll_id);
    END IF;
  END IF;

  INSERT INTO messages (conversation_id, channel_id, sender_id, content, message_type, client_tag)
  VALUES (p_conversation_id, p_channel_id, auth.uid(), NULL, 'poll', p_client_tag)
  RETURNING id INTO v_message_id;

  INSERT INTO polls (message_id, question, allow_multiple, start_at, end_at)
  VALUES (v_message_id, btrim(p_question), COALESCE(p_allow_multiple,false), p_start_at, p_end_at)
  RETURNING id INTO v_poll_id;

  FOREACH v_opt IN ARRAY p_options LOOP
    IF btrim(v_opt) <> '' THEN
      INSERT INTO poll_options (poll_id, option_text, display_order)
      VALUES (v_poll_id, btrim(v_opt), v_idx);
      v_idx := v_idx + 1;
    END IF;
  END LOOP;

  RETURN json_build_object('message_id', v_message_id, 'poll_id', v_poll_id);
END;
$$;

-- ─── 8. Direct chats: reuse + restore instead of duplicate ─────────────────
-- Replaces 010's version: unhides the caller's row when the pair already
-- exists (deleted-inbox restore) and never creates a second thread.
CREATE OR REPLACE FUNCTION get_or_create_direct_chat(other_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF auth.uid() = other_user_id THEN
    RAISE EXCEPTION 'Cannot create a DM with yourself' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = other_user_id) THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  SELECT c.id INTO v_conv_id
  FROM conversations c
  WHERE c.type = 'direct'
    AND c.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = other_user_id)
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    INSERT INTO conversations (type, created_by) VALUES ('direct', auth.uid()) RETURNING id INTO v_conv_id;
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, auth.uid()), (v_conv_id, other_user_id);
  END IF;

  RETURN v_conv_id;
END;
$$;

-- ─── 9. Custom groups (atomic create; draft-until-first-message) ───────────
CREATE OR REPLACE FUNCTION create_group_chat(
  p_name TEXT,
  p_participant_ids UUID[],
  p_first_message TEXT DEFAULT NULL,
  p_client_tag UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv_id UUID;
  v_uid UUID;
  v_clean_ids UUID[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT ARRAY(
    SELECT DISTINCT pid FROM unnest(COALESCE(p_participant_ids, '{}')) pid
    WHERE pid IS NOT NULL AND pid <> auth.uid()
      AND EXISTS (SELECT 1 FROM profiles WHERE id = pid)
  ) INTO v_clean_ids;

  IF array_length(v_clean_ids, 1) IS NULL OR array_length(v_clean_ids, 1) < 1 THEN
    RAISE EXCEPTION 'need_participants';
  END IF;
  IF array_length(v_clean_ids, 1) > 100 THEN
    RAISE EXCEPTION 'too_many_participants';
  END IF;

  -- Retry: same first-message tag → the group was already created.
  IF p_client_tag IS NOT NULL THEN
    SELECT m.conversation_id INTO v_conv_id
    FROM messages m WHERE m.sender_id = auth.uid() AND m.client_tag = p_client_tag;
    IF FOUND THEN RETURN v_conv_id; END IF;
  END IF;

  INSERT INTO conversations (type, name, created_by)
  VALUES ('group', NULLIF(btrim(COALESCE(p_name,'')), ''), auth.uid())
  RETURNING id INTO v_conv_id;

  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_conv_id, auth.uid());
  FOREACH v_uid IN ARRAY v_clean_ids LOOP
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, v_uid) ON CONFLICT DO NOTHING;
  END LOOP;

  IF p_first_message IS NOT NULL AND btrim(p_first_message) <> '' THEN
    INSERT INTO messages (conversation_id, sender_id, content, message_type, client_tag)
    VALUES (v_conv_id, auth.uid(), btrim(p_first_message), 'text', p_client_tag);
  END IF;

  -- Best-effort notifications (never block creation).
  BEGIN
    INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
    SELECT v_uid2, auth.uid(), 'group_chat_added', v_conv_id, 'message', false,
           'You were added to a group chat.'
    FROM unnest(v_clean_ids) v_uid2;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'create_group_chat notifications failed: %', SQLERRM;
  END;

  RETURN v_conv_id;
END;
$$;

-- Group admin management ------------------------------------------------------
CREATE OR REPLACE FUNCTION add_group_participants(p_conversation_id UUID, p_user_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE id = p_conversation_id AND type = 'group' AND created_by = auth.uid() AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  FOREACH v_uid IN ARRAY COALESCE(p_user_ids,'{}') LOOP
    IF v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM profiles WHERE id = v_uid) THEN
      INSERT INTO conversation_participants (conversation_id, user_id)
      VALUES (p_conversation_id, v_uid)
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET hidden_at = NULL;
      BEGIN
        INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
        VALUES (v_uid, auth.uid(), 'group_chat_added', p_conversation_id, 'message', false,
                'You were added to a group chat.');
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION remove_group_participant(p_conversation_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE id = p_conversation_id AND type = 'group' AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'use_leave_group'; END IF;

  DELETE FROM conversation_participants
  WHERE conversation_id = p_conversation_id AND user_id = p_user_id;
END;
$$;

-- Leaving a custom group. The creator must transfer ownership or delete the
-- group for everyone when other participants remain (no orphaned groups).
CREATE OR REPLACE FUNCTION leave_group_chat(p_conversation_id UUID, p_transfer_to UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv RECORD;
  v_others INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT id, type, created_by INTO v_conv
  FROM conversations WHERE id = p_conversation_id AND type = 'group';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_a_group'; END IF;
  IF NOT is_conversation_participant(p_conversation_id) THEN RETURN 'not_member'; END IF;

  SELECT count(*) INTO v_others
  FROM conversation_participants
  WHERE conversation_id = p_conversation_id AND user_id <> auth.uid();

  IF v_conv.created_by = auth.uid() AND v_others > 0 THEN
    IF p_transfer_to IS NULL THEN
      RETURN 'transfer_required';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_id = p_conversation_id AND user_id = p_transfer_to
    ) THEN
      RAISE EXCEPTION 'transfer_target_not_participant';
    END IF;
    UPDATE conversations SET created_by = p_transfer_to WHERE id = p_conversation_id;
  END IF;

  DELETE FROM conversation_participants
  WHERE conversation_id = p_conversation_id AND user_id = auth.uid();

  -- Last person out: the group is over — soft-delete the conversation.
  IF v_others = 0 THEN
    UPDATE conversations SET deleted_at = now() WHERE id = p_conversation_id;
  END IF;

  RETURN 'left';
END;
$$;

-- Custom-group delete-for-everyone (admin only). Report snapshots live in
-- reports and are unaffected.
CREATE OR REPLACE FUNCTION delete_group_conversation(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE id = p_conversation_id AND type = 'group' AND created_by = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE messages SET deleted_at = now(), deleted_by = auth.uid()
  WHERE conversation_id = p_conversation_id AND deleted_at IS NULL;
  UPDATE conversations SET deleted_at = now() WHERE id = p_conversation_id;
  DELETE FROM conversation_participants WHERE conversation_id = p_conversation_id;
END;
$$;

-- ─── 10. Official chat participation (leave/reopen/clear) ──────────────────
-- Reopen restores inbox visibility and/or the participant row. Club role is
-- validated but NEVER modified here.
CREATE OR REPLACE FUNCTION reopen_club_chat(p_club_id UUID, p_type TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_type NOT IN ('club_group','officer_chat') THEN RAISE EXCEPTION 'invalid_type'; END IF;

  IF p_type = 'club_group' AND NOT is_club_member(p_club_id) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;
  IF p_type = 'officer_chat' AND NOT is_club_officer(p_club_id) THEN
    RAISE EXCEPTION 'not_an_officer';
  END IF;

  SELECT id INTO v_conv_id FROM conversations
  WHERE club_id = p_club_id AND type = p_type LIMIT 1;
  IF v_conv_id IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;

  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_conv_id, auth.uid())
  ON CONFLICT (conversation_id, user_id) DO UPDATE SET hidden_at = NULL;

  RETURN v_conv_id;
END;
$$;

-- Officer "delete for everyone" on an official chat: clears visible history
-- for all participants and removes it from inboxes. Club, members, roles and
-- the conversation row itself are untouched — reopening yields a clean chat.
CREATE OR REPLACE FUNCTION clear_official_chat(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT type, club_id INTO v_conv FROM conversations WHERE id = p_conversation_id;
  IF NOT FOUND OR v_conv.type NOT IN ('club_group','officer_chat') THEN
    RAISE EXCEPTION 'not_official_chat';
  END IF;
  IF NOT is_club_officer(v_conv.club_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  UPDATE messages SET deleted_at = now(), deleted_by = auth.uid()
  WHERE conversation_id = p_conversation_id AND deleted_at IS NULL;

  UPDATE conversation_participants SET hidden_at = now()
  WHERE conversation_id = p_conversation_id;
END;
$$;

-- ─── 11. Officer member management (canonical, server-authorized) ──────────
CREATE OR REPLACE FUNCTION add_club_member_by_officer(p_club_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_club_name TEXT;
  v_club_univ TEXT;
  v_user_univ TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT is_club_officer(p_club_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT name, university INTO v_club_name, v_club_univ FROM clubs WHERE id = p_club_id;
  SELECT university INTO v_user_univ FROM profiles WHERE id = p_user_id;
  IF v_user_univ IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_club_univ IS NOT NULL AND v_user_univ IS DISTINCT FROM v_club_univ THEN
    RAISE EXCEPTION 'different_university';
  END IF;

  -- handle_club_join fires: adds Members-chat participant + join notifications.
  INSERT INTO club_members (club_id, user_id, role)
  VALUES (p_club_id, p_user_id, 'member')
  ON CONFLICT (club_id, user_id) DO NOTHING;

  -- If they had left/hidden the chat before, restore inbox visibility.
  UPDATE conversation_participants cp SET hidden_at = NULL
  FROM conversations c
  WHERE c.id = cp.conversation_id AND c.club_id = p_club_id
    AND c.type = 'club_group' AND cp.user_id = p_user_id;

  BEGIN
    IF v_club_name IS NOT NULL THEN
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
      VALUES (p_user_id, auth.uid(), 'club_chat_added', p_club_id, 'club', false,
              'You were added to ' || v_club_name || '. You are now a member and can access the Members chat.');
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

-- "Remove from Members chat" = remove from the club (explicit officer
-- moderation). Officers must be demoted first — this also guarantees the
-- last-officer protection can never be bypassed through member removal.
CREATE OR REPLACE FUNCTION remove_club_member_by_officer(p_club_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_club_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT is_club_officer(p_club_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'use_leave_club'; END IF;

  SELECT role INTO v_role FROM club_members
  WHERE club_id = p_club_id AND user_id = p_user_id;
  IF v_role IS NULL THEN RETURN; END IF;
  IF v_role = 'officer' THEN RAISE EXCEPTION 'demote_officer_first'; END IF;

  -- handle_club_leave fires: removes chat participants + officer display rows.
  DELETE FROM club_members WHERE club_id = p_club_id AND user_id = p_user_id;

  BEGIN
    SELECT name INTO v_club_name FROM clubs WHERE id = p_club_id;
    IF v_club_name IS NOT NULL THEN
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
      VALUES (p_user_id, auth.uid(), 'club_removed', p_club_id, 'club', false,
              'You were removed from ' || v_club_name || '.');
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

-- ─── 12. Non-expiring chat invitations ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_invitations_conv ON chat_invitations (conversation_id);
ALTER TABLE chat_invitations ENABLE ROW LEVEL SECURITY;
-- No direct client policies: tokens are minted/validated exclusively through
-- the SECURITY DEFINER RPCs below, so tokens can't be enumerated.

CREATE OR REPLACE FUNCTION can_manage_chat_invitation(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = p_conversation_id
      AND c.deleted_at IS NULL
      AND (
        (c.type = 'club_group' AND is_club_officer(c.club_id))
        OR (c.type = 'group' AND c.created_by = auth.uid())
      )
  );
$$;

-- Members-chat invites: officers only. Custom groups: admin only. Officers
-- chat and DMs: never. Tokens are opaque (256-bit) and never expire; they can
-- only be rotated/revoked by an authorized manager.
CREATE OR REPLACE FUNCTION get_or_create_chat_invitation(p_conversation_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_token TEXT;
  v_club_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT can_manage_chat_invitation(p_conversation_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT token INTO v_token FROM chat_invitations
  WHERE conversation_id = p_conversation_id AND revoked_at IS NULL
  ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NOT NULL THEN RETURN v_token; END IF;

  SELECT club_id INTO v_club_id FROM conversations WHERE id = p_conversation_id;
  -- pgcrypto lives in the extensions schema on Supabase; qualify explicitly
  -- because this function pins search_path to public.
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO chat_invitations (token, conversation_id, club_id, created_by)
  VALUES (v_token, p_conversation_id, v_club_id, auth.uid());

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION rotate_chat_invitation(p_conversation_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT can_manage_chat_invitation(p_conversation_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE chat_invitations SET revoked_at = now()
  WHERE conversation_id = p_conversation_id AND revoked_at IS NULL;
  RETURN get_or_create_chat_invitation(p_conversation_id);
END;
$$;

-- Safe pre-join preview for the landing screen (no membership required, no
-- join side effects; exposes only what the invite page must render).
CREATE OR REPLACE FUNCTION preview_chat_invitation(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
BEGIN
  SELECT ci.conversation_id, ci.revoked_at, c.type, c.name, c.club_id, c.deleted_at,
         cl.name AS club_name, cl.avatar_url AS club_avatar, cl.university AS club_university,
         p.university AS creator_university,
         COALESCE(NULLIF(btrim(p.full_name),''), p.username) AS creator_name
  INTO v
  FROM chat_invitations ci
  JOIN conversations c ON c.id = ci.conversation_id
  LEFT JOIN clubs cl ON cl.id = c.club_id
  LEFT JOIN profiles p ON p.id = ci.created_by
  WHERE ci.token = p_token;

  IF NOT FOUND OR v.revoked_at IS NOT NULL OR v.deleted_at IS NOT NULL THEN
    RETURN json_build_object('valid', false);
  END IF;

  RETURN json_build_object(
    'valid', true,
    'type', v.type,
    'club_name', v.club_name,
    'club_avatar', v.club_avatar,
    'group_name', v.name,
    'creator_name', v.creator_name,
    'university', COALESCE(v.club_university, v.creator_university)
  );
END;
$$;

-- Joining through an invitation. Same-university enforced. Members-chat
-- invites create/restore CLUB membership (the join trigger then wires the
-- chat). Custom-group invites touch ONLY the group — never any club data.
CREATE OR REPLACE FUNCTION join_chat_invitation(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_user_univ TEXT;
  v_required_univ TEXT;
  v_default_channel UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT ci.conversation_id, ci.revoked_at, ci.created_by, c.type, c.club_id, c.deleted_at,
         cl.university AS club_university
  INTO v
  FROM chat_invitations ci
  JOIN conversations c ON c.id = ci.conversation_id
  LEFT JOIN clubs cl ON cl.id = c.club_id
  WHERE ci.token = p_token;

  IF NOT FOUND OR v.revoked_at IS NOT NULL OR v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invitation_invalid';
  END IF;
  IF v.type NOT IN ('club_group','group') THEN
    RAISE EXCEPTION 'invitation_invalid';
  END IF;

  SELECT university INTO v_user_univ FROM profiles WHERE id = auth.uid();
  IF v.type = 'club_group' THEN
    v_required_univ := v.club_university;
  ELSE
    SELECT university INTO v_required_univ FROM profiles WHERE id = v.created_by;
  END IF;
  IF v_required_univ IS NOT NULL AND v_user_univ IS DISTINCT FROM v_required_univ THEN
    RAISE EXCEPTION 'different_university';
  END IF;

  IF v.type = 'club_group' THEN
    -- Club membership (trigger adds the chat participant + notifications).
    INSERT INTO club_members (club_id, user_id, role)
    VALUES (v.club_id, auth.uid(), 'member')
    ON CONFLICT (club_id, user_id) DO NOTHING;
    -- Restore inbox visibility if they had left/hidden the chat before.
    UPDATE conversation_participants SET hidden_at = NULL
    WHERE conversation_id = v.conversation_id AND user_id = auth.uid();
    -- The trigger only fires on fresh membership; guarantee participation.
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v.conversation_id, auth.uid())
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET hidden_at = NULL;
  ELSE
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v.conversation_id, auth.uid())
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET hidden_at = NULL;
  END IF;

  SELECT id INTO v_default_channel FROM conversation_channels
  WHERE conversation_id = v.conversation_id
  ORDER BY is_default DESC, display_order ASC LIMIT 1;

  RETURN json_build_object(
    'conversation_id', v.conversation_id,
    'type', v.type,
    'club_id', v.club_id,
    'default_channel_id', v_default_channel
  );
END;
$$;

-- ─── 13. Message reports with protected moderation snapshots ───────────────
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS message_id UUID,
  ADD COLUMN IF NOT EXISTS conversation_id UUID,
  ADD COLUMN IF NOT EXISTS conversation_type TEXT,
  ADD COLUMN IF NOT EXISTS message_type TEXT,
  ADD COLUMN IF NOT EXISTS message_sender_id UUID,
  ADD COLUMN IF NOT EXISTS content_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS attachment_snapshot JSONB;

-- Snapshot is taken server-side at report time so a later unsend cannot
-- destroy the evidence. Only conversation participants can report, and only
-- content sent by someone else.
CREATE OR REPLACE FUNCTION report_message(
  p_message_id UUID,
  p_reason TEXT,
  p_details TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_msg RECORD;
  v_conv RECORD;
  v_reporter RECORD;
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT m.*, p.question AS poll_question INTO v_msg
  FROM messages m
  LEFT JOIN polls p ON p.message_id = m.id
  WHERE m.id = p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
  IF NOT is_conversation_participant(v_msg.conversation_id) THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;
  IF v_msg.sender_id = auth.uid() THEN RAISE EXCEPTION 'cannot_report_own'; END IF;

  SELECT type, club_id INTO v_conv FROM conversations WHERE id = v_msg.conversation_id;
  SELECT username, id INTO v_reporter FROM profiles WHERE id = auth.uid();

  INSERT INTO reports (
    reporter_id, reporter_username, entity_type, entity_id, club_id,
    reason, details, status,
    message_id, conversation_id, conversation_type, message_type,
    message_sender_id, content_snapshot, attachment_snapshot
  ) VALUES (
    auth.uid(), v_reporter.username, 'message', p_message_id, v_conv.club_id,
    p_reason, p_details, 'pending',
    p_message_id, v_msg.conversation_id, v_conv.type, v_msg.message_type,
    v_msg.sender_id,
    COALESCE(v_msg.content, v_msg.poll_question),
    CASE WHEN v_msg.attachment_url IS NOT NULL THEN
      jsonb_build_object(
        'url', v_msg.attachment_url,
        'name', v_msg.attachment_name,
        'size', v_msg.attachment_size,
        'mime', v_msg.attachment_mime
      )
    ELSE NULL END
  ) RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

-- ─── 14. Storage: chat attachments keyed to conversation participation ─────
-- Old policies required CLUB membership on the first path segment, making
-- DM / custom-group uploads impossible. New layout:
--   chat-attachments/<conversation_id>/<uuid>.<ext>
DROP POLICY IF EXISTS "chat-attachments: members can read" ON storage.objects;
DROP POLICY IF EXISTS "chat-attachments: members can upload" ON storage.objects;

CREATE POLICY "chat-attachments: participants can read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'chat-attachments'
    AND is_conversation_participant(((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "chat-attachments: participants can upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'chat-attachments'
    AND is_conversation_participant(((storage.foldername(name))[1])::uuid)
  );

-- ─── 15. Notification types for the new flows ───────────────────────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'follow_request','follow_accepted','new_follower','event_rsvp','new_event',
    'new_message','gluemate','like','comment','club_inactive','club_chat_added',
    'officer_chat_added','officer_role','officer_removed','club_joined',
    'member_joined','group_chat_added','club_removed','chat_invite_joined'
  ]));

-- ─── 16. Grants ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION unsend_message(UUID) FROM anon;
REVOKE ALL ON FUNCTION create_poll(UUID, UUID, TEXT, TEXT[], BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM anon;
REVOKE ALL ON FUNCTION create_group_chat(TEXT, UUID[], TEXT, UUID) FROM anon;
REVOKE ALL ON FUNCTION add_group_participants(UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION remove_group_participant(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION leave_group_chat(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION delete_group_conversation(UUID) FROM anon;
REVOKE ALL ON FUNCTION reopen_club_chat(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION clear_official_chat(UUID) FROM anon;
REVOKE ALL ON FUNCTION add_club_member_by_officer(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION remove_club_member_by_officer(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION get_or_create_chat_invitation(UUID) FROM anon;
REVOKE ALL ON FUNCTION rotate_chat_invitation(UUID) FROM anon;
REVOKE ALL ON FUNCTION join_chat_invitation(TEXT) FROM anon;
REVOKE ALL ON FUNCTION report_message(UUID, TEXT, TEXT) FROM anon;
-- preview_chat_invitation stays callable by anon: the web fallback page must
-- render invite previews for logged-out users. It leaks nothing sensitive.
