-- BE-4 public club twin harness.
--
-- LOCAL / disposable only. The manifest runs this against a schema-only clone
-- of the local migrated stack, and the transaction below rolls back every
-- fixture, helper table, grant, and assertion artifact.

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TABLE public.t125_results (
  name text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text NOT NULL DEFAULT ''
);

CREATE OR REPLACE FUNCTION public.t125_ok(p_name text, p_ok boolean, p_detail text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.t125_results(name, ok, detail)
  VALUES (p_name, COALESCE(p_ok, false), COALESCE(p_detail, ''))
  ON CONFLICT (name) DO UPDATE
    SET ok = EXCLUDED.ok, detail = EXCLUDED.detail;
END;
$$;

CREATE OR REPLACE FUNCTION public.t125_safe_json(p_payload jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE nodes(value) AS (
    SELECT p_payload
    UNION ALL
    SELECT child.value
      FROM nodes AS n
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(n.value) = 'object' THEN n.value ELSE '{}'::jsonb END
      ) AS child
    UNION ALL
    SELECT child.value
      FROM nodes AS n
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(n.value) = 'array' THEN n.value ELSE '[]'::jsonb END
      ) AS child
  )
  SELECT NOT EXISTS (
    SELECT 1
      FROM nodes AS n
      CROSS JOIN LATERAL jsonb_object_keys(
        CASE WHEN jsonb_typeof(n.value) = 'object' THEN n.value ELSE '{}'::jsonb END
      ) AS key_name(key)
     WHERE key IN (
       'user_id', 'author_id', 'uploaded_by', 'club_id', 'specific_user_ids',
       'visibility', 'can_open', 'is_member', 'is_officer', 'officer_role',
       'is_visible', 'state', 'lifecycle_state', 'removal_reason',
       'moderation_state', 'moderation_reason', 'rsvp', 'rsvps', 'attendee',
       'attendees', 'saved', 'saved_event', 'comments', 'comment',
       'comments_count', 'likes', 'like', 'likes_count', 'interaction_count',
       'joined_at', 'role'
     )
  );
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT INSERT ON public.t125_results TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.t125_ok(text, boolean, text) TO anon, authenticated;

CREATE TABLE public.t125_calls (
  role_name text PRIMARY KEY,
  core jsonb,
  upcoming jsonb,
  past jsonb,
  media jsonb,
  posts jsonb
);
CREATE TABLE public.t125_pages (
  role_name text PRIMARY KEY,
  upcoming jsonb,
  past jsonb,
  media jsonb,
  posts jsonb
);
CREATE TABLE public.t125_second_pages (
  role_name text PRIMARY KEY,
  upcoming jsonb,
  past jsonb
);
GRANT INSERT ON public.t125_calls, public.t125_pages, public.t125_second_pages
  TO anon, authenticated;

-- ── Fixtures ──────────────────────────────────────────────────────────────
\set CREATOR '''a1250000-0000-4000-8000-000000000001'''
\set OFFICER '''a1250000-0000-4000-8000-000000000002'''
\set MEMBER '''a1250000-0000-4000-8000-000000000003'''
\set CLUB '''c1250000-0000-4000-8000-000000000001'''
\set INACTIVE_CLUB '''c1250000-0000-4000-8000-000000000002'''
\set MISSING_CLUB '''c1250000-0000-4000-8000-000000000099'''
\set BOUNDARY_EVENT '''32500000-0000-4000-8000-000000000001'''
\set MEMBERS_EVENT '''42500000-0000-4000-8000-000000000001'''
\set SPECIFIC_EVENT '''42500000-0000-4000-8000-000000000002'''
\set REMOVED_EVENT '''42500000-0000-4000-8000-000000000003'''
\set REMOVED_POST '''92500000-0000-4000-8000-000000000099'''
\set ACTIVE_TAGGED_POST '''a1250000-0000-4000-8000-000000000001'''
\set REMOVED_TAGGED_POST '''a1250000-0000-4000-8000-000000000002'''
\set PERSONAL_POST '''a1250000-0000-4000-8000-000000000003'''

