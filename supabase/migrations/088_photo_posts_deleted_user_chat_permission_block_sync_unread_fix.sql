-- ============================================================================
-- 088 — Photo-post notifications, deleted-user membership cascade, chat
--       posting enforcement, unblock sync parity, and per-conversation unread
-- ============================================================================
--
-- Fix set:
--   2. Photo posts with an attached image now fan out club_post notifications
--      and push rows to same-university recipients, excluding the author and
--      skipping authors with no university.
--   4. club_members / club_officers now cascade on profile deletion so deleted
--      users disappear from member/officer lists structurally.
--   5. messages INSERT now raises a clear channel_restricted error before the
--      generic RLS violation path when the sender cannot post in the channel.
--   8. unblock_user now emits opaque private invalidations for both sides on
--      sync:block:<user_id> so cross-device state converges immediately.
--  10. get_unread_summary_for now returns an additional per-conversation unread
--      JSONB map without changing the existing top-level fields.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Photo-post fan-out on same-university recipients
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
  v_notification_id   UUID;
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
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_notification_id;

        IF v_notification_id IS NOT NULL THEN
          PERFORM public.enqueue_push(
            v_recipient.id,
            v_notification_id,
            'club_post',
            v_author_name,
            v_author_name || ' shared a photo post.',
            jsonb_build_object('screen', 'post', 'postId', NEW.id),
            'club_post:' || NEW.id::text,
            'club_post:' || NEW.id::text || ':' || v_recipient.id::text,
            0
          );
        END IF;
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

DROP TRIGGER IF EXISTS trg_photo_post_university_notify ON public.posts;
CREATE TRIGGER trg_photo_post_university_notify
  AFTER INSERT ON public.posts
  FOR EACH ROW
  WHEN (NEW.image_url IS NOT NULL)
  EXECUTE FUNCTION public.notify_photo_post_university();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Deleted users must disappear from member/officer lists
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.club_members
    WHERE user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'club_members already contains orphaned rows; refuse to continue';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.club_officers
    WHERE user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'club_officers already contains orphaned rows; refuse to continue';
  END IF;
END;
$$;

ALTER TABLE public.club_members DROP CONSTRAINT IF EXISTS club_members_user_id_fkey;
ALTER TABLE public.club_members
  ADD CONSTRAINT club_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.club_officers DROP CONSTRAINT IF EXISTS club_officers_user_id_fkey;
ALTER TABLE public.club_officers
  ADD CONSTRAINT club_officers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Clear server-side channel permission error on message INSERT
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_message_channel_post_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.channel_id IS NOT NULL AND NOT public.can_post_in_channel(NEW.channel_id) THEN
    RAISE EXCEPTION 'channel_restricted'
      USING ERRCODE = '42501',
            DETAIL = 'You do not have permission to post in this channel.',
            HINT = 'Request access from a club officer or switch to a channel you can post in.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_message_channel_post_permission ON public.messages;
CREATE TRIGGER trg_enforce_message_channel_post_permission
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_message_channel_post_permission();

