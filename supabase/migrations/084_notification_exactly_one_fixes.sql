-- ============================================================
-- We Glue – "Exactly one notification per add" fixes (correction 4, part 2)
-- Migration: 084_notification_exactly_one_fixes.sql
--
-- Follow-up to 083, answering the specific proof requested for every
-- supported DM/group chat/club chat/officer chat "added" path:
--
--   DM (get_or_create_direct_chat, 057:1048): creates the conversation +
--   both participant rows with NO notification of any kind — confirmed
--   correct AS-IS, not a gap. The founder's own coverage list separates
--   "Direct messages... sender + brief preview" from "Being added to a
--   group chat/club chat/officer chat/club/officer role" — DMs are
--   deliberately not in the second list. handle_message_push() (046) already
--   fires exactly one dm_message notification for the FIRST message in a new
--   thread, which is the actual "you've been contacted" signal; a separate
--   "someone wants to DM you" notification before any message exists would
--   be new, unrequested product behavior. No change.
--
--   Club chat, add_club_member_by_officer() (040): FOUND — an officer
--   adding a genuinely new member fired BOTH handle_club_join()'s
--   `club_joined` ("You joined X.") AND the RPC's own `club_chat_added`
--   ("You were added to X. You can access the Members chat.") — two rows
--   for one action. handle_club_join()'s own comment already calls its
--   insert "Personal confirmation to the joiner" (038:251) — i.e. it was
--   written for a SELF-driven join (self-serve join, or an invite link the
--   joiner opens themselves), not an officer acting on someone else's
--   behalf. auth.uid() reliably distinguishes the two: for a self-join or
--   invite-join, auth.uid() = NEW.user_id (the joiner is the one
--   authenticated); for add_club_member_by_officer, auth.uid() is the
--   OFFICER (SECURITY DEFINER changes the executing role's privileges, not
--   the session's auth.uid()). Fixed by gating club_joined on that
--   distinction — the officer-add path keeps its own, more accurate
--   club_chat_added, and does not additionally send club_joined.
--   member_joined (the broadcast to EXISTING members) is unaffected — it
--   already correctly fires regardless of which path added the new member.
--
--   Club chat, join_chat_invitation() (040, club_group case): fires
--   handle_club_join() with auth.uid() = NEW.user_id (the joiner uses their
--   own session to redeem the invite) — already exactly one (club_joined),
--   unaffected by this migration.
--
--   Officer chat, handle_club_join() (038, joining directly as an officer)
--   and handle_club_member_role_change() (033, promoting an existing
--   member): each already fires officer_chat_added exactly once via its own
--   FOUND-gated INSERT — confirmed correct in the original audit, no change.
--
--   Group chat, create_group_chat() (057): fires group_chat_added exactly
--   once per invited participant at creation, never for the creator —
--   confirmed correct, no change.
--
--   Group chat, add_group_participants() (057): already fixed in 083 (only
--   notifies when the person was not already an active participant).
--
--   Group chat, join_chat_invitation() (040, group case): FOUND — inserts
--   the participant row directly and never notifies at all. Someone joining
--   a custom group via an invite link got ZERO notifications, while being
--   manually added by the creator correctly gets exactly one. Fixed by
--   adding the same group_chat_added insert add_group_participants() uses.
-- ============================================================

-- ── Club chat: club_joined only for a SELF-driven join ────────────────────

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
      -- 084: personal confirmation to the joiner — ONLY for a self-driven
      -- join (self-serve join or an invite link the joiner redeems
      -- themselves). When someone ELSE added them (an officer), that
      -- action's own RPC already sends the more accurate club_chat_added /
      -- officer_role, so this must not ALSO fire — one action, one
      -- notification.
      IF NEW.user_id = auth.uid() THEN
        INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
        VALUES (
          NEW.user_id, NEW.user_id, 'club_joined',
          NEW.club_id, 'club', false,
          'You joined ' || v_club_name || '.'
        );
      END IF;

      -- Broadcast to every unique existing member/officer of the club
      -- (club_members is the single membership table, so officers are
      -- naturally deduped), never to the joiner. Unaffected by who
      -- initiated the join — existing members should always learn a new
      -- member joined, self-driven or officer-added alike.
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

-- ── Group chat: join-by-invite now notifies, like every other add path ────

CREATE OR REPLACE FUNCTION join_chat_invitation(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_user_univ TEXT;
  v_required_univ TEXT;
  v_default_channel UUID;
  v_was_new BOOLEAN;
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
    -- Club membership (trigger adds the chat participant + notifications,
    -- including club_joined — this call always has auth.uid() = the joiner).
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
    -- 084: custom-group invite join previously notified nobody — every
    -- other "added to a group chat" path (create_group_chat,
    -- add_group_participants) already does. Match add_group_participants'
    -- own "already active → no-op" rule so re-opening the same invite link
    -- twice does not duplicate the notification.
    SELECT NOT EXISTS (
      SELECT 1 FROM conversation_participants
      WHERE conversation_id = v.conversation_id AND user_id = auth.uid() AND hidden_at IS NULL
    ) INTO v_was_new;

    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v.conversation_id, auth.uid())
    ON CONFLICT (conversation_id, user_id) DO UPDATE SET hidden_at = NULL;

    IF v_was_new THEN
      BEGIN
        INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
        VALUES (auth.uid(), auth.uid(), 'group_chat_added', v.conversation_id, 'message', false,
                'You were added to a group chat.');
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
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
