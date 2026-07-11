-- ============================================================================
-- 041_club_conversation_hub.sql
-- Club conversation + sub-channel system rebuild (foundation).
--
-- Introduces, for every club Members/Officers conversation:
--   • A permanent "Main chat" thread vs deletable hashtag channels
--     (conversation_channels.kind).
--   • Per-thread pictures (conversation_channels.avatar_url).
--   • Per-thread posting permissions — everyone / officers / certain
--     (conversation_channels.post_permission + channel_posters), extending the
--     old is_restricted #announcements behaviour rather than adding a parallel
--     system. Enforced server-side in the message-INSERT RLS policy and in the
--     create_poll RPC, so blocked clients cannot bypass by direct API calls.
--   • Parent-conversation mute + archive (conversation_participants.muted_at /
--     archived_at) and per-thread mute (channel_mutes) + per-thread read state
--     (channel_reads) for accurate hub unread.
--
-- Migration policy for existing clubs (per product decision):
--   #general      → permanent Main chat            (post: everyone)
--   #announcements→ hashtag channel, kept as        (post: officers)
--   #events       → hashtag channel                 (post: everyone)
-- All existing messages / media / files / polls / shared content are preserved;
-- nothing is merged, moved or deleted.
--
-- INVARIANTS (do not regress):
--   • Chat participation ↔ club role sync stays trigger-driven (010/035); this
--     migration only ADDS a channel_posters cleanup on participant removal.
--   • Members and Officers conversations stay fully isolated; officer_chat is
--     never visible to non-officers (RLS unchanged here, re-verified below).
--   • Club conversations and Main chats are never deletable.
-- ============================================================================

-- ─── 1. conversation_channels: kind, picture, posting permission ────────────
ALTER TABLE conversation_channels
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'channel',
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS post_permission TEXT NOT NULL DEFAULT 'everyone';

ALTER TABLE conversation_channels DROP CONSTRAINT IF EXISTS conversation_channels_kind_check;
ALTER TABLE conversation_channels ADD CONSTRAINT conversation_channels_kind_check
  CHECK (kind IN ('main', 'channel'));

ALTER TABLE conversation_channels DROP CONSTRAINT IF EXISTS conversation_channels_post_permission_check;
ALTER TABLE conversation_channels ADD CONSTRAINT conversation_channels_post_permission_check
  CHECK (post_permission IN ('everyone', 'officers', 'certain'));

