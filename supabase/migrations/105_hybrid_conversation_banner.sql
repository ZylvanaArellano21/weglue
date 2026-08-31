-- ============================================================================
-- 105 — hybrid conversation foreground-banner delivery
--
-- Design: docs/rollout/hybrid-conversation-banner-design.md (rev 2, founder
-- approved 2026-08-30).
--
-- Supersedes migrations 103 and 104 (both staging-only, never bound for
-- production). This file is authored STANDALONE from the current production
-- definitions:
--   - public.handle_message_push()      -> migration 089
--   - private.broadcast_message_sync()  -> migration 067
--   - private.can_receive_message_sync()-> migration 067
-- so it applies cleanly whether or not 103/104 are present.
--
-- Two banner delivery paths, one always valid:
--   * sync:message-inbox:<user_id>                       (067) — per-user,
--       authorization auth.uid() = <user_id>, can never go stale. Carries the
--       banner for small conversations and for ANY conversation inside its
--       post-change grace window.
--   * sync:message-inbox-conv:<conversation_id>:<epoch>  (new) — one send per
--       message, Realtime fans out to connected members. Authorization requires
--       actual conversation membership AND the current banner_epoch, so a
--       removed member's cached subscription is a dead topic and cannot follow
--       to the next epoch.
--
-- The conversation path only activates for a conversation once
-- banner_broadcast_active is set true. This migration DOES NOT activate any
-- conversation on production — activation is a deliberate operator sweep
-- (public.sweep_conversation_banner_activation) run only after the banner
-- frontend is confirmed live. Until then 105 behaves exactly like 103 would
-- have: per-user new_message on every message, every conversation.
--
-- STAGING APPLY is in the founder-approved Phase A scope. PRODUCTION APPLY is a
-- separate founder decision (deployment-order review Phase A step 4).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Conversation banner state (backend-owned; returned to clients by
--    getMyChats / getMyConversations, read-only on the client).
-- ---------------------------------------------------------------------------
-- `false` / `0` defaults are metadata-only. `now()` is volatile, so the third
-- ADD COLUMN rewrites the table; `conversations` is small (low thousands) so
-- this is fast. Existing rows get banner_epoch_changed_at = migration time,
-- which is always well past any grace window by the time anything reads it.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS banner_broadcast_active boolean NOT NULL DEFAULT false;
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS banner_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS banner_epoch_changed_at timestamptz NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------------
-- 2. Config: threshold T and grace window. Backend-only — clients never read
--    these. T is a controlled release setting: changing it re-routes nothing
--    until the participant trigger next fires or the activation sweep runs.
--    Seed only when absent so an operator value is never overwritten.
-- ---------------------------------------------------------------------------
-- T = 50 and grace = 90s were fixed from the staging hybrid-banner benchmark
-- (docs/rollout/hybrid-conversation-banner-design.md §Benchmark): per-user
-- INSERT p95 stays under the 800ms UX budget for conversations <= 50 even at
-- 10 concurrent senders, and crosses it above; conv-scoped INSERT is flat
-- 105-260ms p50 at every size with one realtime.messages row per message
-- (~500x fewer than per-user at 500 participants). grace = 90s had zero missed
-- banners for retained members across membership changes in the churn test.
INSERT INTO public.notification_config (key, value)
VALUES ('banner.broadcast_threshold', to_jsonb(50)),
       ('banner.epoch_grace_seconds', to_jsonb(90))
ON CONFLICT (key) DO NOTHING;

-- 104's key is dead once this migration's function bodies are live. No-op on
-- production (104 never applied there); cleanup on staging.
DELETE FROM public.notification_config WHERE key = 'banner.max_participants';

