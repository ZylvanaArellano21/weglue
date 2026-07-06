-- 025_fix_chat_channels_and_messages_rls.sql
-- Two production bugs found by running the app in the simulator and reading the
-- [Supabase timing] logs. Both block the group-chat flow entirely.

-- ── Bug 1 ────────────────────────────────────────────────────────────────────
-- getClubChannels() selects conversation_channels.created_at, but migration 010
-- only added created_by/is_restricted/is_default — never created_at. The query
-- 42703-errors, so the channel list never loads and the group-chat screen sits
-- on an infinite spinner. Add the missing column (backfilled to now()).
ALTER TABLE conversation_channels
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── Bug 2 ────────────────────────────────────────────────────────────────────
-- The "messages: non-member club preview" SELECT policy (migration 010)
-- references `messages` inside its own USING clause:
--     messages.id IN (SELECT m2.id FROM messages m2 ...)
-- Evaluating that subquery re-applies the messages SELECT policies, which
-- includes this same policy → Postgres aborts with 42P17 "infinite recursion
-- detected in policy for relation messages". Because getMyChats embeds messages,
-- the ENTIRE chat list fails to load.
--
-- Fix: move the "15 most recent message ids" lookup into a SECURITY DEFINER
-- function. SECURITY DEFINER runs as the function owner (table owner), for whom
-- RLS is not enforced, so the self-reference no longer re-triggers the policy.

CREATE OR REPLACE FUNCTION recent_club_preview_message_ids(p_conv_id UUID)
RETURNS SETOF UUID AS $$
  SELECT id
  FROM messages
  WHERE conversation_id = p_conv_id
  ORDER BY created_at DESC
  LIMIT 15;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION recent_club_preview_message_ids(UUID) TO authenticated;

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
      SELECT recent_club_preview_message_ids(messages.conversation_id)
    )
  );