INSERT INTO auth.users (id, email, raw_app_meta_data)
VALUES
  (:CREATOR, 'be4-creator@test.invalid', '{}'::jsonb),
  (:OFFICER, 'be4-officer@test.invalid', '{}'::jsonb),
  (:MEMBER, 'be4-member@test.invalid', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, username, full_name)
VALUES
  (:CREATOR, 'be4_creator', 'BE4 Creator'),
  (:OFFICER, 'be4_officer', 'BE4 Officer'),
  (:MEMBER, 'be4_member', 'BE4 Member')
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  full_name = EXCLUDED.full_name;

INSERT INTO public.clubs (
  id, name, handle, description, avatar_url, banner_url,
  meeting_day, meeting_time_start, meeting_time_end,
  meeting_location, meeting_building, meeting_room, meeting_schedule,
  is_active
)
VALUES
  (:CLUB, 'BE4 Public Club', 'be4-public-club', 'Public twin fixture',
   'avatar-be4', 'banner-be4', 'Tuesday', '09:00', '10:00',
   'Main Hall', 'Building A', '101',
   '[{"day":"Tuesday","start":"09:00:00","end":"10:00:00"}]'::jsonb, true),
  (:INACTIVE_CLUB, 'BE4 Inactive Club', 'be4-inactive-club', 'Inactive fixture',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false);

INSERT INTO public.club_members (club_id, user_id, role)
VALUES
  (:CLUB, :OFFICER, 'officer'),
  (:CLUB, :MEMBER, 'member');

INSERT INTO public.club_goals (club_id, goal_text, display_order)
VALUES
  (:CLUB, 'Build a welcoming campus community', 1),
  (:CLUB, 'Run useful public events', 2);

INSERT INTO public.club_officers (club_id, user_id, display_name, role_title, avatar_url, display_order)
VALUES
  (:CLUB, :OFFICER, 'Must not be returned', 'President', 'must-not-be-returned', 1),
  (:CLUB, NULL, 'Must not be returned', 'Treasurer', 'must-not-be-returned', 2);

