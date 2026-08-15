-- ===========================================================================
-- Migration 086: Members-chat-only invitation authorization
--
-- WHY: The invite-rebuild audit (2026-08-14) read can_manage_chat_invitation
-- and join_chat_invitation directly and confirmed a real scope gap: both
-- functions have authorized custom "group" chats in addition to Members-chat
-- (club_group) since 040, on a prior "custom groups: admin only" design that
-- predates the current product requirement — "Officers chat, custom groups,
-- and DMs cannot produce valid invitation tokens." Officers chat and DMs were
-- already correctly excluded by omission; only the group-chat carve-out
-- needs removing. Also closes two gaps found in the same read:
--   1. join_chat_invitation only checked `auth.uid() IS NULL`, never
--      `auth.users.email_confirmed_at` — an unverified account with a
--      session could redeem. Same auth.users lookup pattern as 027/028/047.
--   2. get_or_create_chat_invitation had a check-then-insert race: two
--      simultaneous first-Share taps on a conversation with no prior token
--      could both observe "none exists" and both INSERT, leaving two
--      simultaneously-active (non-revoked) rows for one conversation. A
--      per-conversation advisory lock (same pattern as 047's per-user lock)
--      closes it; a partial unique index makes the invariant durable even
--      if a future caller forgets the lock.
-- ===========================================================================

-- One active (non-revoked) invitation per conversation, enforced at the
-- database level regardless of caller discipline.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_invitations_active_per_conversation
  ON chat_invitations (conversation_id)
  WHERE revoked_at IS NULL;

-- Members-chat invites: officers only. Officers chat, custom groups, and
-- DMs: never.
CREATE OR REPLACE FUNCTION can_manage_chat_invitation(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = p_conversation_id
      AND c.deleted_at IS NULL
      AND c.type = 'club_group'
      AND is_club_officer(c.club_id)
  );
$$;

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

  -- Serialize per conversation so two concurrent first-Share taps can't both
  -- observe "no active token" and both mint one (uq_..._active_per_conversation
  -- would reject the loser anyway; the lock avoids that error path entirely).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_conversation_id::TEXT, 0));

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
  PERFORM pg_advisory_xact_lock(hashtextextended(p_conversation_id::TEXT, 0));
  UPDATE chat_invitations SET revoked_at = now()
  WHERE conversation_id = p_conversation_id AND revoked_at IS NULL;
  RETURN get_or_create_chat_invitation(p_conversation_id);
END;
$$;

-- Joining through an invitation. Members-chat invites only: creates/restores
-- CLUB membership (the join trigger then wires the chat). Requires a
-- verified email, not merely an authenticated session — the before_user_
-- created hook (008) and complete_microsoft_onboarding (047) already gate
-- account creation on it; this is the redemption path's own backstop so a
-- change to session issuance elsewhere can't silently reopen it.
CREATE OR REPLACE FUNCTION join_chat_invitation(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_confirmed TIMESTAMPTZ;
  v_user_univ TEXT;
  v_default_channel UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT email_confirmed_at INTO v_confirmed FROM auth.users WHERE id = auth.uid();
  IF v_confirmed IS NULL THEN RAISE EXCEPTION 'email_not_verified'; END IF;

  SELECT ci.conversation_id, ci.revoked_at, c.type, c.club_id, c.deleted_at,
         cl.university AS club_university
  INTO v
  FROM chat_invitations ci
  JOIN conversations c ON c.id = ci.conversation_id
  LEFT JOIN clubs cl ON cl.id = c.club_id
  WHERE ci.token = p_token;

  IF NOT FOUND OR v.revoked_at IS NOT NULL OR v.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invitation_invalid';
  END IF;
  IF v.type <> 'club_group' THEN
    RAISE EXCEPTION 'invitation_invalid';
  END IF;

  SELECT university INTO v_user_univ FROM profiles WHERE id = auth.uid();
  IF v.club_university IS NOT NULL AND v_user_univ IS DISTINCT FROM v.club_university THEN
    RAISE EXCEPTION 'different_university';
  END IF;

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

-- Retroactively invalidate every already-minted custom-group invitation:
-- those chats must "produce no valid invitation tokens" starting now, not
-- merely block new ones. Members-chat (club_group) tokens are untouched.
UPDATE chat_invitations ci
SET revoked_at = now()
FROM conversations c
WHERE c.id = ci.conversation_id
  AND c.type <> 'club_group'
  AND ci.revoked_at IS NULL;
