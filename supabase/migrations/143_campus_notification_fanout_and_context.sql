-- ============================================================================
-- 143 — Campus-wide public club notification fan-out and route context
--
-- Public events and official club posts/direct gallery photos notify the
-- hosting club's members plus students on the hosting club's campus. The
-- existing restricted/member-only paths remain unchanged.
-- ============================================================================

BEGIN;

-- Keep the existing route column as the notification/frontend contract while
-- adding enough context for exact event/post/club deep links and push titles.
CREATE OR REPLACE FUNCTION public.notification_route(
  p_type TEXT, p_entity_id UUID, p_entity_type TEXT, p_actor_id UUID
) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_type IN ('like','comment') AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','post','postId',p_entity_id)
    WHEN p_type = 'club_post' AND p_entity_id IS NOT NULL
      THEN COALESCE(
        (
          SELECT jsonb_strip_nulls(jsonb_build_object(
            'screen', 'post',
            'postId', p.id,
            'clubId', c.id,
            'clubName', c.name
          ))
          FROM public.posts p
          JOIN public.clubs c ON c.id = p.club_id
          WHERE p.id = p_entity_id
        ),
        jsonb_build_object('screen','post','postId',p_entity_id)
      )
    WHEN p_type IN (
      'new_event', 'event_updated', 'event_reminder_tomorrow',
      'event_reminder_hour', 'event_reminder_now', 'event_last_chance',
      'event_rsvp'
    ) AND p_entity_id IS NOT NULL
      THEN COALESCE(
        (
          SELECT jsonb_strip_nulls(jsonb_build_object(
            'screen', 'event',
            'eventId', e.id,
            'clubId', c.id,
            'clubName', c.name
          ))
          FROM public.events e
          JOIN public.clubs c ON c.id = e.club_id
          WHERE e.id = p_entity_id
        ),
        jsonb_build_object('screen','event','eventId',p_entity_id)
      )
    WHEN p_type = 'club_photo' AND p_entity_id IS NOT NULL
      THEN COALESCE(
        (
          SELECT jsonb_strip_nulls(jsonb_build_object(
            'screen', 'club',
            'clubId', c.id,
            'clubName', c.name,
            'photoId', cp.id,
            'postId', cp.post_id
          ))
          FROM public.club_photos cp
          JOIN public.clubs c ON c.id = cp.club_id
          WHERE cp.id = p_entity_id
        ),
        jsonb_build_object('screen','club','clubId',p_entity_id)
      )
    WHEN p_type = 'event_canceled' AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','club','clubId',p_entity_id)
    WHEN p_type IN (
      'club_joined', 'member_joined', 'officer_role', 'officer_removed',
      'club_removed', 'club_inactive'
    ) AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','club','clubId',p_entity_id)
    WHEN p_type IN (
      'club_chat_added', 'officer_chat_added', 'group_chat_added',
      'chat_invite_joined'
    ) AND p_entity_id IS NOT NULL
      THEN CASE WHEN p_entity_type = 'message'
                THEN jsonb_build_object('screen','chat','chatId',p_entity_id)
                ELSE jsonb_build_object('screen','club','clubId',p_entity_id) END
    WHEN p_actor_id IS NOT NULL
      THEN jsonb_build_object('screen','profile','userId',p_actor_id)
    ELSE jsonb_build_object('screen','notifications')
  END;
$$;

-- Public event fan-out. `specific` and `members` retain the exact existing
-- member/allow-list audience logic; only `everyone` gains same-campus users.
CREATE OR REPLACE FUNCTION public.handle_new_event_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_university_id UUID;
BEGIN
  BEGIN
    IF NEW.visibility = 'specific' THEN
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read)
      SELECT uid, NEW.created_by, 'new_event', NEW.id, 'event', false
      FROM unnest(COALESCE(NEW.specific_user_ids, ARRAY[]::uuid[])) AS uid
      WHERE uid <> NEW.created_by;
    ELSIF NEW.visibility = 'everyone' THEN
      -- SCALE LIMIT: this remains synchronous to match the active 031/046
      -- trigger architecture. Revisit with a queued worker before a campus
      -- population reaches the thousands; migration 102 is only a review
      -- proposal and is not an active fan-out implementation.
      SELECT COALESCE(
               c.university_id,
               (SELECT ac.launch_university_id FROM app_config ac LIMIT 1)
             )
        INTO v_club_university_id
        FROM clubs c
       WHERE c.id = NEW.club_id;

      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read)
      SELECT audience.user_id, NEW.created_by, 'new_event', NEW.id, 'event', false
      FROM (
        SELECT cm.user_id
        FROM club_members cm
        WHERE cm.club_id = NEW.club_id

        UNION

        SELECT p.id AS user_id
        FROM profiles p
        WHERE p.university_id = v_club_university_id
      ) AS audience
      WHERE audience.user_id <> NEW.created_by;
    ELSE
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read)
      SELECT cm.user_id, NEW.created_by, 'new_event', NEW.id, 'event', false
      FROM club_members cm
      WHERE cm.club_id = NEW.club_id
        AND cm.user_id <> NEW.created_by;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_event_notify failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_new_event_notify ON public.events;