-- Ten public upcoming events. IDs 1 and 2 share all ordering keys except id.
INSERT INTO public.events (
  id, club_id, created_by, title, description, event_date, start_time,
  end_time, visibility, cover_image_url, location, building, room
)
SELECT
  ('12500000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  :CLUB, :CREATOR, 'Public future ' || gs,
  'public event description',
  CASE WHEN gs <= 2 THEN CURRENT_DATE + 1 ELSE CURRENT_DATE + gs END,
  CASE WHEN gs <= 2 THEN TIME '12:00' ELSE TIME '13:00' END,
  CASE WHEN gs <= 2 THEN TIME '13:00' ELSE TIME '14:00' END,
  'everyone', 'cover-future-' || gs, 'Main Hall', 'Building A', '10' || gs
FROM generate_series(1, 10) AS gs;

-- Ten public past events. IDs 1 and 2 share all ordering keys except id.
INSERT INTO public.events (
  id, club_id, created_by, title, description, event_date, start_time,
  end_time, visibility, cover_image_url, location, building, room
)
SELECT
  ('22500000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  :CLUB, :CREATOR, 'Public past ' || gs,
  'public past description',
  CASE WHEN gs <= 2 THEN CURRENT_DATE - 1 ELSE CURRENT_DATE - gs END,
  CASE WHEN gs <= 2 THEN TIME '12:00' ELSE TIME '13:00' END,
  CASE WHEN gs <= 2 THEN TIME '13:00' ELSE TIME '14:00' END,
  'everyone', 'cover-past-' || gs, 'Main Hall', 'Building A', '20' || gs
FROM generate_series(1, 10) AS gs;

-- Exact boundary: event_end_at is today's Chicago midnight and is therefore
-- in the past partition by the contract's <= now() rule.
INSERT INTO public.events (id, club_id, created_by, title, event_date, start_time, end_time, visibility)
VALUES (:BOUNDARY_EVENT, :CLUB, :CREATOR, 'Exact boundary event', CURRENT_DATE, '00:00', '00:00', 'everyone');

INSERT INTO public.events (id, club_id, created_by, title, event_date, start_time, end_time, visibility)
VALUES
  (:MEMBERS_EVENT, :CLUB, :CREATOR, 'Members only event', CURRENT_DATE + 2, '10:00', '11:00', 'members'),
  (:SPECIFIC_EVENT, :CLUB, :CREATOR, 'Specific audience event', CURRENT_DATE + 2, '11:00', '12:00', 'specific'),
  (:REMOVED_EVENT, :CLUB, :CREATOR, 'Removed event', CURRENT_DATE - 2, '10:00', '11:00', 'everyone');

INSERT INTO public.event_activities (event_id, activity)
VALUES ('12500000-0000-4000-8000-000000000001', 'Networking');
INSERT INTO public.event_interests (event_id, interest)
VALUES ('12500000-0000-4000-8000-000000000001', 'Technology and Computer');

-- Ten official club posts keep the core and paginated posts feeds bounded.
INSERT INTO public.posts (id, author_id, club_id, author_kind, post_type, image_url, caption, created_at)
SELECT
  ('92500000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  :OFFICER, :CLUB, 'club', 'picture', 'club-post-image-' || gs,
  'Official club post ' || gs, now() - make_interval(mins => gs)
FROM generate_series(1, 10) AS gs;

INSERT INTO public.posts (id, author_id, club_id, author_kind, post_type, image_url, caption)
VALUES
  (:REMOVED_POST, :OFFICER, :CLUB, 'club', 'picture', 'removed-post-image', 'Removed official post'),
  (:ACTIVE_TAGGED_POST, :MEMBER, :CLUB, 'user', 'picture', 'tagged-user-image', 'User tagged post'),
  (:REMOVED_TAGGED_POST, :MEMBER, :CLUB, 'user', 'picture', 'removed-tagged-image', 'Removed tagged post'),
  (:PERSONAL_POST, :MEMBER, NULL, 'user', 'picture', 'personal-image', 'Personal post');

INSERT INTO public.post_images (post_id, storage_path, position, width, height)
VALUES
  ('92500000-0000-4000-8000-000000000001', 'club-post-image-1-extra', 1, 1200, 800),
  ('92500000-0000-4000-8000-000000000002', 'club-post-image-2-extra', 1, NULL, NULL);

-- Officer uploads are direct media; the generated tagged rows for the two
-- user-authored posts cover the tagged-post branch, including removed parent.
INSERT INTO public.club_photos (id, club_id, url, source, caption, is_visible, created_at)
SELECT
  ('b1250000-0000-4000-8000-' || lpad(gs::text, 12, '0'))::uuid,
  :CLUB, 'officer-upload-' || gs, 'officer_upload', 'Officer upload ' || gs,
  true, now() - make_interval(mins => gs + 30)
FROM generate_series(1, 10) AS gs;

INSERT INTO public.club_photos (id, club_id, url, source, caption, is_visible)
VALUES
  ('b1250000-0000-4000-8000-000000000099', :CLUB, 'hidden-photo', 'officer_upload', 'Hidden', false),
  ('b1250000-0000-4000-8000-000000000098', :CLUB, 'dangling-tagged-photo', 'tagged_post', 'Dangling', true);

INSERT INTO public.content_lifecycle (
  entity_type, entity_id, state, removed_at, removed_by
)
VALUES
  ('event', :REMOVED_EVENT, 'removed', now(), :CREATOR),
  ('post', :REMOVED_POST, 'removed', now(), :CREATOR),
  ('post', :REMOVED_TAGGED_POST, 'removed', now(), :CREATOR);

-- ── Both client roles must receive exactly the same public subset ─────────
SET ROLE anon;
INSERT INTO public.t125_calls(role_name, core, upcoming, past, media, posts)
SELECT 'anon',
  public.get_public_club_profile(:CLUB),
  public.get_public_club_upcoming_events(:CLUB),
  public.get_public_club_past_events(:CLUB),
  public.get_public_club_media(:CLUB),
  public.get_public_club_posts(:CLUB);
INSERT INTO public.t125_pages(role_name, upcoming, past, media, posts)
SELECT 'anon',
  public.get_public_club_upcoming_events(:CLUB, NULL, 1),
  public.get_public_club_past_events(:CLUB, NULL, 1),
  public.get_public_club_media(:CLUB, NULL, 1),
  public.get_public_club_posts(:CLUB, NULL, 1);
INSERT INTO public.t125_second_pages(role_name, upcoming, past)
SELECT 'anon',
  public.get_public_club_upcoming_events(:CLUB, (SELECT upcoming->>'next_cursor' FROM public.t125_pages WHERE role_name = 'anon'), 1),
  public.get_public_club_past_events(:CLUB, (SELECT past->>'next_cursor' FROM public.t125_pages WHERE role_name = 'anon'), 1);
RESET ROLE;

SET ROLE authenticated;
INSERT INTO public.t125_calls(role_name, core, upcoming, past, media, posts)
SELECT 'authenticated',
  public.get_public_club_profile(:CLUB),
  public.get_public_club_upcoming_events(:CLUB),
  public.get_public_club_past_events(:CLUB),
  public.get_public_club_media(:CLUB),
  public.get_public_club_posts(:CLUB);
INSERT INTO public.t125_pages(role_name, upcoming, past, media, posts)
SELECT 'authenticated',
  public.get_public_club_upcoming_events(:CLUB, NULL, 1),
  public.get_public_club_past_events(:CLUB, NULL, 1),
  public.get_public_club_media(:CLUB, NULL, 1),
  public.get_public_club_posts(:CLUB, NULL, 1);
RESET ROLE;

-- ── Runtime assertions ────────────────────────────────────────────────────
SELECT public.t125_ok('authenticated receives same anon-safe RPC subset',
  a.core = b.core AND a.upcoming = b.upcoming AND a.past = b.past
  AND a.media = b.media AND a.posts = b.posts,
  'anon and authenticated payloads must be byte-for-byte equal JSON');

SELECT public.t125_ok('active core has exact top-level contract keys',
  (SELECT count(*) = 20
     FROM public.t125_calls AS c
     CROSS JOIN LATERAL jsonb_object_keys(c.core) AS key_name(key)
    WHERE c.role_name = 'anon')
  AND (SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(core) AS key_name(key)
     WHERE role_name = 'anon'
       AND key NOT IN (
         'id','name','handle','description','avatar_url','banner_url',
         'meeting_day','meeting_time_start','meeting_time_end','meeting_location',
         'meeting_building','meeting_room','meeting_schedule','member_count',
         'goals','officers','upcoming_events','past_events','media','posts'
       )
  ) FROM public.t125_calls WHERE role_name = 'anon'),
  'core object is the declared 20-key envelope');

SELECT public.t125_ok('inactive and missing clubs return NULL core',
  public.get_public_club_profile(:INACTIVE_CLUB) IS NULL
  AND public.get_public_club_profile(:MISSING_CLUB) IS NULL);

SELECT public.t125_ok('inactive and missing clubs return empty envelopes',
  public.get_public_club_upcoming_events(:INACTIVE_CLUB) = '{"items": [], "next_cursor": null, "has_more": false}'::jsonb
  AND public.get_public_club_past_events(:MISSING_CLUB) = '{"items": [], "next_cursor": null, "has_more": false}'::jsonb
  AND public.get_public_club_media(:INACTIVE_CLUB) = '{"items": [], "next_cursor": null, "has_more": false}'::jsonb
  AND public.get_public_club_posts(:MISSING_CLUB) = '{"items": [], "next_cursor": null, "has_more": false}'::jsonb);

SELECT public.t125_ok('all core feeds use N=8 plus one probe',
  jsonb_array_length(core->'upcoming_events'->'items') = 8
  AND (core->'upcoming_events'->>'has_more')::boolean
  AND jsonb_array_length(core->'past_events'->'items') = 8
  AND (core->'past_events'->>'has_more')::boolean
  AND jsonb_array_length(core->'media'->'items') = 8
  AND (core->'media'->>'has_more')::boolean
  AND jsonb_array_length(core->'posts'->'items') = 8
  AND (core->'posts'->>'has_more')::boolean,
  'core feed arrays are bounded and has_more comes from the ninth row')
FROM public.t125_calls WHERE role_name = 'anon';

SELECT public.t125_ok('pagination envelopes clamp and bound results',
  jsonb_array_length(upcoming->'items') = 1
  AND jsonb_array_length(past->'items') = 1
  AND jsonb_array_length(media->'items') = 1
  AND jsonb_array_length(posts->'items') = 1
  AND (upcoming->>'next_cursor') IS NOT NULL
  AND (past->>'next_cursor') IS NOT NULL,
  'p_limit=1 yields one item and a cursor when the probe finds another')
FROM public.t125_pages WHERE role_name = 'anon';

SELECT public.t125_ok('keyset pages do not repeat the boundary row',
  (SELECT (upcoming->'items'->0->>'id') <> (SELECT upcoming->'items'->0->>'id' FROM public.t125_pages WHERE role_name = 'anon')
     FROM public.t125_second_pages WHERE role_name = 'anon')
  AND (SELECT (past->'items'->0->>'id') <> (SELECT past->'items'->0->>'id' FROM public.t125_pages WHERE role_name = 'anon')
     FROM public.t125_second_pages WHERE role_name = 'anon'));

SELECT public.t125_ok('event feeds are partitioned and lifecycle filtered',
  (SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(core->'upcoming_events'->'items') x
     WHERE x->>'id' IN (:BOUNDARY_EVENT, :REMOVED_EVENT, :MEMBERS_EVENT, :SPECIFIC_EVENT)
  ) FROM public.t125_calls WHERE role_name = 'anon')
  AND (SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(core->'past_events'->'items') x
     WHERE x->>'id' = :BOUNDARY_EVENT
  ) FROM public.t125_calls WHERE role_name = 'anon')
  AND (SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(core->'past_events'->'items') x
     WHERE x->>'id' LIKE '12500000-%'
        OR x->>'id' IN (:MEMBERS_EVENT, :SPECIFIC_EVENT, :REMOVED_EVENT)
  ) FROM public.t125_calls WHERE role_name = 'anon'));

