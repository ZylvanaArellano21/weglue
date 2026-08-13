-- ============================================================
-- We Glue – Conversation-read realtime sync (correction 5)
-- Migration: 082_conversation_read_realtime_sync.sql
--
-- DIAGNOSIS: opening a conversation could leave its unread badge visible,
-- and notification counts did not update consistently. Traced the full path
-- (creation → persistence → realtime → client subscription → read mutation →
-- count recalculation):
--
--   1. apps/mobile/components/chat/ConversationThread.tsx calls
--      markConversationRead(conversationId) on mount/new-message, which
--      calls the RPC below — this WAS already correct and already ran.
--   2. mark_conversation_read()/mark_channel_read() (011/041) correctly
--      UPDATE conversation_participants.last_read_at / UPSERT
--      channel_reads.last_read_at — the DATA is correct the instant the RPC
--      returns.
--   3. get_unread_summary_for() (046) correctly derives unread_threads from
--      exactly those columns — reading the DATA at any point after step 2
--      already returns the right number.
--   4. THE GAP: nothing told the CLIENT to re-read it. useUnreadSummary
--      (apps/mobile/hooks/useUnreadSummary.ts, apps/web/lib/hooks/
--      useUnreadSummary.ts) only invalidates on a `notifications` INSERT/
--      UPDATE or the `sync:message-inbox:<user_id>` broadcast — and that
--      broadcast was previously fired ONLY on message deletion (067, 077),
--      never on a read-state change. The badge was correct on the server the
--      whole time; it just never got asked again until the next 60s poll
--      (useUnreadSummary's refetchInterval) or an unrelated notification
--      happened to invalidate it.
--
-- FIX, at the earliest broken layer: mark_conversation_read() and
-- mark_channel_read() now also PERFORM realtime.send(...) on the SAME
-- `sync:message-inbox:<user_id>` topic the deletion-sync triggers already
-- use — no new topic, no new authorization rule (private.
-- can_receive_message_sync, 067, already gates it), and no client-side
-- timer or polling workaround. Both bodies are otherwise byte-for-byte their
-- current production definitions (011, 041).
-- ============================================================

CREATE OR REPLACE FUNCTION mark_conversation_read(p_conversation_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE conversation_participants
  SET last_read_at = now()
  WHERE conversation_id = p_conversation_id
    AND user_id = auth.uid();

  -- 082: tell THIS user's unread-summary subscription to refetch — the badge
  -- was already correct server-side; this is the missing "ask again" signal.
  IF FOUND THEN
    PERFORM realtime.send('{}'::jsonb, 'invalidate', 'sync:message-inbox:' || auth.uid()::text, true);
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

  -- 082: same missing signal as mark_conversation_read, for club/officer
  -- channel-scoped reads.
  PERFORM realtime.send('{}'::jsonb, 'invalidate', 'sync:message-inbox:' || auth.uid()::text, true);
END;
$$;
