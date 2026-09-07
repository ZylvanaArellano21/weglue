-- ============================================================================
-- 129 — message replies and reply notifications
--
-- (Renumbered from 123 after the interest-matching family 122-127 merged to
-- main / production. No behavioral change from the reviewed-and-accepted 123.)
-- ============================================================================

BEGIN;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid
  REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id
  ON public.messages (reply_to_id);

-- A reply target is structural message metadata. Validate it as the table owner
-- so RLS cannot turn a missing target lookup into an authorization-dependent
-- decision. Any lookup failure aborts the message insert/update (fail closed).
CREATE OR REPLACE FUNCTION public.validate_message_reply_same_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_conversation_id uuid;
BEGIN
  IF NEW.reply_to_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT m.conversation_id
    INTO v_target_conversation_id
    FROM public.messages m
   WHERE m.id = NEW.reply_to_id;

  IF NOT FOUND
     OR v_target_conversation_id IS NULL
     OR NEW.conversation_id IS NULL
     OR v_target_conversation_id <> NEW.conversation_id THEN
    RAISE EXCEPTION 'reply_to_message_must_be_in_same_conversation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_reply_same_conversation ON public.messages;
CREATE TRIGGER trg_messages_reply_same_conversation
  BEFORE INSERT OR UPDATE OF reply_to_id, conversation_id ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_message_reply_same_conversation();

-- Reply notifications use the existing registry-driven notifications/push
-- pipeline. The notification row is intentionally best-effort: a notification
-- failure must never make the message itself fail.
INSERT INTO public.notification_types (
  type, category, enabled, in_app, push, group_window_minutes,
  group_dedupe_actor, blockable, description
)
VALUES (
  'message_reply', 'messages', true, true, true, 0,
  false, true, 'Someone replied to your message'
)
ON CONFLICT (type) DO UPDATE SET
  category = EXCLUDED.category,
  enabled = EXCLUDED.enabled,
  in_app = EXCLUDED.in_app,
  push = EXCLUDED.push,
  group_window_minutes = EXCLUDED.group_window_minutes,
  group_dedupe_actor = EXCLUDED.group_dedupe_actor,
  blockable = EXCLUDED.blockable,
  description = EXCLUDED.description;

CREATE OR REPLACE FUNCTION public.handle_message_reply_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_sender_id uuid;
  v_category text;
BEGIN
  IF NEW.reply_to_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fires on INSERT and on the NULL -> value UPDATE that a grouped-photo reply
  -- makes (send_message_with_attachments stores the row, then sets the link).
  -- Any other UPDATE OF reply_to_id is a no-op here; the dedupe check is the
  -- final backstop.
  IF TG_OP = 'UPDATE' AND OLD.reply_to_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT m.sender_id
      INTO v_target_sender_id
      FROM public.messages m
     WHERE m.id = NEW.reply_to_id
       AND m.conversation_id = NEW.conversation_id;

    -- The same-conversation trigger already guarantees this lookup for a
    -- committed target. Keep the notification path defensive if that target
    -- was concurrently removed or anonymized.
    IF NOT FOUND
       OR v_target_sender_id IS NULL
       OR NEW.sender_id IS NULL
       OR v_target_sender_id = NEW.sender_id THEN
      RETURN NEW;
    END IF;

    SELECT nt.category
      INTO v_category
      FROM public.notification_types nt
     WHERE nt.type = 'message_reply'
       AND nt.enabled
       AND nt.in_app;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    -- Preferences are category-level in this schema. user_wants_push() is the
    -- existing server-side category gate, including the global push_enabled
    -- switch and the messages-category preference.
    IF NOT public.user_wants_push(v_target_sender_id, v_category) THEN
      RETURN NEW;
    END IF;

    IF public.users_have_block_relationship(v_target_sender_id, NEW.sender_id)
       OR public.is_account_restricted(v_target_sender_id)
       OR public.is_account_restricted(NEW.sender_id)
       OR EXISTS (
         SELECT 1
           FROM public.conversation_participants cp
          WHERE cp.conversation_id = NEW.conversation_id
            AND cp.user_id = v_target_sender_id
            AND cp.muted_at IS NOT NULL
       ) THEN
      RETURN NEW;
    END IF;

    -- Existing message notifications, if any future/legacy path creates one,
    -- already represent this message for this recipient. The push-only
    -- message path is deliberately not rewritten here; this check is scoped
    -- to durable notifications and prevents duplicate notification rows.
    IF EXISTS (
      SELECT 1
        FROM public.notifications n
       WHERE n.user_id = v_target_sender_id
         AND n.entity_type = 'message'
         AND n.entity_id = NEW.id
    ) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.notifications (
      user_id, actor_id, type, entity_id, entity_type, read
    )
    VALUES (
      v_target_sender_id, NEW.sender_id, 'message_reply', NEW.id, 'message', false
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_message_reply_notification failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- INSERT covers the common path (text / single-attachment replies carry
-- reply_to_id on the insert). A grouped-photo reply is stored by
-- send_message_with_attachments() first and gets its reply_to_id in a
-- follow-up UPDATE, so fire on that transition too — only NULL -> value, and
-- the dedupe check below still prevents a second row.
DROP TRIGGER IF EXISTS trg_message_reply_notification ON public.messages;
CREATE TRIGGER trg_message_reply_notification
  AFTER INSERT OR UPDATE OF reply_to_id ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_message_reply_notification();

DO $$
DECLARE
  v_on_delete "char";
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'messages'
       AND column_name = 'reply_to_id'
       AND udt_name = 'uuid'
  ) THEN
    RAISE EXCEPTION '129 self-check: messages.reply_to_id missing or wrong type';
  END IF;

  SELECT c.confdeltype
    INTO v_on_delete
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'messages'
     AND c.contype = 'f'
     AND c.conname = 'messages_reply_to_id_fkey';
  IF v_on_delete IS DISTINCT FROM 'n' THEN
    RAISE EXCEPTION '129 self-check: reply_to FK is not ON DELETE SET NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class i
      JOIN pg_namespace n ON n.oid = i.relnamespace
     WHERE n.nspname = 'public'
       AND i.relname = 'idx_messages_reply_to_id'
       AND i.relkind = 'i'
  ) THEN
    RAISE EXCEPTION '129 self-check: reply_to index missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_messages_reply_same_conversation'
       AND tgrelid = 'public.messages'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '129 self-check: same-conversation trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_message_reply_notification'
       AND tgrelid = 'public.messages'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '129 self-check: notification trigger missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.notification_types
     WHERE type = 'message_reply'
       AND category = 'messages'
       AND enabled
       AND in_app
       AND push
       AND blockable
  ) THEN
    RAISE EXCEPTION '129 self-check: message_reply notification type missing';
  END IF;
END
$$;

COMMIT;