SELECT public.t125_ok('event tie-break ordering holds in both directions',
  (SELECT NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(core->'upcoming_events'->'items') WITH ORDINALITY a(value, ord)
      JOIN jsonb_array_elements(core->'upcoming_events'->'items') WITH ORDINALITY b(value, ord)
        ON b.ord = a.ord + 1
     WHERE (a.value->>'event_date', a.value->>'start_time', a.value->>'id')
           >= (b.value->>'event_date', b.value->>'start_time', b.value->>'id')
  ) FROM public.t125_calls WHERE role_name = 'anon')
  AND (SELECT NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(core->'past_events'->'items') WITH ORDINALITY a(value, ord)
      JOIN jsonb_array_elements(core->'past_events'->'items') WITH ORDINALITY b(value, ord)
        ON b.ord = a.ord + 1
     WHERE (a.value->>'event_date', a.value->>'start_time', a.value->>'id')
           <= (b.value->>'event_date', b.value->>'start_time', b.value->>'id')
  ) FROM public.t125_calls WHERE role_name = 'anon'));

SELECT public.t125_ok('media filter excludes hidden dangling and removed photos',
  (SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(media->'items') x
     WHERE x->>'url' IN ('hidden-photo', 'dangling-tagged-photo', 'removed-tagged-image')
  ) FROM public.t125_calls WHERE role_name = 'anon')
  AND (SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(media->'items') x
     WHERE x->>'source' = 'officer_upload'
  ) FROM public.t125_calls WHERE role_name = 'anon'));

