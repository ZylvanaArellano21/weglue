-- ============================================================================
-- 104 — gate synchronous message banners by conversation size
--
-- REVIEW ONLY. Do not apply this file, deploy it, or commit it from this task.
-- Claude owns the eventual commit and staging apply after review.
--
-- Migration 103 is already applied on staging. This keeps its exact
-- handle_message_push() body and gates only the synchronous new_message
-- broadcast for conversations above the configurable participant threshold.
-- Push enqueue and the existing 067 invalidate broadcast remain unchanged.
-- ============================================================================

-- The central config table is (key TEXT PRIMARY KEY, value JSONB NOT NULL,
-- description TEXT). Seed only when absent so an operator-controlled value is
-- never overwritten by a repeat or later migration run.
INSERT INTO public.notification_config (key, value)
VALUES ('banner.max_participants', to_jsonb(50))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_message_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conv public.conversations%ROWTYPE; v_sender text; v_channel text; v_is_channel boolean := false;
  v_club text; v_preview text; v_title text; v_body text; v_type text; v_recipient record;
  v_participant_count int := (SELECT count(*) FROM public.conversation_participants WHERE conversation_id = NEW.conversation_id);
  v_banner_max int;
BEGIN
  BEGIN
    IF NEW.deleted_at IS NOT NULL OR NEW.deletion_kind <> 'active' THEN RETURN NEW; END IF;
    SELECT * INTO v_conv FROM public.conversations WHERE id = NEW.conversation_id;
    IF NOT FOUND OR v_conv.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    SELECT COALESCE(NULLIF(full_name, ''), username) INTO v_sender FROM public.profiles WHERE id = NEW.sender_id;
    v_sender := COALESCE(v_sender, 'Someone');
    v_preview := CASE
      WHEN NEW.message_type = 'image' THEN COALESCE(NULLIF(NEW.content, ''), '📷 Photo')
      WHEN NEW.message_type = 'video' THEN COALESCE(NULLIF(NEW.content, ''), '🎬 Video')
      WHEN NEW.message_type = 'file' THEN COALESCE(NULLIF(NEW.content, ''), '📎 File')
      WHEN NEW.message_type = 'poll' THEN '📊 Started a poll'
      WHEN NEW.message_type = 'shared_event' THEN '📅 Shared an event'
      WHEN NEW.message_type = 'shared_post' THEN '🖼️ Shared a post'
      ELSE COALESCE(NEW.content, 'New message') END;
    v_preview := left(v_preview, 140);
    IF v_conv.type = 'direct' THEN
      v_type := 'dm_message'; v_title := v_sender; v_body := v_preview;
    ELSIF v_conv.type = 'group' THEN
      v_type := 'group_message'; v_title := COALESCE(v_conv.name, 'Group chat'); v_body := v_sender || ': ' || v_preview;
    ELSE
      v_type := 'club_chat_message';
      SELECT name INTO v_club FROM public.clubs WHERE id = v_conv.club_id;
      IF NEW.channel_id IS NOT NULL THEN
        SELECT CASE WHEN ch.kind = 'channel' THEN ch.name END, ch.kind = 'channel'
          INTO v_channel, v_is_channel FROM public.conversation_channels ch WHERE ch.id = NEW.channel_id;
      END IF;
      v_title := COALESCE(v_club, 'Club chat') || CASE WHEN v_conv.type = 'officer_chat' THEN ' Officers' ELSE '' END;
      v_body := CASE WHEN v_channel IS NOT NULL THEN '#' || ltrim(v_channel, '#') || ' · ' || v_sender || ': ' || v_preview ELSE v_sender || ': ' || v_preview END;
    END IF;
    SELECT COALESCE((value #>> '{}')::int, 50) INTO v_banner_max
    FROM public.notification_config WHERE key = 'banner.max_participants';
    v_banner_max := COALESCE(v_banner_max, 50);
    FOR v_recipient IN SELECT cp.user_id FROM public.conversation_participants cp
      WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id <> NEW.sender_id AND cp.muted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.channel_mutes chm WHERE NEW.channel_id IS NOT NULL AND chm.channel_id = NEW.channel_id AND chm.user_id = cp.user_id)
    LOOP
      PERFORM public.enqueue_message_push(v_recipient.user_id, NULL, v_type, v_title, v_body,
        jsonb_strip_nulls(jsonb_build_object('screen', 'chat', 'chatId', NEW.conversation_id,
          'channelId', CASE WHEN v_is_channel THEN NEW.channel_id END)),
        'msg:' || NEW.conversation_id || ':' || CASE WHEN v_is_channel THEN NEW.channel_id::text ELSE 'main' END,
        'msg:' || NEW.id || ':' || v_recipient.user_id, 0, 'message', NEW.id, NEW.conversation_id, NEW.channel_id);
      IF v_participant_count <= v_banner_max THEN
        BEGIN
          PERFORM realtime.send(
            jsonb_build_object(
              'message_id',        NEW.id,
              'conversation_id',   NEW.conversation_id,
              'sender_id',         NEW.sender_id,
              'message_type',      NEW.message_type,
              'preview',           v_preview,
              'sender_name',       v_sender,
              'conversation_type', v_conv.type,
              'channel_id',        CASE WHEN v_is_channel THEN NEW.channel_id END
            ),
            'new_message',
            'sync:message-inbox:' || v_recipient.user_id::text,
            true
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'handle_message_push realtime.send failed: %', SQLERRM;
        END;
      END IF;
    END LOOP;
    PERFORM public.invoke_push_dispatch();
  EXCEPTION WHEN OTHERS THEN
    -- Do not let a message-derived database error reach server logs.
    RAISE WARNING 'handle_message_push failed';
  END;
  RETURN NEW;
END;
$$;
