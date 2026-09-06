-- ============================================================================
-- 125 — anonymous public club twin
--
-- The five RPCs below are the complete public-data boundary for the logged-out
-- club QR route.  They deliberately do not add base-table policies or grants.
-- Every JSON value is constructed from an explicit field list.
-- ============================================================================

BEGIN;

-- Migration 075 left this legacy pre-authentication grant in place.  The
-- public twin is RPC-only, so remove it before installing the RPC surface.
REVOKE SELECT ON public.clubs FROM anon;
REVOKE ALL ON TABLE
  public.clubs, public.club_goals, public.club_members, public.club_officers, public.club_photos,
  public.events, public.posts, public.post_images, public.event_rsvps,
  public.saved_events, public.profiles, public.user_privacy,
  public.post_comments, public.post_likes, public.content_lifecycle
FROM anon;

CREATE OR REPLACE FUNCTION public.get_public_club_profile(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id                    uuid;
  v_name                  text;
  v_handle                text;
  v_description           text;
  v_avatar_url            text;
  v_banner_url            text;
  v_meeting_day           text;
  v_meeting_time_start    time;
  v_meeting_time_end      time;
  v_meeting_location      text;
  v_meeting_building      text;
  v_meeting_room          text;
  v_meeting_schedule      jsonb;
  v_member_count          integer;
  v_goals                 jsonb;
  v_officers              jsonb;
  v_upcoming_items        jsonb := '[]'::jsonb;
  v_past_items            jsonb := '[]'::jsonb;
  v_media_items           jsonb := '[]'::jsonb;
  v_posts_items           jsonb := '[]'::jsonb;
  v_upcoming_has_more     boolean := false;
  v_past_has_more         boolean := false;
  v_media_has_more        boolean := false;
  v_posts_has_more        boolean := false;
  v_upcoming_seen         integer := 0;
  v_past_seen             integer := 0;
  v_media_seen            integer := 0;
  v_posts_seen            integer := 0;
  v_last_event_date       date;
  v_last_start_time       time;
  v_last_event_id         uuid;
  v_last_created_at       timestamptz;
  v_last_item_id          uuid;
  v_upcoming_cursor       text;
  v_past_cursor           text;
  v_media_cursor          text;
  v_posts_cursor          text;
  v_event                 record;
  v_photo                 record;
  v_post                  record;
BEGIN
  SELECT
    c.id, c.name, c.handle, c.description, c.avatar_url, c.banner_url,
    c.meeting_day, c.meeting_time_start, c.meeting_time_end,
    c.meeting_location, c.meeting_building, c.meeting_room,
    c.meeting_schedule, c.member_count
    INTO
      v_id, v_name, v_handle, v_description, v_avatar_url, v_banner_url,
      v_meeting_day, v_meeting_time_start, v_meeting_time_end,
      v_meeting_location, v_meeting_building, v_meeting_room,
      v_meeting_schedule, v_member_count
    FROM public.clubs AS c
   WHERE c.id = p_club_id
     AND c.is_active IS TRUE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', cg.id,
        'goal_text', cg.goal_text,
        'display_order', cg.display_order
      ) ORDER BY cg.display_order, cg.id
    ),
    '[]'::jsonb
  )
    INTO v_goals
    FROM public.club_goals AS cg
   WHERE cg.club_id = p_club_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'role_title', co.role_title,
        'display_order', co.display_order
      ) ORDER BY co.display_order, co.id
    ),
    '[]'::jsonb
  )
    INTO v_officers
    FROM public.club_officers AS co
   WHERE co.club_id = p_club_id;

  FOR v_event IN
    SELECT
      e.id, e.title, e.emoji, e.description, e.cover_image_url,
      e.event_date, e.start_time, e.end_time, e.event_end_at,
      e.location, e.building, e.room,
      COALESCE((
        SELECT array_agg(ea.activity ORDER BY ea.activity, ea.id)
          FROM public.event_activities AS ea
         WHERE ea.event_id = e.id
      ), ARRAY[]::text[]) AS activity_tags,
      COALESCE((
        SELECT array_agg(ei.interest ORDER BY ei.interest, ei.id)
          FROM public.event_interests AS ei
         WHERE ei.event_id = e.id
      ), ARRAY[]::text[]) AS interest_tags
      FROM public.events AS e
      JOIN public.clubs AS c
        ON c.id = e.club_id
     WHERE e.club_id = p_club_id
       AND c.id = p_club_id
       AND c.is_active IS TRUE
       AND e.visibility = 'everyone'
       AND public.content_is_student_visible('event', e.id)
       AND e.event_end_at > now()
     ORDER BY e.event_date ASC, e.start_time ASC, e.id ASC
     LIMIT 9
  LOOP
    v_upcoming_seen := v_upcoming_seen + 1;
    IF v_upcoming_seen <= 8 THEN
      v_upcoming_items := v_upcoming_items || jsonb_build_array(jsonb_build_object(
        'id', v_event.id,
        'title', v_event.title,
        'emoji', v_event.emoji,
        'description', v_event.description,
        'cover_image_url', v_event.cover_image_url,
        'event_date', v_event.event_date,
        'start_time', v_event.start_time,
        'end_time', v_event.end_time,
        'event_end_at', v_event.event_end_at,
        'location', v_event.location,
        'building', v_event.building,
        'room', v_event.room,
        'activity_tags', v_event.activity_tags,
        'interest_tags', v_event.interest_tags
      ));
      v_last_event_date := v_event.event_date;
      v_last_start_time := v_event.start_time;
      v_last_event_id := v_event.id;
    ELSE
      v_upcoming_has_more := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_upcoming_has_more THEN
    v_upcoming_cursor := rtrim(replace(replace(
      encode(convert_to(jsonb_build_object(
        'collection', 'upcoming_events',
        'event_date', v_last_event_date,
        'start_time', v_last_start_time,
        'id', v_last_event_id
      )::text, 'UTF8'), 'base64'), '+', '-'), '/', '_'), '=');
  END IF;

  FOR v_event IN
    SELECT
      e.id, e.title, e.emoji, e.description, e.cover_image_url,
      e.event_date, e.start_time, e.end_time, e.event_end_at,
      e.location, e.building, e.room,
      COALESCE((
        SELECT array_agg(ea.activity ORDER BY ea.activity, ea.id)
          FROM public.event_activities AS ea
         WHERE ea.event_id = e.id
      ), ARRAY[]::text[]) AS activity_tags,
      COALESCE((
        SELECT array_agg(ei.interest ORDER BY ei.interest, ei.id)
          FROM public.event_interests AS ei
         WHERE ei.event_id = e.id
      ), ARRAY[]::text[]) AS interest_tags
      FROM public.events AS e
      JOIN public.clubs AS c
        ON c.id = e.club_id
     WHERE e.club_id = p_club_id
       AND c.id = p_club_id
       AND c.is_active IS TRUE
       AND e.visibility = 'everyone'
       AND public.content_is_student_visible('event', e.id)
       AND e.event_end_at <= now()
     ORDER BY e.event_date DESC, e.start_time DESC, e.id DESC
     LIMIT 9
  LOOP
    v_past_seen := v_past_seen + 1;
    IF v_past_seen <= 8 THEN
      v_past_items := v_past_items || jsonb_build_array(jsonb_build_object(
        'id', v_event.id,
        'title', v_event.title,
        'emoji', v_event.emoji,
        'description', v_event.description,
        'cover_image_url', v_event.cover_image_url,
        'event_date', v_event.event_date,
        'start_time', v_event.start_time,
        'end_time', v_event.end_time,
        'event_end_at', v_event.event_end_at,
        'location', v_event.location,
        'building', v_event.building,
        'room', v_event.room,
        'activity_tags', v_event.activity_tags,
        'interest_tags', v_event.interest_tags
      ));
      v_last_event_date := v_event.event_date;
      v_last_start_time := v_event.start_time;
      v_last_event_id := v_event.id;
    ELSE
      v_past_has_more := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_past_has_more THEN
    v_past_cursor := rtrim(replace(replace(
      encode(convert_to(jsonb_build_object(
        'collection', 'past_events',
        'event_date', v_last_event_date,
        'start_time', v_last_start_time,
        'id', v_last_event_id
      )::text, 'UTF8'), 'base64'), '+', '-'), '/', '_'), '=');
  END IF;

  FOR v_photo IN
    SELECT
      cp.id, cp.url, cp.source, cp.caption, cp.created_at,
      GREATEST(1, COALESCE((
        SELECT count(*)::integer
          FROM public.post_images AS pi
         WHERE pi.post_id = cp.post_id
      ), 0)) AS image_count
      FROM public.club_photos AS cp
      JOIN public.clubs AS c
        ON c.id = cp.club_id
      LEFT JOIN public.posts AS p
        ON p.id = cp.post_id
       AND p.club_id = cp.club_id
     WHERE cp.club_id = p_club_id
       AND c.id = p_club_id
       AND c.is_active IS TRUE
       AND cp.is_visible IS TRUE
       AND (
         cp.source = 'officer_upload'
         OR (
           cp.source = 'tagged_post'
           AND p.id IS NOT NULL
           AND public.content_is_student_visible('post', p.id)
         )
       )
     ORDER BY cp.created_at DESC, cp.id DESC
     LIMIT 9
  LOOP
    v_media_seen := v_media_seen + 1;
    IF v_media_seen <= 8 THEN
      v_media_items := v_media_items || jsonb_build_array(jsonb_build_object(
        'id', v_photo.id,
        'url', v_photo.url,
        'source', v_photo.source,
        'caption', v_photo.caption,
        'created_at', v_photo.created_at,
        'image_count', v_photo.image_count
      ));
      v_last_created_at := v_photo.created_at;
      v_last_item_id := v_photo.id;
    ELSE
      v_media_has_more := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_media_has_more THEN
    v_media_cursor := rtrim(replace(replace(
      encode(convert_to(jsonb_build_object(
        'collection', 'media',
        'created_at', v_last_created_at,
        'id', v_last_item_id
      )::text, 'UTF8'), 'base64'), '+', '-'), '/', '_'), '=');
  END IF;

  FOR v_post IN
    SELECT
      p.id, p.caption, p.image_url, p.created_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'path', pi.storage_path,
          'position', pi.position,
          'width', pi.width,
          'height', pi.height
        ) ORDER BY pi.position)
          FROM public.post_images AS pi
         WHERE pi.post_id = p.id
      ), '[]'::jsonb) AS images
      FROM public.posts AS p
      JOIN public.clubs AS c
        ON c.id = p.club_id
     WHERE p.club_id = p_club_id
       AND p.club_id IS NOT NULL
       AND p.author_kind = 'club'
       AND c.id = p_club_id
       AND c.is_active IS TRUE
       AND public.content_is_student_visible('post', p.id)
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT 9
  LOOP
    v_posts_seen := v_posts_seen + 1;
    IF v_posts_seen <= 8 THEN
      v_posts_items := v_posts_items || jsonb_build_array(jsonb_build_object(
        'id', v_post.id,
        'caption', v_post.caption,
        'image_url', v_post.image_url,
        'images', v_post.images,
        'created_at', v_post.created_at
      ));
      v_last_created_at := v_post.created_at;
      v_last_item_id := v_post.id;
    ELSE
      v_posts_has_more := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_posts_has_more THEN
    v_posts_cursor := rtrim(replace(replace(
      encode(convert_to(jsonb_build_object(
        'collection', 'posts',
        'created_at', v_last_created_at,
        'id', v_last_item_id
      )::text, 'UTF8'), 'base64'), '+', '-'), '/', '_'), '=');
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'name', v_name,
    'handle', v_handle,
    'description', v_description,
    'avatar_url', v_avatar_url,
    'banner_url', v_banner_url,
    'meeting_day', v_meeting_day,
    'meeting_time_start', v_meeting_time_start,
    'meeting_time_end', v_meeting_time_end,
    'meeting_location', v_meeting_location,
    'meeting_building', v_meeting_building,
    'meeting_room', v_meeting_room,
    'meeting_schedule', v_meeting_schedule,
    'member_count', v_member_count,
    'goals', v_goals,
    'officers', v_officers,
    'upcoming_events', jsonb_build_object(
      'items', v_upcoming_items,
      'next_cursor', v_upcoming_cursor,
      'has_more', v_upcoming_has_more
    ),
    'past_events', jsonb_build_object(
      'items', v_past_items,
      'next_cursor', v_past_cursor,
      'has_more', v_past_has_more
    ),
    'media', jsonb_build_object(
      'items', v_media_items,
      'next_cursor', v_media_cursor,
      'has_more', v_media_has_more
    ),
    'posts', jsonb_build_object(
      'items', v_posts_items,
      'next_cursor', v_posts_cursor,
      'has_more', v_posts_has_more
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_club_upcoming_events(
  p_club_id uuid,
  p_after text DEFAULT NULL,
  p_limit integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit                 integer := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
  v_cursor                jsonb;
  v_cursor_date           date;
  v_cursor_start_time     time;
  v_cursor_id             uuid;
  v_items                 jsonb := '[]'::jsonb;
  v_next_cursor           text;
  v_has_more              boolean := false;
  v_seen                  integer := 0;
  v_last_date             date;
  v_last_start_time       time;
  v_last_id               uuid;
  v_event                 record;
BEGIN
  IF p_after IS NOT NULL THEN
    BEGIN
      IF p_after = '' OR p_after !~ '^[A-Za-z0-9_-]+$' OR length(p_after) % 4 = 1 THEN
        RAISE EXCEPTION 'invalid_cursor';
      END IF;
      v_cursor := convert_from(
        decode(
          replace(replace(p_after, '-', '+'), '_', '/')
          || CASE length(p_after) % 4 WHEN 2 THEN '==' WHEN 3 THEN '=' ELSE '' END,
          'base64'
        ),
        'UTF8'
      )::jsonb;
      IF jsonb_typeof(v_cursor) IS DISTINCT FROM 'object'
         OR (SELECT count(*) FROM jsonb_object_keys(v_cursor)) <> 4
         OR NOT (v_cursor ? 'collection' AND v_cursor ? 'event_date'
                 AND v_cursor ? 'start_time' AND v_cursor ? 'id')
         OR EXISTS (
           SELECT 1 FROM jsonb_object_keys(v_cursor) AS key_name(key)
            WHERE key NOT IN ('collection', 'event_date', 'start_time', 'id')
         )
         OR v_cursor->>'collection' <> 'upcoming_events'
         OR jsonb_typeof(v_cursor->'event_date') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_cursor->'start_time') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_cursor->'id') IS DISTINCT FROM 'string'
         OR (v_cursor->>'event_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         OR (v_cursor->>'start_time') !~ '^[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?$'
         OR (v_cursor->>'id') !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
        RAISE EXCEPTION 'invalid_cursor';
      END IF;
      v_cursor_date := (v_cursor->>'event_date')::date;
      v_cursor_start_time := (v_cursor->>'start_time')::time;
      v_cursor_id := (v_cursor->>'id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
    END;
  END IF;

  FOR v_event IN
    SELECT
      e.id, e.title, e.emoji, e.description, e.cover_image_url,
      e.event_date, e.start_time, e.end_time, e.event_end_at,
      e.location, e.building, e.room,
      COALESCE((
        SELECT array_agg(ea.activity ORDER BY ea.activity, ea.id)
          FROM public.event_activities AS ea WHERE ea.event_id = e.id
      ), ARRAY[]::text[]) AS activity_tags,
      COALESCE((
        SELECT array_agg(ei.interest ORDER BY ei.interest, ei.id)
          FROM public.event_interests AS ei WHERE ei.event_id = e.id
      ), ARRAY[]::text[]) AS interest_tags
      FROM public.events AS e
      JOIN public.clubs AS c
        ON c.id = e.club_id
     WHERE e.club_id = p_club_id
       AND c.id = p_club_id
       AND c.is_active IS TRUE
       AND e.visibility = 'everyone'
       AND public.content_is_student_visible('event', e.id)
       AND e.event_end_at > now()
       AND (
         p_after IS NULL
         OR (e.event_date, e.start_time, e.id) > (v_cursor_date, v_cursor_start_time, v_cursor_id)
       )
     ORDER BY e.event_date ASC, e.start_time ASC, e.id ASC
     LIMIT (v_limit + 1)
  LOOP
    v_seen := v_seen + 1;
    IF v_seen <= v_limit THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'id', v_event.id,
        'title', v_event.title,
        'emoji', v_event.emoji,
        'description', v_event.description,
        'cover_image_url', v_event.cover_image_url,
        'event_date', v_event.event_date,
        'start_time', v_event.start_time,
        'end_time', v_event.end_time,
        'event_end_at', v_event.event_end_at,
        'location', v_event.location,
        'building', v_event.building,
        'room', v_event.room,
        'activity_tags', v_event.activity_tags,
        'interest_tags', v_event.interest_tags
      ));
      v_last_date := v_event.event_date;
      v_last_start_time := v_event.start_time;
      v_last_id := v_event.id;
    ELSE
      v_has_more := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_has_more THEN
    v_next_cursor := rtrim(replace(replace(
      encode(convert_to(jsonb_build_object(
        'collection', 'upcoming_events',
        'event_date', v_last_date,
        'start_time', v_last_start_time,
        'id', v_last_id
      )::text, 'UTF8'), 'base64'), '+', '-'), '/', '_'), '=');
  END IF;

  RETURN jsonb_build_object('items', v_items, 'next_cursor', v_next_cursor, 'has_more', v_has_more);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_club_past_events(
  p_club_id uuid,
  p_after text DEFAULT NULL,
  p_limit integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit                 integer := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
  v_cursor                jsonb;
  v_cursor_date           date;
  v_cursor_start_time     time;
  v_cursor_id             uuid;
  v_items                 jsonb := '[]'::jsonb;
  v_next_cursor           text;
  v_has_more              boolean := false;
  v_seen                  integer := 0;
  v_last_date             date;
  v_last_start_time       time;
  v_last_id               uuid;
  v_event                 record;
BEGIN
  IF p_after IS NOT NULL THEN
    BEGIN
      IF p_after = '' OR p_after !~ '^[A-Za-z0-9_-]+$' OR length(p_after) % 4 = 1 THEN
        RAISE EXCEPTION 'invalid_cursor';
      END IF;
      v_cursor := convert_from(
        decode(
          replace(replace(p_after, '-', '+'), '_', '/')
          || CASE length(p_after) % 4 WHEN 2 THEN '==' WHEN 3 THEN '=' ELSE '' END,
          'base64'
        ),
        'UTF8'
      )::jsonb;
      IF jsonb_typeof(v_cursor) IS DISTINCT FROM 'object'
         OR (SELECT count(*) FROM jsonb_object_keys(v_cursor)) <> 4
         OR NOT (v_cursor ? 'collection' AND v_cursor ? 'event_date'
                 AND v_cursor ? 'start_time' AND v_cursor ? 'id')
         OR EXISTS (
           SELECT 1 FROM jsonb_object_keys(v_cursor) AS key_name(key)
            WHERE key NOT IN ('collection', 'event_date', 'start_time', 'id')
         )
         OR v_cursor->>'collection' <> 'past_events'
         OR jsonb_typeof(v_cursor->'event_date') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_cursor->'start_time') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_cursor->'id') IS DISTINCT FROM 'string'
         OR (v_cursor->>'event_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         OR (v_cursor->>'start_time') !~ '^[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?$'
         OR (v_cursor->>'id') !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
        RAISE EXCEPTION 'invalid_cursor';
      END IF;
      v_cursor_date := (v_cursor->>'event_date')::date;
      v_cursor_start_time := (v_cursor->>'start_time')::time;
      v_cursor_id := (v_cursor->>'id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
    END;
  END IF;

  FOR v_event IN
    SELECT
      e.id, e.title, e.emoji, e.description, e.cover_image_url,
      e.event_date, e.start_time, e.end_time, e.event_end_at,
      e.location, e.building, e.room,
      COALESCE((
        SELECT array_agg(ea.activity ORDER BY ea.activity, ea.id)
          FROM public.event_activities AS ea WHERE ea.event_id = e.id
      ), ARRAY[]::text[]) AS activity_tags,
      COALESCE((
        SELECT array_agg(ei.interest ORDER BY ei.interest, ei.id)
          FROM public.event_interests AS ei WHERE ei.event_id = e.id
      ), ARRAY[]::text[]) AS interest_tags
      FROM public.events AS e
      JOIN public.clubs AS c
        ON c.id = e.club_id
     WHERE e.club_id = p_club_id
       AND c.id = p_club_id
       AND c.is_active IS TRUE
       AND e.visibility = 'everyone'
       AND public.content_is_student_visible('event', e.id)
       AND e.event_end_at <= now()
       AND (
         p_after IS NULL
         OR (e.event_date, e.start_time, e.id) < (v_cursor_date, v_cursor_start_time, v_cursor_id)
       )
     ORDER BY e.event_date DESC, e.start_time DESC, e.id DESC
     LIMIT (v_limit + 1)
  LOOP
    v_seen := v_seen + 1;
    IF v_seen <= v_limit THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'id', v_event.id,
        'title', v_event.title,
        'emoji', v_event.emoji,
        'description', v_event.description,
        'cover_image_url', v_event.cover_image_url,
        'event_date', v_event.event_date,
        'start_time', v_event.start_time,
        'end_time', v_event.end_time,
        'event_end_at', v_event.event_end_at,
        'location', v_event.location,
        'building', v_event.building,
        'room', v_event.room,
        'activity_tags', v_event.activity_tags,
        'interest_tags', v_event.interest_tags
      ));
      v_last_date := v_event.event_date;
      v_last_start_time := v_event.start_time;
      v_last_id := v_event.id;
    ELSE
      v_has_more := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_has_more THEN
    v_next_cursor := rtrim(replace(replace(
      encode(convert_to(jsonb_build_object(
        'collection', 'past_events',
        'event_date', v_last_date,
        'start_time', v_last_start_time,
        'id', v_last_id
      )::text, 'UTF8'), 'base64'), '+', '-'), '/', '_'), '=');
  END IF;

  RETURN jsonb_build_object('items', v_items, 'next_cursor', v_next_cursor, 'has_more', v_has_more);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_club_media(
  p_club_id uuid,
  p_after text DEFAULT NULL,
  p_limit integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit                 integer := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
  v_cursor                jsonb;
  v_cursor_created_at     timestamptz;
  v_cursor_id             uuid;
  v_items                 jsonb := '[]'::jsonb;
  v_next_cursor           text;
  v_has_more              boolean := false;
  v_seen                  integer := 0;
  v_last_created_at       timestamptz;
  v_last_id               uuid;
  v_photo                 record;
BEGIN
  IF p_after IS NOT NULL THEN
    BEGIN
      IF p_after = '' OR p_after !~ '^[A-Za-z0-9_-]+$' OR length(p_after) % 4 = 1 THEN
        RAISE EXCEPTION 'invalid_cursor';
      END IF;
      v_cursor := convert_from(
        decode(
          replace(replace(p_after, '-', '+'), '_', '/')
          || CASE length(p_after) % 4 WHEN 2 THEN '==' WHEN 3 THEN '=' ELSE '' END,
          'base64'
        ),
        'UTF8'
      )::jsonb;
      IF jsonb_typeof(v_cursor) IS DISTINCT FROM 'object'
         OR (SELECT count(*) FROM jsonb_object_keys(v_cursor)) <> 3
         OR NOT (v_cursor ? 'collection' AND v_cursor ? 'created_at' AND v_cursor ? 'id')
         OR EXISTS (
           SELECT 1 FROM jsonb_object_keys(v_cursor) AS key_name(key)
            WHERE key NOT IN ('collection', 'created_at', 'id')
         )
         OR v_cursor->>'collection' <> 'media'
         OR jsonb_typeof(v_cursor->'created_at') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_cursor->'id') IS DISTINCT FROM 'string'
         OR (v_cursor->>'created_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
         OR (v_cursor->>'id') !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
        RAISE EXCEPTION 'invalid_cursor';
      END IF;
      v_cursor_created_at := (v_cursor->>'created_at')::timestamptz;
      v_cursor_id := (v_cursor->>'id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
    END;
  END IF;

  FOR v_photo IN
    SELECT
      cp.id, cp.url, cp.source, cp.caption, cp.created_at,
      GREATEST(1, COALESCE((
        SELECT count(*)::integer FROM public.post_images AS pi WHERE pi.post_id = cp.post_id
      ), 0)) AS image_count
      FROM public.club_photos AS cp
      JOIN public.clubs AS c
        ON c.id = cp.club_id
      LEFT JOIN public.posts AS p
        ON p.id = cp.post_id
       AND p.club_id = cp.club_id
     WHERE cp.club_id = p_club_id
       AND c.id = p_club_id
       AND c.is_active IS TRUE
       AND cp.is_visible IS TRUE
       AND (
         cp.source = 'officer_upload'
         OR (
           cp.source = 'tagged_post'
           AND p.id IS NOT NULL
           AND public.content_is_student_visible('post', p.id)
         )
       )
       AND (
         p_after IS NULL
         OR (cp.created_at, cp.id) < (v_cursor_created_at, v_cursor_id)
       )
     ORDER BY cp.created_at DESC, cp.id DESC
     LIMIT (v_limit + 1)
  LOOP
    v_seen := v_seen + 1;
    IF v_seen <= v_limit THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'id', v_photo.id,
        'url', v_photo.url,
        'source', v_photo.source,
        'caption', v_photo.caption,
        'created_at', v_photo.created_at,
        'image_count', v_photo.image_count
      ));
      v_last_created_at := v_photo.created_at;
      v_last_id := v_photo.id;
    ELSE
      v_has_more := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_has_more THEN
    v_next_cursor := rtrim(replace(replace(
      encode(convert_to(jsonb_build_object(
        'collection', 'media',
        'created_at', v_last_created_at,
        'id', v_last_id
      )::text, 'UTF8'), 'base64'), '+', '-'), '/', '_'), '=');
  END IF;

  RETURN jsonb_build_object('items', v_items, 'next_cursor', v_next_cursor, 'has_more', v_has_more);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_club_posts(
  p_club_id uuid,
  p_after text DEFAULT NULL,
  p_limit integer DEFAULT 12
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit                 integer := LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
  v_cursor                jsonb;
  v_cursor_created_at     timestamptz;
  v_cursor_id             uuid;
  v_items                 jsonb := '[]'::jsonb;
  v_next_cursor           text;
  v_has_more              boolean := false;
  v_seen                  integer := 0;
  v_last_created_at       timestamptz;
  v_last_id               uuid;
  v_post                  record;
BEGIN
  IF p_after IS NOT NULL THEN
    BEGIN
      IF p_after = '' OR p_after !~ '^[A-Za-z0-9_-]+$' OR length(p_after) % 4 = 1 THEN
        RAISE EXCEPTION 'invalid_cursor';
      END IF;
      v_cursor := convert_from(
        decode(
          replace(replace(p_after, '-', '+'), '_', '/')
          || CASE length(p_after) % 4 WHEN 2 THEN '==' WHEN 3 THEN '=' ELSE '' END,
          'base64'
        ),
        'UTF8'
      )::jsonb;
      IF jsonb_typeof(v_cursor) IS DISTINCT FROM 'object'
         OR (SELECT count(*) FROM jsonb_object_keys(v_cursor)) <> 3
         OR NOT (v_cursor ? 'collection' AND v_cursor ? 'created_at' AND v_cursor ? 'id')
         OR EXISTS (
           SELECT 1 FROM jsonb_object_keys(v_cursor) AS key_name(key)
            WHERE key NOT IN ('collection', 'created_at', 'id')
         )
         OR v_cursor->>'collection' <> 'posts'
         OR jsonb_typeof(v_cursor->'created_at') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_cursor->'id') IS DISTINCT FROM 'string'
         OR (v_cursor->>'created_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
         OR (v_cursor->>'id') !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
        RAISE EXCEPTION 'invalid_cursor';
      END IF;
      v_cursor_created_at := (v_cursor->>'created_at')::timestamptz;
      v_cursor_id := (v_cursor->>'id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
    END;
  END IF;

  FOR v_post IN
    SELECT
      p.id, p.caption, p.image_url, p.created_at,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'path', pi.storage_path,
          'position', pi.position,
          'width', pi.width,
          'height', pi.height
        ) ORDER BY pi.position)
          FROM public.post_images AS pi
         WHERE pi.post_id = p.id
      ), '[]'::jsonb) AS images
      FROM public.posts AS p
      JOIN public.clubs AS c
        ON c.id = p.club_id
     WHERE p.club_id = p_club_id
       AND p.club_id IS NOT NULL
       AND p.author_kind = 'club'
       AND c.id = p_club_id
       AND c.is_active IS TRUE
       AND public.content_is_student_visible('post', p.id)
       AND (
         p_after IS NULL
         OR (p.created_at, p.id) < (v_cursor_created_at, v_cursor_id)
       )
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT (v_limit + 1)
  LOOP
    v_seen := v_seen + 1;
    IF v_seen <= v_limit THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'id', v_post.id,
        'caption', v_post.caption,
        'image_url', v_post.image_url,
        'images', v_post.images,
        'created_at', v_post.created_at
      ));
      v_last_created_at := v_post.created_at;
      v_last_id := v_post.id;
    ELSE
      v_has_more := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_has_more THEN
    v_next_cursor := rtrim(replace(replace(
      encode(convert_to(jsonb_build_object(
        'collection', 'posts',
        'created_at', v_last_created_at,
        'id', v_last_id
      )::text, 'UTF8'), 'base64'), '+', '-'), '/', '_'), '=');
  END IF;

  RETURN jsonb_build_object('items', v_items, 'next_cursor', v_next_cursor, 'has_more', v_has_more);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_club_profile(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_profile(uuid)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_club_upcoming_events(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_upcoming_events(uuid, text, integer)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_club_past_events(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_past_events(uuid, text, integer)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_club_media(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_media(uuid, text, integer)
  TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_public_club_posts(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_posts(uuid, text, integer)
  TO anon, authenticated;

DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_public_club_profile(uuid)',
    'public.get_public_club_upcoming_events(uuid,text,integer)',
    'public.get_public_club_past_events(uuid,text,integer)',
    'public.get_public_club_media(uuid,text,integer)',
    'public.get_public_club_posts(uuid,text,integer)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL
       OR NOT has_function_privilege('anon', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '125 self-check failed: % is not explicitly executable by anon and authenticated', v_signature;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.clubs', 'SELECT') THEN
    RAISE EXCEPTION '125 self-check failed: anon retains SELECT on public.clubs';
  END IF;
END;
$$;

COMMIT;