SELECT public.t125_ok('posts filter to active official club posts',
  (SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(posts->'items') x
     WHERE x->>'caption' = 'Official club post 1'
  ) FROM public.t125_calls WHERE role_name = 'anon')
  AND (SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(posts->'items') x
     WHERE x->>'caption' IN ('Removed official post', 'User tagged post', 'Removed tagged post', 'Personal post')
  ) FROM public.t125_calls WHERE role_name = 'anon'));

SELECT public.t125_ok('post images and officer shape are explicit safe subsets',
  (SELECT (officers->0) = '{"display_order": 1, "role_title": "President"}'::jsonb
     AND NOT (officers::text LIKE '%display_name%' OR officers::text LIKE '%user_id%' OR officers::text LIKE '%avatar_url%')
     AND (posts->'items'->0 ? 'images')
     AND ((posts->'items'->0->'images'->0) ? 'path')
     AND ((posts->'items'->0->'images'->0) ? 'position')
     AND ((posts->'items'->0->'images'->0) ? 'width')
     AND ((posts->'items'->0->'images'->0) ? 'height')
   FROM public.t125_calls WHERE role_name = 'anon'));

SELECT public.t125_ok('no forbidden key appears anywhere in either caller payload',
  a.safe_core AND a.safe_upcoming AND a.safe_past AND a.safe_media AND a.safe_posts
  AND b.safe_core AND b.safe_upcoming AND b.safe_past AND b.safe_media AND b.safe_posts
  AND a.payload_text NOT LIKE '%a1250000-0000-4000-8000-000000000001%'
  AND a.payload_text NOT LIKE '%a1250000-0000-4000-8000-000000000002%'
  AND a.payload_text NOT LIKE '%a1250000-0000-4000-8000-000000000003%'
  AND b.payload_text NOT LIKE '%a1250000-0000-4000-8000-000000000001%'
  AND b.payload_text NOT LIKE '%a1250000-0000-4000-8000-000000000002%'
  AND b.payload_text NOT LIKE '%a1250000-0000-4000-8000-000000000003%')
