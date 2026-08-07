-- ============================================================================
-- 077 — Delete-for-me cross-device synchronization parity
-- ============================================================================
-- PROBLEM
-- Migration 067 gave every message *lifecycle* event an opaque realtime ping
-- (private.broadcast_message_sync on messages INSERT/UPDATE/DELETE), and both
-- the mobile app and the web app subscribe to exactly those two topics:
--
--     sync:message:<conversation_id>        — an open thread must refetch
--     sync:message-inbox:<user_id>          — that user's inbox must refetch
--
-- "Delete for me" does NOT touch `messages`. It writes a row to
-- `message_hides`, which carries no trigger at all, so the ping is never sent.
-- The consequence is a real, user-visible synchronization defect:
--
--   • A user who hides a message on the web still sees it on their phone (and
--     vice versa) until the app is killed and relaunched, because nothing ever
--     tells the other device to refetch.
--   • The same user with two browser tabs open sees the two tabs disagree.
--
-- Unhiding (a DELETE from message_hides, used by conversation restore paths)
-- has the identical problem in reverse.
--
-- FIX
-- Give message_hides the same opaque ping the messages table already has.
--
-- PRIVACY — this deliberately reuses 067's contract without widening it:
--   • The payload is '{}'. It never carries a message id, body, attachment
--     path, actor, or the fact that a hide (rather than any other lifecycle
--     event) occurred. It is indistinguishable from a normal message ping.
--   • Topics are unchanged, so 067's `weglue_receive_message_sync` SELECT
--     policy on realtime.messages still governs who may receive anything, and
--     private.can_receive_message_sync still re-checks participation per topic.
--   • Clients never consume the payload; they refetch under RLS. Duplicate and
--     out-of-order pings therefore remain safe by construction.
--
-- SCOPE — a hide is per-user, but the conversation-level ping is still required
-- and correct: the acting user may have that very thread open on another
-- device, and the thread query is keyed by conversation, not by user. Other
-- participants may receive a redundant ping and refetch to an identical result;
-- that is the same benign duplicate 067 already tolerates, and it leaks nothing
-- because their own RLS-bound refetch cannot observe another user's hide.
--
-- No table, column, policy, grant, or client contract changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.broadcast_message_hide_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_message_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.message_id ELSE NEW.message_id END;
  v_user_id    uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id    ELSE NEW.user_id    END;
  v_conversation_id uuid;
BEGIN
  -- The hidden message may already be gone (message_hides cascades from
  -- messages). No row means the messages trigger has already pinged, or will.
  SELECT m.conversation_id INTO v_conversation_id
  FROM public.messages m
  WHERE m.id = v_message_id;

  IF v_conversation_id IS NOT NULL THEN
    PERFORM realtime.send('{}'::jsonb, 'invalidate',
      'sync:message:' || v_conversation_id::text, true);
  END IF;

  -- The inbox ping goes ONLY to the user whose visibility actually changed:
  -- a hide can change that user's conversation preview and unread count, and
  -- it can change nobody else's.
  PERFORM realtime.send('{}'::jsonb, 'invalidate',
    'sync:message-inbox:' || v_user_id::text, true);

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- The hide itself has already committed and is authoritative. Focus,
  -- reconnect and ordinary refetch remain the recovery path when Realtime is
  -- unavailable; a broadcast failure must never roll back the user's action.
  RAISE WARNING 'broadcast_message_hide_sync failed';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_message_hide_sync ON public.message_hides;
CREATE TRIGGER trg_broadcast_message_hide_sync
  AFTER INSERT OR DELETE ON public.message_hides
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_message_hide_sync();

REVOKE ALL ON FUNCTION private.broadcast_message_hide_sync()
  FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================================
-- Supporting index
-- ============================================================================
-- Both clients now resolve "which messages has this viewer hidden in this
-- conversation" on every thread page load. That query filters message_hides by
-- user_id and joins messages; the table's primary key is (message_id, user_id),
-- which cannot serve a user_id-leading lookup.
CREATE INDEX IF NOT EXISTS idx_message_hides_user
  ON public.message_hides (user_id, message_id);