-- ─── 2. Backfill kind + posting permission for existing club channels ───────
-- Main chat = the lowest-display_order channel of each club conversation
-- (always the seeded #general at display_order 0).
WITH ranked AS (
  SELECT cc.id,
         ROW_NUMBER() OVER (PARTITION BY cc.conversation_id
                            ORDER BY cc.display_order ASC, cc.created_at ASC, cc.id ASC) AS rn
  FROM conversation_channels cc
  JOIN conversations c ON c.id = cc.conversation_id
  WHERE c.type IN ('club_group', 'officer_chat')
)
UPDATE conversation_channels cc
SET kind = 'main'
FROM ranked r
WHERE cc.id = r.id AND r.rn = 1 AND cc.kind <> 'main';

-- #announcements (is_restricted) keeps officer-only posting; everything else
-- posts to everyone. Main chats always post to everyone.
UPDATE conversation_channels
SET post_permission = CASE
      WHEN kind = 'main' THEN 'everyone'
      WHEN is_restricted THEN 'officers'
      ELSE 'everyone'
    END
WHERE post_permission = 'everyone' OR post_permission IS NULL;

-- Keep is_restricted as a mirror of "officers" for any legacy reads.
UPDATE conversation_channels
SET is_restricted = (post_permission = 'officers');

-- ─── 3. Certain-people posting allow-list ───────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_posters (
  channel_id UUID NOT NULL REFERENCES conversation_channels(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_posters_channel ON channel_posters (channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_posters_user ON channel_posters (user_id);
ALTER TABLE channel_posters ENABLE ROW LEVEL SECURITY;

-- Participants of the thread's parent conversation may READ the allow-list (so
-- clients can render "you can/can't post"); all writes go through the officer
-- RPC below.
DROP POLICY IF EXISTS "channel_posters: participants read" ON channel_posters;
CREATE POLICY "channel_posters: participants read" ON channel_posters
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversation_channels cc
      WHERE cc.id = channel_posters.channel_id
        AND is_conversation_participant(cc.conversation_id)
    )
  );

-- ─── 4. Per-thread mute + per-thread read state ─────────────────────────────
CREATE TABLE IF NOT EXISTS channel_mutes (
  channel_id UUID NOT NULL REFERENCES conversation_channels(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  muted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
ALTER TABLE channel_mutes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "channel_mutes: own" ON channel_mutes;
CREATE POLICY "channel_mutes: own" ON channel_mutes
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS channel_reads (
  channel_id   UUID NOT NULL REFERENCES conversation_channels(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_reads_user ON channel_reads (user_id);
ALTER TABLE channel_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "channel_reads: own" ON channel_reads;
CREATE POLICY "channel_reads: own" ON channel_reads
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─── 5. Parent-conversation mute + archive (per user) ───────────────────────
-- Mute cascades to every child thread (notification layer reads muted_at).
-- Archive is independent of hidden_at: a new message clears hidden_at
-- (restore-on-message, migration 040) but must NOT clear archived_at, so an
-- archived conversation stays archived until the user unarchives it.
ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS muted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- ─── 6. can_post_in_channel(): single source of truth for send permission ───
CREATE OR REPLACE FUNCTION can_post_in_channel(p_channel_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv_id UUID;
  v_perm    TEXT;
  v_club_id UUID;
BEGIN
  IF p_channel_id IS NULL THEN
    RETURN TRUE; -- DM / custom-group message (no channel)
  END IF;

  SELECT cc.conversation_id, cc.post_permission, c.club_id
    INTO v_conv_id, v_perm, v_club_id
  FROM conversation_channels cc
  JOIN conversations c ON c.id = cc.conversation_id
  WHERE cc.id = p_channel_id;

  IF v_conv_id IS NULL THEN RETURN FALSE; END IF;

  -- Must belong to the thread's parent conversation to post at all.
  IF NOT is_conversation_participant(v_conv_id) THEN RETURN FALSE; END IF;

  IF v_perm = 'everyone' THEN
    RETURN TRUE;
  ELSIF v_perm = 'officers' THEN
    RETURN v_club_id IS NOT NULL AND is_club_officer(v_club_id);
  ELSIF v_perm = 'certain' THEN
    -- Officers always retain posting (they manage the thread); otherwise the
    -- user must be on the allow-list.
    RETURN (v_club_id IS NOT NULL AND is_club_officer(v_club_id))
        OR EXISTS (
          SELECT 1 FROM channel_posters cp
          WHERE cp.channel_id = p_channel_id AND cp.user_id = auth.uid()
        );
  END IF;

  RETURN FALSE;
END;
$$;

-- ─── 7. messages INSERT policy now enforces posting permission ──────────────
DROP POLICY IF EXISTS "messages: participants can insert" ON messages;
CREATE POLICY "messages: participants can insert"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND is_conversation_participant(conversation_id)
    AND (channel_id IS NULL OR can_post_in_channel(channel_id))
  );

-- ─── 8. create_poll: replace is_restricted check with can_post_in_channel ───
-- (Body identical to migration 040 except the channel permission gate.)
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
    SELECT cc.conversation_id INTO v_channel
    FROM conversation_channels cc WHERE cc.id = p_channel_id;
    IF NOT FOUND OR v_channel.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION 'channel_mismatch';
    END IF;
    IF NOT can_post_in_channel(p_channel_id) THEN
      RAISE EXCEPTION 'channel_restricted';
    END IF;
  END IF;

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

-- ─── 9. Channel-delete RLS: protect Main chat, allow officer hashtag delete ──
DROP POLICY IF EXISTS "conv_channels: officers can delete" ON conversation_channels;
CREATE POLICY "conv_channels: officers can delete"
  ON conversation_channels FOR DELETE TO authenticated
  USING (
    kind <> 'main'
    AND (
      EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = conversation_id
          AND c.type IN ('club_group', 'officer_chat')
          AND is_club_officer(c.club_id)
      )
      OR created_by = auth.uid()  -- custom-group channel creator
    )
  );

-- Note: there is deliberately NO direct client UPDATE policy on
-- conversation_channels. All renames / pictures / permission changes flow
-- through the SECURITY DEFINER RPCs below (which bypass RLS after their own
-- officer + Main-chat checks), so a manipulated client cannot rename/delete the
-- Main chat or edit a permission it isn't authorized to change.

-- ─── 10. Officer-authorized channel management RPCs ─────────────────────────
CREATE OR REPLACE FUNCTION create_conversation_channel(
  p_conversation_id UUID,
  p_name TEXT,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_conv RECORD;
  v_clean TEXT;
  v_order INT;
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT type, club_id INTO v_conv FROM conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;

  IF v_conv.type IN ('club_group','officer_chat') THEN
    IF NOT is_club_officer(v_conv.club_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  ELSIF v_conv.type = 'group' THEN
    IF NOT is_conversation_participant(p_conversation_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  ELSE
    RAISE EXCEPTION 'unsupported_conversation';
  END IF;

  v_clean := lower(regexp_replace(btrim(COALESCE(p_name,'')), '\s+', '-', 'g'));
  v_clean := regexp_replace(v_clean, '[^a-z0-9\-_]', '', 'g');
  IF v_clean = '' THEN RAISE EXCEPTION 'name_required'; END IF;

  SELECT COALESCE(MAX(display_order), 0) + 1 INTO v_order
  FROM conversation_channels WHERE conversation_id = p_conversation_id;

  INSERT INTO conversation_channels
    (conversation_id, name, display_order, is_default, is_restricted, kind, post_permission, avatar_url, created_by)
  VALUES
    (p_conversation_id, v_clean, v_order, FALSE, FALSE, 'channel', 'everyone', p_avatar_url, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION rename_conversation_channel(p_channel_id UUID, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_clean TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT cc.kind, c.type, c.club_id INTO v
  FROM conversation_channels cc JOIN conversations c ON c.id = cc.conversation_id
  WHERE cc.id = p_channel_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'channel_not_found'; END IF;
  IF v.kind = 'main' THEN RAISE EXCEPTION 'cannot_rename_main'; END IF;
  IF v.type NOT IN ('club_group','officer_chat') OR NOT is_club_officer(v.club_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_clean := lower(regexp_replace(btrim(COALESCE(p_name,'')), '\s+', '-', 'g'));
  v_clean := regexp_replace(v_clean, '[^a-z0-9\-_]', '', 'g');
  IF v_clean = '' THEN RAISE EXCEPTION 'name_required'; END IF;

  UPDATE conversation_channels SET name = v_clean WHERE id = p_channel_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_conversation_channel(p_channel_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT cc.kind, c.type, c.club_id INTO v
  FROM conversation_channels cc JOIN conversations c ON c.id = cc.conversation_id
  WHERE cc.id = p_channel_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v.kind = 'main' THEN RAISE EXCEPTION 'cannot_delete_main'; END IF;
  IF v.type NOT IN ('club_group','officer_chat') OR NOT is_club_officer(v.club_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  DELETE FROM conversation_channels WHERE id = p_channel_id; -- messages cascade
END;
$$;

CREATE OR REPLACE FUNCTION set_channel_avatar(p_channel_id UUID, p_avatar_url TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT c.type, c.club_id INTO v
  FROM conversation_channels cc JOIN conversations c ON c.id = cc.conversation_id
  WHERE cc.id = p_channel_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'channel_not_found'; END IF;
  IF v.type NOT IN ('club_group','officer_chat') OR NOT is_club_officer(v.club_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE conversation_channels SET avatar_url = p_avatar_url WHERE id = p_channel_id;
END;
$$;

-- Set posting permission + (for 'certain') replace the allow-list atomically.
-- Selected users must currently be participants of the thread's parent
-- conversation, so users outside it can never be added.
CREATE OR REPLACE FUNCTION set_channel_post_permission(
  p_channel_id UUID,
  p_permission TEXT,
  p_user_ids UUID[] DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_uid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_permission NOT IN ('everyone','officers','certain') THEN
    RAISE EXCEPTION 'invalid_permission';
  END IF;

  SELECT cc.conversation_id, c.type, c.club_id INTO v
  FROM conversation_channels cc JOIN conversations c ON c.id = cc.conversation_id
  WHERE cc.id = p_channel_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'channel_not_found'; END IF;
  IF v.type NOT IN ('club_group','officer_chat') OR NOT is_club_officer(v.club_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE conversation_channels
  SET post_permission = p_permission,
      is_restricted = (p_permission = 'officers')
  WHERE id = p_channel_id;

  IF p_permission = 'certain' THEN
    DELETE FROM channel_posters WHERE channel_id = p_channel_id;
    IF p_user_ids IS NOT NULL THEN
      FOREACH v_uid IN ARRAY p_user_ids LOOP
        IF v_uid IS NOT NULL
           AND EXISTS (SELECT 1 FROM conversation_participants
                       WHERE conversation_id = v.conversation_id AND user_id = v_uid) THEN
          INSERT INTO channel_posters (channel_id, user_id, added_by)
          VALUES (p_channel_id, v_uid, auth.uid())
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  ELSE
    -- Leaving 'certain' clears the allow-list.
    DELETE FROM channel_posters WHERE channel_id = p_channel_id;
  END IF;
END;
$$;

-- ─── 11. Mute / archive / read RPCs (own state only) ────────────────────────
CREATE OR REPLACE FUNCTION set_conversation_muted(p_conversation_id UUID, p_muted BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT is_conversation_participant(p_conversation_id) THEN RAISE EXCEPTION 'not_a_participant'; END IF;
  UPDATE conversation_participants
  SET muted_at = CASE WHEN p_muted THEN now() ELSE NULL END
  WHERE conversation_id = p_conversation_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION set_conversation_archived(p_conversation_id UUID, p_archived BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT is_conversation_participant(p_conversation_id) THEN RAISE EXCEPTION 'not_a_participant'; END IF;
  UPDATE conversation_participants
  SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END
  WHERE conversation_id = p_conversation_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION set_channel_muted(p_channel_id UUID, p_muted BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_conv UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT conversation_id INTO v_conv FROM conversation_channels WHERE id = p_channel_id;
  IF v_conv IS NULL OR NOT is_conversation_participant(v_conv) THEN RAISE EXCEPTION 'not_a_participant'; END IF;
  IF p_muted THEN
    INSERT INTO channel_mutes (channel_id, user_id) VALUES (p_channel_id, auth.uid())
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM channel_mutes WHERE channel_id = p_channel_id AND user_id = auth.uid();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION mark_channel_read(p_channel_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_conv UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT conversation_id INTO v_conv FROM conversation_channels WHERE id = p_channel_id;
  IF v_conv IS NULL OR NOT is_conversation_participant(v_conv) THEN RETURN; END IF;
  INSERT INTO channel_reads (channel_id, user_id, last_read_at)
  VALUES (p_channel_id, auth.uid(), now())
  ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_at = now();
END;
$$;

-- ─── 12. Cleanup: losing parent-conversation access clears poster selections ─
-- When a participant row is removed (leave club / removed / officer demoted →
-- officer_chat participant deleted by 010 triggers), drop that user from every
-- channel_posters allow-list in that conversation. Keeps Members selections
-- intact on demotion (only the officer_chat participant row is removed) and
-- clears both on full club removal (both participant rows removed).
CREATE OR REPLACE FUNCTION cleanup_channel_posters_on_leave()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM channel_posters cp
  USING conversation_channels cc
  WHERE cp.channel_id = cc.id
    AND cc.conversation_id = OLD.conversation_id
    AND cp.user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_channel_posters ON conversation_participants;
CREATE TRIGGER trg_cleanup_channel_posters
  AFTER DELETE ON conversation_participants
  FOR EACH ROW EXECUTE FUNCTION cleanup_channel_posters_on_leave();

-- ─── 13. New clubs: seed Main chat + hashtags with the new columns ──────────
CREATE OR REPLACE FUNCTION handle_club_created()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member_conv_id  UUID;
  v_officer_conv_id UUID;
BEGIN
  INSERT INTO conversations (type, club_id, name)
  VALUES ('club_group', NEW.id, NEW.name || ' · Members')
  RETURNING id INTO v_member_conv_id;

  INSERT INTO conversations (type, club_id, name)
  VALUES ('officer_chat', NEW.id, NEW.name || ' · Officers')
  RETURNING id INTO v_officer_conv_id;

  -- Members: Main chat (general) + #announcements (officers-only) + #events.
  INSERT INTO conversation_channels
    (conversation_id, name, display_order, is_default, is_restricted, kind, post_permission)
  VALUES
    (v_member_conv_id,  'general',       0, TRUE, FALSE, 'main',    'everyone'),
    (v_member_conv_id,  'announcements', 1, TRUE, TRUE,  'channel', 'officers'),
    (v_member_conv_id,  'events',        2, TRUE, FALSE, 'channel', 'everyone'),
    (v_officer_conv_id, 'general',       0, TRUE, FALSE, 'main',    'everyone');

  RETURN NEW;
END;
$$;

-- ─── 14. Realtime: role / membership / rename must propagate live ───────────
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE club_members;          EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE club_officers;         EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE clubs;                 EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE conversation_channels; EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE channel_posters;       EXCEPTION WHEN others THEN NULL; END $$;

-- ─── 15. Grants ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION can_post_in_channel(UUID) FROM anon;
REVOKE ALL ON FUNCTION create_conversation_channel(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION rename_conversation_channel(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION delete_conversation_channel(UUID) FROM anon;
REVOKE ALL ON FUNCTION set_channel_avatar(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION set_channel_post_permission(UUID, TEXT, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION set_conversation_muted(UUID, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION set_conversation_archived(UUID, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION set_channel_muted(UUID, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION mark_channel_read(UUID) FROM anon;

GRANT EXECUTE ON FUNCTION can_post_in_channel(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_conversation_channel(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION rename_conversation_channel(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_conversation_channel(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION set_channel_avatar(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION set_channel_post_permission(UUID, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION set_conversation_muted(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION set_conversation_archived(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION set_channel_muted(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_channel_read(UUID) TO authenticated;