-- ---------------------------------------------------------------------------
-- 3. Authorization for the conversation-scoped topic. Inlined as a new case in
--    the existing sync-topic gate (the realtime.messages policy
--    weglue_receive_message_sync is unchanged — it already delegates here).
--    A single indexed EXISTS: membership in THIS conversation AND current epoch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.can_receive_message_sync(p_topic text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ '^sync:message:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.current_student_can_access_app()
       AND public.is_conversation_participant(pg_catalog.substr(p_topic, 14)::uuid)
    WHEN p_topic ~ '^sync:message-inbox:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.current_student_can_access_app()
       AND auth.uid() = pg_catalog.substr(p_topic, 20)::uuid
    WHEN p_topic ~ '^sync:message-inbox-conv:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9]{1,9}$'
      THEN public.current_student_can_access_app()
       AND EXISTS (
         SELECT 1
         FROM public.conversation_participants cp
         JOIN public.conversations c ON c.id = cp.conversation_id
         WHERE cp.conversation_id = pg_catalog.split_part(p_topic, ':', 3)::uuid
           AND cp.user_id = auth.uid()
           AND c.banner_epoch = pg_catalog.split_part(p_topic, ':', 4)::integer
           AND c.deleted_at IS NULL
       )
    ELSE false
  END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Activation / epoch state machine. Called only from the
--    conversation_participants statement triggers (same transaction).
--      * first time count >= T while inactive  -> activate + bump epoch
--      * any removal while active               -> bump epoch (revocation)
--      * joins while active                     -> nothing (new member just
--                                                  subscribes to the current
--                                                  epoch topic)
--    Every epoch change resets the grace window and nudges current
--    participants (via their always-valid per-user topic) to refetch and
--    resubscribe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_conversation_banner_state(
  p_conv_id uuid,
  p_removal boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_threshold int;
  v_count int;
  v_conv public.conversations%ROWTYPE;
  v_activate boolean := false;
  v_bump boolean := false;
  v_participant record;
BEGIN
  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conv_id;
  IF NOT FOUND OR v_conv.deleted_at IS NOT NULL THEN RETURN; END IF;

  SELECT COALESCE((value #>> '{}')::int, 50) INTO v_threshold
    FROM public.notification_config WHERE key = 'banner.broadcast_threshold';
  v_threshold := COALESCE(v_threshold, 50);

  SELECT count(*) INTO v_count
    FROM public.conversation_participants WHERE conversation_id = p_conv_id;

  IF NOT v_conv.banner_broadcast_active AND v_count >= v_threshold THEN
    v_activate := true;
    v_bump := true;
  ELSIF v_conv.banner_broadcast_active AND p_removal THEN
    v_bump := true;
  END IF;

  IF NOT v_bump THEN RETURN; END IF;

  -- The epoch bump must persist even if a nudge send fails, so it is not in the
  -- same sub-block as the fan-out (a caught exception would roll the UPDATE
  -- back to the block's savepoint).
  UPDATE public.conversations
    SET banner_broadcast_active = banner_broadcast_active OR v_activate,
        banner_epoch = banner_epoch + 1,
        banner_epoch_changed_at = now()
    WHERE id = p_conv_id;

  FOR v_participant IN
    SELECT cp.user_id FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conv_id
  LOOP
    BEGIN
      PERFORM realtime.send('{}'::jsonb, 'invalidate',
        'sync:message-inbox:' || v_participant.user_id::text, true);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'refresh_conversation_banner_state nudge failed for %', v_participant.user_id;
    END;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'refresh_conversation_banner_state failed for %', p_conv_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. conversation_participants triggers — STATEMENT level so a bulk membership
--    change (club deleted, group disbanded) does one epoch bump per affected
--    conversation, not one per row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_conv_participant_banner_add()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_conv_id uuid;
BEGIN
  FOR v_conv_id IN SELECT DISTINCT conversation_id FROM added LOOP
    PERFORM public.refresh_conversation_banner_state(v_conv_id, false);
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_conv_participant_banner_add failed';
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_conv_participant_banner_remove()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_conv_id uuid;
BEGIN
  FOR v_conv_id IN SELECT DISTINCT conversation_id FROM removed LOOP
    PERFORM public.refresh_conversation_banner_state(v_conv_id, true);
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_conv_participant_banner_remove failed';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_conv_participant_banner_add ON public.conversation_participants;
CREATE TRIGGER trg_conv_participant_banner_add
  AFTER INSERT ON public.conversation_participants
  REFERENCING NEW TABLE AS added
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_conv_participant_banner_add();

DROP TRIGGER IF EXISTS trg_conv_participant_banner_remove ON public.conversation_participants;
CREATE TRIGGER trg_conv_participant_banner_remove
  AFTER DELETE ON public.conversation_participants
  REFERENCING OLD TABLE AS removed
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_conv_participant_banner_remove();

-- ---------------------------------------------------------------------------
-- 6. Cross-device mute/unmute sync. A mute is local state
--    (conversation_participants.muted_at / channel_mutes); without a signal a
--    user's other devices keep showing banners on the conv-scoped path. Ping
--    the affected user's always-valid per-user topic so every device refetches
--    getMyChats and updates its client-side banner filter.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_conversation_mute_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user_id uuid;
BEGIN
  v_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  PERFORM realtime.send('{}'::jsonb, 'invalidate',
    'sync:message-inbox:' || v_user_id::text, true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'trg_conversation_mute_sync failed';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_conv_participant_mute_sync ON public.conversation_participants;
CREATE TRIGGER trg_conv_participant_mute_sync
  AFTER UPDATE OF muted_at ON public.conversation_participants
  FOR EACH ROW
  WHEN (OLD.muted_at IS DISTINCT FROM NEW.muted_at)
  EXECUTE FUNCTION public.trg_conversation_mute_sync();

DROP TRIGGER IF EXISTS trg_channel_mutes_sync ON public.channel_mutes;
CREATE TRIGGER trg_channel_mutes_sync
  AFTER INSERT OR DELETE ON public.channel_mutes
  FOR EACH ROW EXECUTE FUNCTION public.trg_conversation_mute_sync();

-- ---------------------------------------------------------------------------
-- 7. handle_message_push — from the 089 body. Push enqueue loop is byte-for-
--    byte unchanged. The only change is the banner send:
--      NOT stable -> per-user new_message inside the recipient loop (089+103)
--      stable     -> ONE conv-scoped new_message after the loop (new)
--    "stable" = active AND past the grace window.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_message_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conv public.conversations%ROWTYPE; v_sender text; v_channel text; v_is_channel boolean := false;
  v_club text; v_preview text; v_title text; v_body text; v_type text; v_recipient record;
  v_payload jsonb;
  v_grace_seconds int;
  v_stable boolean;
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

    v_payload := jsonb_build_object(
      'message_id',        NEW.id,
      'conversation_id',   NEW.conversation_id,
      'sender_id',         NEW.sender_id,
      'message_type',      NEW.message_type,
      'preview',           v_preview,
      'sender_name',       v_sender,
      'conversation_type', v_conv.type,
      'channel_id',        CASE WHEN v_is_channel THEN NEW.channel_id END
    );

    SELECT COALESCE((value #>> '{}')::int, 90) INTO v_grace_seconds
      FROM public.notification_config WHERE key = 'banner.epoch_grace_seconds';
    v_grace_seconds := COALESCE(v_grace_seconds, 90);
    v_stable := v_conv.banner_broadcast_active
            AND v_conv.banner_epoch_changed_at < now() - (v_grace_seconds * interval '1 second');

    FOR v_recipient IN SELECT cp.user_id FROM public.conversation_participants cp
      WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id <> NEW.sender_id AND cp.muted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.channel_mutes chm WHERE NEW.channel_id IS NOT NULL AND chm.channel_id = NEW.channel_id AND chm.user_id = cp.user_id)
    LOOP
      PERFORM public.enqueue_message_push(v_recipient.user_id, NULL, v_type, v_title, v_body,
        jsonb_strip_nulls(jsonb_build_object('screen', 'chat', 'chatId', NEW.conversation_id,
          'channelId', CASE WHEN v_is_channel THEN NEW.channel_id END)),
        'msg:' || NEW.conversation_id || ':' || CASE WHEN v_is_channel THEN NEW.channel_id::text ELSE 'main' END,
        'msg:' || NEW.id || ':' || v_recipient.user_id, 0, 'message', NEW.id, NEW.conversation_id, NEW.channel_id);

      IF NOT v_stable THEN
        BEGIN
          PERFORM realtime.send(v_payload, 'new_message', 'sync:message-inbox:' || v_recipient.user_id::text, true);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'handle_message_push per-user realtime.send failed: %', SQLERRM;
        END;
      END IF;
    END LOOP;

    IF v_stable THEN
      BEGIN
        PERFORM realtime.send(v_payload, 'new_message',
          'sync:message-inbox-conv:' || NEW.conversation_id::text || ':' || v_conv.banner_epoch::text, true);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_message_push conv realtime.send failed: %', SQLERRM;
      END;
    END IF;

    PERFORM public.invoke_push_dispatch();
  EXCEPTION WHEN OTHERS THEN
    -- Do not let a message-derived database error reach server logs.
    RAISE WARNING 'handle_message_push failed';
  END;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. broadcast_message_sync — from the 067 body. The sync:message:<conv_id>
--    open-thread ping is unchanged. The per-participant inbox invalidate loop
--    gets the same stable/grace branch: one conv-scoped invalidate when stable,
--    otherwise the existing per-user fan-out.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.broadcast_message_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;
  v_participant record;
  v_conv public.conversations%ROWTYPE;
  v_grace_seconds int;
  v_stable boolean;
BEGIN
  PERFORM realtime.send('{}'::jsonb, 'invalidate', 'sync:message:' || v_conversation_id::text, true);

  SELECT * INTO v_conv FROM public.conversations WHERE id = v_conversation_id;
  SELECT COALESCE((value #>> '{}')::int, 90) INTO v_grace_seconds
    FROM public.notification_config WHERE key = 'banner.epoch_grace_seconds';
  v_grace_seconds := COALESCE(v_grace_seconds, 90);
  v_stable := COALESCE(v_conv.banner_broadcast_active, false)
          AND v_conv.banner_epoch_changed_at < now() - (v_grace_seconds * interval '1 second');

  IF v_stable THEN
    PERFORM realtime.send('{}'::jsonb, 'invalidate',
      'sync:message-inbox-conv:' || v_conversation_id::text || ':' || v_conv.banner_epoch::text, true);
  ELSE
    FOR v_participant IN
      SELECT cp.user_id
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = v_conversation_id
    LOOP
      PERFORM realtime.send('{}'::jsonb, 'invalidate', 'sync:message-inbox:' || v_participant.user_id::text, true);
    END LOOP;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_message_sync failed';
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Operator activation sweep. Activates every conversation already at/above
--    T, each with a fresh epoch + grace window + participant nudge. NOT called
--    by this migration. Run it (as postgres) only AFTER the banner frontend is
--    confirmed live in the target environment, otherwise a stable active
--    conversation would broadcast on a topic no deployed client has joined.
--       SELECT public.sweep_conversation_banner_activation();
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_conversation_banner_activation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_threshold int;
  v_conv_id uuid;
  v_n int := 0;
BEGIN
  SELECT COALESCE((value #>> '{}')::int, 50) INTO v_threshold
    FROM public.notification_config WHERE key = 'banner.broadcast_threshold';
  v_threshold := COALESCE(v_threshold, 50);

  FOR v_conv_id IN
    SELECT c.id
    FROM public.conversations c
    WHERE c.deleted_at IS NULL
      AND NOT c.banner_broadcast_active
      AND (SELECT count(*) FROM public.conversation_participants cp WHERE cp.conversation_id = c.id) >= v_threshold
  LOOP
    PERFORM public.refresh_conversation_banner_state(v_conv_id, false);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Grants. Trigger functions run as owner regardless; revoke from callers.
--     refresh_* and the sweep are operator/trigger-only.
--     can_receive_message_sync keeps 067's grant (EXECUTE to authenticated,
--     for the realtime.messages policy).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.refresh_conversation_banner_state(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_conv_participant_banner_add() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_conv_participant_banner_remove() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_conversation_mute_sync() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sweep_conversation_banner_activation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.can_receive_message_sync(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_receive_message_sync(text) TO authenticated;

COMMIT;