FROM (
  SELECT
    role_name,
    concat_ws(' ', core::text, upcoming::text, past::text, media::text, posts::text) AS payload_text,
    public.t125_safe_json(core) AS safe_core,
    public.t125_safe_json(upcoming) AS safe_upcoming,
    public.t125_safe_json(past) AS safe_past,
    public.t125_safe_json(media) AS safe_media,
    public.t125_safe_json(posts) AS safe_posts
  FROM public.t125_calls
) AS a
JOIN (
  SELECT
    role_name,
    concat_ws(' ', core::text, upcoming::text, past::text, media::text, posts::text) AS payload_text,
    public.t125_safe_json(core) AS safe_core,
    public.t125_safe_json(upcoming) AS safe_upcoming,
    public.t125_safe_json(past) AS safe_past,
    public.t125_safe_json(media) AS safe_media,
    public.t125_safe_json(posts) AS safe_posts
  FROM public.t125_calls
) AS b ON a.role_name = 'anon' AND b.role_name = 'authenticated';

-- Wrong collection markers and malformed cursors must raise SQLSTATE 22023.
DO $$
DECLARE
  v_past_cursor text;
  v_upcoming_cursor text;
  v_raised boolean;
BEGIN
  SELECT past->>'next_cursor', upcoming->>'next_cursor'
    INTO v_past_cursor, v_upcoming_cursor
    FROM public.t125_pages WHERE role_name = 'anon';

  v_raised := false;
  BEGIN
    PERFORM public.get_public_club_upcoming_events(:CLUB, v_past_cursor, 1);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_raised := true;
  END;
  PERFORM public.t125_ok('past cursor rejected by upcoming RPC', v_raised, 'expected invalid_cursor / 22023');

  v_raised := false;
  BEGIN
    PERFORM public.get_public_club_past_events(:CLUB, v_upcoming_cursor, 1);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_raised := true;
  END;
  PERFORM public.t125_ok('upcoming cursor rejected by past RPC', v_raised, 'expected invalid_cursor / 22023');

  v_raised := false;
  BEGIN
    PERFORM public.get_public_club_media(:CLUB, 'not-valid', 1);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_raised := true;
  END;
  PERFORM public.t125_ok('malformed cursor rejected with invalid_cursor', v_raised, 'expected SQLSTATE 22023');