-- Keep the existing RLS gate in place as defense-in-depth.
DROP POLICY IF EXISTS "messages: participants can insert" ON public.messages;
CREATE POLICY "messages: participants can insert"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND is_conversation_participant(conversation_id)
    AND (channel_id IS NULL OR can_post_in_channel(channel_id))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Cross-device unblock sync parity
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unblock_user(p_target uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me      uuid := (SELECT auth.uid());
  v_removed int  := 0;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_target IS NULL OR p_target = v_me THEN
    RETURN jsonb_build_object('status', 'ok', 'was_blocked', false);
  END IF;

  PERFORM pg_advisory_xact_lock(private.user_pair_lock_key(v_me, p_target));

  DELETE FROM public.user_blocks ub
   WHERE ub.blocker_id = v_me
     AND ub.blocked_id = p_target;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  BEGIN
    PERFORM realtime.send('{}'::jsonb, 'invalidate', 'sync:block:' || v_me::text, true);
    PERFORM realtime.send('{}'::jsonb, 'invalidate', 'sync:block:' || p_target::text, true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'unblock_user block sync broadcast failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('status', 'ok', 'was_blocked', v_removed > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.unblock_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unblock_user(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Per-conversation unread summary map
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_unread_summary_for(p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid                UUID := p_user;
  v_notifications      INT;
  v_dm_threads         INT;
  v_club_threads       INT;
  v_direct_messages    INT;
  v_group_messages     INT;
  v_conversations      JSONB := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'unread_notifications', 0,
      'unread_threads', 0,
      'unread_direct_messages', 0,
      'unread_group_messages', 0,
      'unread_conversations', '[]'::jsonb
    );
  END IF;

  SELECT count(*) INTO v_notifications
  FROM notifications n
  JOIN notification_types t ON t.type = n.type
  WHERE n.user_id = v_uid AND n.read = false AND t.in_app AND t.enabled;

  -- Single category: unread messages across one-to-one conversations.
  SELECT count(*) INTO v_direct_messages
  FROM conversation_participants cp
  JOIN conversations c ON c.id = cp.conversation_id
  JOIN messages m      ON m.conversation_id = c.id
  WHERE cp.user_id = v_uid
    AND c.type = 'direct'
    AND cp.hidden_at IS NULL
    AND c.deleted_at IS NULL
    AND m.sender_id <> v_uid
    AND m.deleted_at IS NULL
    AND m.created_at > COALESCE(cp.last_read_at, cp.joined_at, 'epoch')
    AND (cp.cleared_before IS NULL OR m.created_at > cp.cleared_before)
    AND NOT EXISTS (
      SELECT 1 FROM message_hides mh
      WHERE mh.message_id = m.id AND mh.user_id = v_uid
    );

  -- Groups category: custom group chats (conversation read state) PLUS club
  -- member chats and club officer chats (per-channel read state). The two
  -- halves cannot overlap: they select disjoint conversation types.
  SELECT
    COALESCE((
      SELECT count(*)
      FROM conversation_participants cp
      JOIN conversations c ON c.id = cp.conversation_id
      JOIN messages m      ON m.conversation_id = c.id
      WHERE cp.user_id = v_uid
        AND c.type = 'group'
        AND cp.hidden_at IS NULL
        AND c.deleted_at IS NULL
        AND m.sender_id <> v_uid
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(cp.last_read_at, cp.joined_at, 'epoch')
        AND (cp.cleared_before IS NULL OR m.created_at > cp.cleared_before)
        AND NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh.message_id = m.id AND mh.user_id = v_uid
        )
    ), 0)
    +
    COALESCE((
      SELECT count(*)
      FROM conversation_participants cp
      JOIN conversations c          ON c.id = cp.conversation_id
      JOIN conversation_channels ch ON ch.conversation_id = c.id
      JOIN messages m               ON m.conversation_id = c.id
                                   AND m.channel_id = ch.id
      WHERE cp.user_id = v_uid
        AND c.type IN ('club_group','officer_chat')
        AND cp.hidden_at IS NULL
        AND c.deleted_at IS NULL
        AND m.sender_id <> v_uid
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(
              (SELECT cr.last_read_at FROM channel_reads cr
               WHERE cr.channel_id = ch.id AND cr.user_id = v_uid),
              cp.joined_at, 'epoch')
        AND (cp.cleared_before IS NULL OR m.created_at > cp.cleared_before)
        AND NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh.message_id = m.id AND mh.user_id = v_uid
        )
    ), 0)
  INTO v_group_messages;

  WITH unread_messages AS (
    SELECT c.id AS conversation_id, m.id AS message_id
    FROM conversation_participants cp
    JOIN conversations c ON c.id = cp.conversation_id
    JOIN messages m ON m.conversation_id = c.id
    WHERE cp.user_id = v_uid
      AND c.type IN ('direct','group')
      AND cp.hidden_at IS NULL
      AND c.deleted_at IS NULL
      AND m.sender_id <> v_uid
      AND m.channel_id IS NULL
      AND m.deleted_at IS NULL
      AND m.created_at > COALESCE(cp.last_read_at, cp.joined_at, 'epoch')
      AND (cp.cleared_before IS NULL OR m.created_at > cp.cleared_before)
      AND NOT EXISTS (
        SELECT 1 FROM message_hides mh
        WHERE mh.message_id = m.id AND mh.user_id = v_uid
      )
    UNION ALL
    SELECT c.id AS conversation_id, m.id AS message_id
    FROM conversation_participants cp
    JOIN conversations c ON c.id = cp.conversation_id
    JOIN conversation_channels ch ON ch.conversation_id = c.id
    JOIN messages m ON m.conversation_id = c.id AND m.channel_id = ch.id
    WHERE cp.user_id = v_uid
      AND c.type IN ('club_group','officer_chat')
      AND cp.hidden_at IS NULL
      AND c.deleted_at IS NULL
      AND m.sender_id <> v_uid
      AND m.deleted_at IS NULL
      AND m.created_at > COALESCE(
            (SELECT cr.last_read_at FROM channel_reads cr
             WHERE cr.channel_id = ch.id AND cr.user_id = v_uid),
            cp.joined_at, 'epoch')
      AND (cp.cleared_before IS NULL OR m.created_at > cp.cleared_before)
      AND NOT EXISTS (
        SELECT 1 FROM message_hides mh
        WHERE mh.message_id = m.id AND mh.user_id = v_uid
      )
  ),
  unread_conversations AS (
    SELECT conversation_id, count(DISTINCT message_id) AS unread_count
    FROM unread_messages
    GROUP BY conversation_id
  )
  SELECT COALESCE(
           jsonb_agg(jsonb_build_object(
             'conversation_id', conversation_id,
             'unread_count', unread_count
           ) ORDER BY conversation_id),
           '[]'::jsonb
         )
    INTO v_conversations
    FROM (
      SELECT conversation_id, unread_count
      FROM unread_conversations
      WHERE unread_count > 0
    ) x;

  SELECT count(*) FILTER (WHERE c.type IN ('direct','group')) INTO v_dm_threads
  FROM conversation_participants cp
  JOIN conversations c ON c.id = cp.conversation_id
  WHERE cp.user_id = v_uid
    AND c.type IN ('direct','group')
    AND cp.hidden_at IS NULL
    AND c.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.conversation_id = c.id
        AND m.sender_id <> v_uid
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(cp.last_read_at, cp.joined_at, 'epoch')
        AND (cp.cleared_before IS NULL OR m.created_at > cp.cleared_before)
        AND NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh.message_id = m.id AND mh.user_id = v_uid
        )
    );

  SELECT count(*) FILTER (WHERE c.type IN ('club_group','officer_chat')) INTO v_club_threads
  FROM conversation_participants cp
  JOIN conversations c   ON c.id = cp.conversation_id
  JOIN conversation_channels ch ON ch.conversation_id = c.id
  WHERE cp.user_id = v_uid
    AND c.type IN ('club_group','officer_chat')
    AND cp.hidden_at IS NULL
    AND c.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.conversation_id = c.id
        AND m.channel_id = ch.id
        AND m.sender_id <> v_uid
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(
              (SELECT cr.last_read_at FROM channel_reads cr
               WHERE cr.channel_id = ch.id AND cr.user_id = v_uid),
              cp.joined_at, 'epoch')
        AND (cp.cleared_before IS NULL OR m.created_at > cp.cleared_before)
        AND NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh.message_id = m.id AND mh.user_id = v_uid
        )
    );

  RETURN jsonb_build_object(
    'unread_notifications', COALESCE(v_notifications, 0),
    'unread_threads', COALESCE(v_dm_threads, 0) + COALESCE(v_club_threads, 0),
    'unread_direct_messages', COALESCE(v_direct_messages, 0),
    'unread_group_messages', COALESCE(v_group_messages, 0),
    'unread_conversations', v_conversations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_unread_summary_for(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_summary_for(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_unread_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_unread_summary_for(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.get_unread_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unread_summary() TO authenticated;

COMMIT;