CREATE TRIGGER trg_new_event_notify
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_event_notify();

-- Official club posts are public by construction (`author_kind = 'club'`).
-- Tagged student posts retain their existing member-only notification path.
CREATE OR REPLACE FUNCTION public.notify_club_post(
  p_post_id UUID, p_club_id UUID, p_author UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club             TEXT;
  v_author           TEXT;
  v_is_public_club_post BOOLEAN;
  v_club_university_id UUID;
BEGIN
  SELECT name, COALESCE(
           university_id,
           (SELECT ac.launch_university_id FROM app_config ac LIMIT 1)
         )
    INTO v_club, v_club_university_id
    FROM clubs
   WHERE id = p_club_id;
  SELECT COALESCE(NULLIF(full_name, ''), username)
    INTO v_author
    FROM profiles
   WHERE id = p_author;
  IF v_club IS NULL THEN RETURN; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM posts
    WHERE id = p_post_id AND author_kind = 'club'
  ) INTO v_is_public_club_post;

  IF v_is_public_club_post THEN
    -- SCALE LIMIT: this remains synchronous to match the active 046/083
    -- trigger architecture. Revisit with a queued worker before a campus
    -- population reaches the thousands; migration 102 is only a review
    -- proposal and is not an active fan-out implementation.
    INSERT INTO notifications (
      user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key
    )
    SELECT audience.user_id, p_author, 'club_post', p_post_id, 'post', false,
           COALESCE(v_author, 'A member') || ' shared a new post in ' || v_club || '.',
           'club_post:' || p_post_id || ':' || audience.user_id
    FROM (
      SELECT cm.user_id
      FROM club_members cm
      WHERE cm.club_id = p_club_id

        UNION

      SELECT p.id AS user_id
      FROM profiles p
      WHERE p.university_id = v_club_university_id
    ) AS audience
    WHERE audience.user_id <> p_author
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  ELSE
    -- Existing tagged-student-post behavior is unchanged.
    INSERT INTO notifications (
      user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key
    )
    SELECT cm.user_id, p_author, 'club_post', p_post_id, 'post', false,
           COALESCE(v_author, 'A member') || ' shared a new post in ' || v_club || '.',
           'club_post:' || p_post_id || ':' || cm.user_id
    FROM club_members cm
    WHERE cm.club_id = p_club_id AND cm.user_id <> p_author
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;
END;
$$;

-- Direct officer-uploaded gallery photos are public only while visible. The
-- existing member notification is retained even for a hidden upload; the new
-- campus audience is gated to the public state only.
CREATE OR REPLACE FUNCTION public.notify_club_photo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club             TEXT;
  v_uploader         TEXT;
  v_club_university_id UUID;
BEGIN
  IF NEW.source IS DISTINCT FROM 'officer_upload' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT name, COALESCE(
             university_id,
             (SELECT ac.launch_university_id FROM app_config ac LIMIT 1)
           )
      INTO v_club, v_club_university_id
      FROM clubs
     WHERE id = NEW.club_id;
    SELECT COALESCE(NULLIF(full_name, ''), username)
      INTO v_uploader
      FROM profiles
     WHERE id = NEW.uploaded_by;
    IF v_club IS NULL THEN RETURN NEW; END IF;

    IF NEW.is_visible THEN
      -- SCALE LIMIT: this remains synchronous to match the active 083
      -- trigger architecture. Revisit with a queued worker before a campus
      -- population reaches the thousands; migration 102 is only a review
      -- proposal and is not an active fan-out implementation.
      INSERT INTO notifications (
        user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key
      )
      SELECT audience.user_id, NEW.uploaded_by, 'club_photo', NEW.id, 'club', false,
             COALESCE(v_uploader, 'A club officer') || ' added a new photo to ' || v_club || '.',
             'club_photo:' || NEW.id || ':' || audience.user_id
      FROM (
        SELECT cm.user_id
        FROM club_members cm
        WHERE cm.club_id = NEW.club_id

        UNION

        SELECT p.id AS user_id
        FROM profiles p
        WHERE p.university_id = v_club_university_id
      ) AS audience
      WHERE audience.user_id IS DISTINCT FROM NEW.uploaded_by
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    ELSE
      -- Existing member-only behavior is unchanged for hidden uploads.
      INSERT INTO notifications (
        user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key
      )
      SELECT cm.user_id, NEW.uploaded_by, 'club_photo', NEW.id, 'club', false,
             COALESCE(v_uploader, 'A club officer') || ' added a new photo to ' || v_club || '.',
             'club_photo:' || NEW.id || ':' || cm.user_id
      FROM club_members cm
      WHERE cm.club_id = NEW.club_id
        AND cm.user_id IS DISTINCT FROM NEW.uploaded_by
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_club_photo failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_photo_notify ON public.club_photos;
CREATE TRIGGER trg_club_photo_notify
  AFTER INSERT ON public.club_photos
  FOR EACH ROW EXECUTE FUNCTION public.notify_club_photo();

COMMIT;