END;
$$;

-- ── Privilege-negative assertions ─────────────────────────────────────────
SELECT public.t125_ok('anon has no SELECT on public-twin base tables', NOT EXISTS (
  SELECT 1
    FROM unnest(ARRAY[
      'clubs','club_goals','club_members','club_officers','club_photos','events',
      'posts','post_images','event_rsvps','saved_events','profiles','user_privacy',
      'post_comments','post_likes','content_lifecycle'
    ]) AS table_name
   WHERE has_table_privilege('anon', 'public.' || table_name, 'SELECT')
));

SELECT public.t125_ok('no base-table policy targets anon', NOT EXISTS (
  SELECT 1 FROM pg_policies
   WHERE schemaname = 'public' AND 'anon' = ANY(roles)
));

WITH expected(signature) AS (
  VALUES
    ('public.get_public_club_profile(uuid)'),
    ('public.get_public_club_upcoming_events(uuid,text,integer)'),
    ('public.get_public_club_past_events(uuid,text,integer)'),
    ('public.get_public_club_media(uuid,text,integer)'),
    ('public.get_public_club_posts(uuid,text,integer)')
)
SELECT public.t125_ok('five RPCs are execute-able only through explicit client grants',
  (SELECT bool_and(has_function_privilege('anon', signature, 'EXECUTE')
                  AND has_function_privilege('authenticated', signature, 'EXECUTE')
                  AND NOT has_function_privilege('service_role', signature, 'EXECUTE')) FROM expected)
  AND NOT EXISTS (
    SELECT 1
      FROM expected AS e
      JOIN pg_proc AS p ON p.oid = to_regprocedure(e.signature)
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  );

-- ── SECURITY DEFINER catalog classification ───────────────────────────────
CREATE TABLE public.t125_secdef_classification (
  signature text PRIMARY KEY,
  category text NOT NULL,
  least_privilege_justification text NOT NULL
);
INSERT INTO public.t125_secdef_classification VALUES
  ('public.get_public_club_profile(uuid)', 'public-read', 'Single active-club whitelist; no base-table client grant; returns only anonymous-safe profile, goals, role titles, and bounded feeds.'),
  ('public.get_public_club_upcoming_events(uuid,text,integer)', 'public-read', 'Keyset-paginated everyone-visible upcoming event whitelist with lifecycle filtering and no viewer state.'),
  ('public.get_public_club_past_events(uuid,text,integer)', 'public-read', 'Keyset-paginated everyone-visible past event whitelist with lifecycle filtering and no viewer state.'),
  ('public.get_public_club_media(uuid,text,integer)', 'public-read', 'Keyset-paginated visible club-photo whitelist with active tagged-post lifecycle checks.'),
  ('public.get_public_club_posts(uuid,text,integer)', 'public-read', 'Keyset-paginated official club-authored post whitelist with explicit image fields and lifecycle checks.');

WITH expected(signature) AS (
  SELECT signature FROM public.t125_secdef_classification
)
SELECT public.t125_ok('five new signatures are classified public-read with written justification',
  (SELECT count(*) = 5 AND bool_and(category = 'public-read' AND length(least_privilege_justification) > 20)
     FROM public.t125_secdef_classification)
  AND (SELECT bool_and(
      p.prosecdef
      AND p.provolatile = 's'
      AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
      AND position($needle$SET search_path = ''$needle$ IN pg_get_functiondef(p.oid)) > 0
    )
    FROM expected AS e
    JOIN pg_proc AS p ON p.oid = to_regprocedure(e.signature)));

SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, detail
  FROM public.t125_results
 ORDER BY name;

DO $$
DECLARE
  v_failures integer;
BEGIN
  SELECT count(*) INTO v_failures FROM public.t125_results WHERE NOT ok;
  IF v_failures > 0 THEN
    RAISE EXCEPTION '125 public club twin harness failed: % assertion(s)', v_failures;
  END IF;
END;
$$;

ROLLBACK;
