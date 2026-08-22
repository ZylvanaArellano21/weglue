-- ============================================================================
-- 089 — Immediate push dispatch (notification delivery speed fix), and a
--        real double-push bug on photo posts found while validating it
-- ============================================================================
--
-- Problem: native OS push notifications sometimes took ~2 minutes to arrive.
--
-- Root cause: push_queue rows are enqueued instantly — enqueue_push() /
-- enqueue_message_push() run synchronously inside the same transaction as
-- the triggering INSERT/UPDATE (a message, a notification row, a photo
-- post). But delivery to the send-push Edge Function only happened on
-- invoke_push_dispatch(), scheduled by pg_cron as 'dispatch-push' every
-- MINUTE (migration 046). So delivery latency was bounded by how far into
-- that one-minute window the triggering event happened to land — up to ~60s
-- of pure queueing delay before send-push (Expo → APNs/FCM) even started,
-- which is what the founder observed as "about two minutes" end to end.
--
-- This does not affect the in-app realtime path (ForegroundNotificationBanner
-- on both platforms, fed by Postgres Realtime on the `notifications` table),
-- which was never routed through push_queue/cron and is already near-
-- instant — only the native OS push notification was affected.
--
-- Fix: call invoke_push_dispatch() directly, once, immediately after new
-- work is enqueued, in the trigger functions that call enqueue_push /
-- enqueue_message_push (three of the four touched by this migration — see
-- below for why the fourth, notify_photo_post_university, needs a different
-- fix instead). net.http_post() only inserts a row into pg_net's own queue
-- table — pg_net's background worker only picks it up once the enclosing
-- transaction actually commits, so this can never fire early for a row
-- that gets rolled back.
--
-- Only THREE functions get a new call, not four: notify_photo_post_university
-- (088) fans out by inserting directly into the `notifications` table in a
-- loop — each of those inserts already fires notifications_after_insert_push
-- (an ordinary AFTER INSERT trigger on `notifications`, which runs
-- regardless of which function performed the insert), so it already gets an
-- immediate dispatch attempt per recipient for free once that function is
-- fixed. Adding a second call at the end of its own loop would just dispatch
-- redundantly on top of that. handle_message_push is different: chat
-- messages are push-only (enqueue_message_push, never a `notifications` row
-- for the message itself), so it is the one fan-out loop that needs its own
-- call — placed ONCE after the loop, not per recipient, so a single message
-- still results in exactly one immediate dispatch attempt no matter how many
-- people it fans out to. claim_push_batch()'s FOR UPDATE SKIP LOCKED already
-- makes concurrent dispatch attempts safe (no double-send), so multiple
-- near-simultaneous callers compose correctly with each other and with the
-- existing cron job, with no new coordination logic required.
--
-- This also means every OTHER existing fan-out that inserts into
-- `notifications` in a loop (club-post notifications, event reminders,
-- social-proof digests, follows, likes, etc.) gets the same immediate-
-- dispatch fix for free, without touching any of those functions
-- individually — notifications_after_insert_push is the one common
-- chokepoint for all of them.
--
-- invoke_push_dispatch() itself is UNCHANGED: it already wraps its entire
-- body in `EXCEPTION WHEN OTHERS THEN RAISE WARNING ...`, so a missing
-- pg_net/vault extension, a misconfigured dispatch URL, or a transient
-- failure can never propagate up and break the primary insert/update this
-- is attached to — identical fail-safe behavior to the existing
-- PERFORM enqueue_push(...) calls right next to it.
--
-- The 1-minute cron job ('dispatch-push', migration 046) is UNCHANGED and
-- stays as the safety net: it reaps stuck 'processing' rows after a worker
-- crash and catches anything an immediate dispatch attempt missed (a
-- transient net.http_post failure, or a push enqueued by some future path
-- that doesn't yet call invoke_push_dispatch() directly).
--
-- SEPARATE BUG FOUND WHILE VALIDATING THE ABOVE (real execution against a
-- disposable clone of the actual stack, not just code review): every photo
-- post has been sending recipients TWO separate push notifications, not
-- one, since migration 088. notify_photo_post_university() inserts into
-- `notifications` (which already, unconditionally, fires
-- notifications_after_insert_push — an ordinary AFTER INSERT trigger on
-- that table, regardless of which function performed the insert) AND ALSO
-- calls enqueue_push(...) itself, directly, right after — two independent
-- calls, two different dedupe_keys ('notif:<id>' vs
-- 'club_post:<postId>:<userId>'), so ON CONFLICT (dedupe_key) DO NOTHING
-- never catches it as the same push. notify_club_post() (046), the older,
-- equivalent club-post fan-out, does this correctly — it only ever inserts
-- into `notifications` and relies on the cascading trigger for the push,
-- exactly once. notify_photo_post_university() is fixed below to match that
-- established, single-path pattern: the redundant direct enqueue_push call
-- is removed. notification_route()/notification_push_copy() (both
-- pre-existing, unchanged) already produce the identical route and body
-- copy for 'club_post' from the cascading trigger alone — confirmed by
-- direct query, not assumed — so recipients still get the exact same
-- content, exactly once instead of twice. The only visible difference is
-- the push title, which now reads "We Glue" instead of the poster's name —
-- matching how every other notification type in this system already
-- titles its push (like, new_follower, gluemate, etc. all use "We Glue"),
-- so this is a consistency fix, not a regression.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. notifications_after_insert_push — single-row trigger (AFTER INSERT on
--    notifications). Body otherwise byte-for-byte identical to migration 046.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notifications_after_insert_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_copy RECORD;
BEGIN
  BEGIN
    SELECT * INTO v_copy FROM notification_push_copy(NEW);
    PERFORM enqueue_push(
      NEW.user_id, NEW.id, NEW.type, v_copy.title, v_copy.body, NEW.route,
      COALESCE(NEW.group_key, 'notif:' || NEW.id::text),
      'notif:' || NEW.id::text,
      0
    );
    PERFORM invoke_push_dispatch();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notifications_after_insert_push failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. notifications_after_group_merge_push — single-row trigger (AFTER
--    UPDATE on notifications, a group merge). Body otherwise identical to 046.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notifications_after_group_merge_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_copy RECORD;
  v_window INT;
BEGIN
  BEGIN
    IF NEW.group_count > OLD.group_count AND NEW.read = false THEN
      SELECT group_window_minutes INTO v_window FROM notification_types WHERE type = NEW.type;
      SELECT * INTO v_copy FROM notification_push_copy(NEW);
      PERFORM enqueue_push(
        NEW.user_id, NEW.id, NEW.type, v_copy.title, v_copy.body, NEW.route,
        NEW.group_key,
        NULL,
        COALESCE(v_window, 60)
      );
      PERFORM invoke_push_dispatch();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notifications_after_group_merge_push failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. handle_message_push — fan-out loop (AFTER INSERT on messages). One
--    dispatch call after the loop, not per recipient. Body otherwise
--    byte-for-byte identical to the current (067) definition.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_message_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conv public.conversations%ROWTYPE; v_sender text; v_channel text; v_is_channel boolean := false;
  v_club text; v_preview text; v_title text; v_body text; v_type text; v_recipient record;
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
    FOR v_recipient IN SELECT cp.user_id FROM public.conversation_participants cp
      WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id <> NEW.sender_id AND cp.muted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.channel_mutes chm WHERE NEW.channel_id IS NOT NULL AND chm.channel_id = NEW.channel_id AND chm.user_id = cp.user_id)
    LOOP
      PERFORM public.enqueue_message_push(v_recipient.user_id, NULL, v_type, v_title, v_body,
        jsonb_strip_nulls(jsonb_build_object('screen', 'chat', 'chatId', NEW.conversation_id,
          'channelId', CASE WHEN v_is_channel THEN NEW.channel_id END)),
        'msg:' || NEW.conversation_id || ':' || CASE WHEN v_is_channel THEN NEW.channel_id::text ELSE 'main' END,
        'msg:' || NEW.id || ':' || v_recipient.user_id, 0, 'message', NEW.id, NEW.conversation_id, NEW.channel_id);
    END LOOP;
    PERFORM public.invoke_push_dispatch();
  EXCEPTION WHEN OTHERS THEN
    -- Do not let a message-derived database error reach server logs.
    RAISE WARNING 'handle_message_push failed';
  END;
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. notify_photo_post_university — the double-push fix described above.
--    Only change from the current (088) body: the direct
--    `PERFORM public.enqueue_push(...)` block is removed. The cascading
--    notifications_after_insert_push trigger (fixed in section 1) already
--    enqueues — and now immediately dispatches — the exact same push for
--    every recipient inserted here. Everything else is byte-for-byte
--    identical to 088.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_photo_post_university()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author_university UUID;
  v_author_name       TEXT;
  v_recipient         RECORD;
BEGIN
  BEGIN
    IF NEW.image_url IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT p.university_id,
           COALESCE(NULLIF(btrim(p.full_name), ''), p.username, 'Someone')
      INTO v_author_university, v_author_name
      FROM public.profiles p
     WHERE p.id = NEW.author_id;

    IF v_author_university IS NULL THEN
      RETURN NEW;
    END IF;

    FOR v_recipient IN
      SELECT p.id
        FROM public.profiles p
       WHERE p.university_id = v_author_university
         AND p.id <> NEW.author_id
    LOOP
      BEGIN
        INSERT INTO public.notifications (
          user_id, actor_id, type, entity_id, entity_type, read, message
        )
        VALUES (
          v_recipient.id,
          NEW.author_id,
          'club_post',
          NEW.id,
          'post',
          false,
          v_author_name || ' shared a photo post.'
        )
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'notify_photo_post_university failed for recipient %: %',
          v_recipient.id, SQLERRM;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_photo_post_university failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

COMMIT;
