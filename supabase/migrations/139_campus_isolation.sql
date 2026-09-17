-- ============================================================================
-- We Glue - database campus isolation
-- Migration: 139_campus_isolation.sql
--
-- Campus is an authorization boundary, not a client-side filter.  The caller
-- campus is always read from auth.uid() -> profiles.university_id.  NULL club
-- campus values remain launch-campus rows for legacy single-campus data; they
-- are never treated as a wildcard for a second campus.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;
-- Anonymous public-club media needs only the launch-campus single-mode check;
-- every other private function remains non-executable by anon.
GRANT USAGE ON SCHEMA private TO anon;

-- --------------------------------------------------------------------------
-- One caller-campus authority, plus row-parent predicates.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.current_campus_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.university_id
    FROM public.profiles AS p
   WHERE p.id = (SELECT auth.uid())
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.current_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM auth.users AS u
     WHERE u.id = (SELECT auth.uid())
       AND public.is_platform_admin_auth(u.raw_app_meta_data)
  );
$$;

CREATE OR REPLACE FUNCTION private.campus_matches(p_university_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR (
        p_university_id IS NOT NULL
        AND p_university_id = private.current_campus_id()
      );
$$;

-- The row-local form is used on clubs themselves.  It deliberately does not
-- re-read clubs by id, which keeps INSERT ... RETURNING safe for new rows.
CREATE OR REPLACE FUNCTION private.club_row_is_current_campus(p_university_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR (
        private.current_campus_id() IS NOT NULL
        AND COALESCE(
          p_university_id,
          (SELECT ac.launch_university_id FROM public.app_config AS ac LIMIT 1)
        ) = private.current_campus_id()
      );
$$;

CREATE OR REPLACE FUNCTION private.user_is_current_campus(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR EXISTS (
        SELECT 1
          FROM public.profiles AS p
         WHERE p.id = p_user_id
           AND p.university_id IS NOT NULL
           AND p.university_id = private.current_campus_id()
      );
$$;

-- A NULL clubs.university_id is legacy launch-campus data, not a global row.
CREATE OR REPLACE FUNCTION private.club_is_current_campus(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR EXISTS (
        SELECT 1
          FROM public.clubs AS c
         WHERE c.id = p_club_id
           AND COALESCE(
                 c.university_id,
                 (SELECT ac.launch_university_id FROM public.app_config AS ac LIMIT 1)
               ) = private.current_campus_id()
      );
$$;

CREATE OR REPLACE FUNCTION private.event_is_current_campus(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR EXISTS (
        SELECT 1
          FROM public.events AS e
         WHERE e.id = p_event_id
           AND private.club_is_current_campus(e.club_id)
      );
$$;

CREATE OR REPLACE FUNCTION private.post_row_is_current_campus(
  p_author_id uuid,
  p_club_id uuid,
  p_linked_event_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
     OR (
       CASE
         WHEN p_club_id IS NOT NULL THEN private.club_is_current_campus(p_club_id)
         ELSE private.user_is_current_campus(p_author_id)
       END
       AND (
         p_linked_event_id IS NULL
         OR private.event_is_current_campus(p_linked_event_id)
       )
     );
$$;

CREATE OR REPLACE FUNCTION private.post_is_current_campus(p_post_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR EXISTS (
        SELECT 1
          FROM public.posts AS p
         WHERE p.id = p_post_id
           AND private.post_row_is_current_campus(
                 p.author_id, p.club_id, p.linked_event_id
               )
      );
$$;

-- A conversation without club_id is an existing direct/custom group chat and
-- intentionally remains cross-campus. Club-owned conversations are scoped.
CREATE OR REPLACE FUNCTION private.conversation_is_current_campus(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR EXISTS (
        SELECT 1
          FROM public.conversations AS c
         WHERE c.id = p_conversation_id
           AND (
             c.club_id IS NULL
             OR private.club_is_current_campus(c.club_id)
           )
      );
$$;

CREATE OR REPLACE FUNCTION private.message_is_current_campus(p_message_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR EXISTS (
        SELECT 1
          FROM public.messages AS m
         WHERE m.id = p_message_id
           AND private.conversation_is_current_campus(m.conversation_id)
      );
$$;

CREATE OR REPLACE FUNCTION private.poll_is_current_campus(p_poll_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR EXISTS (
        SELECT 1
          FROM public.polls AS p
          JOIN public.messages AS m ON m.id = p.message_id
         WHERE p.id = p_poll_id
           AND private.conversation_is_current_campus(m.conversation_id)
      );
$$;

CREATE OR REPLACE FUNCTION private.channel_is_current_campus(p_channel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR EXISTS (
        SELECT 1
          FROM public.conversation_channels AS ch
         WHERE ch.id = p_channel_id
           AND private.conversation_is_current_campus(ch.conversation_id)
      );
$$;

CREATE OR REPLACE FUNCTION private.conversation_or_club_is_current_campus(
  p_conversation_id uuid,
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR (
        (p_club_id IS NULL OR private.club_is_current_campus(p_club_id))
        AND private.conversation_is_current_campus(p_conversation_id)
      );
$$;

CREATE OR REPLACE FUNCTION private.notification_is_current_campus(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.user_is_current_campus(p_user_id);
$$;

CREATE OR REPLACE FUNCTION private.report_is_current_campus(
  p_reporter_id uuid,
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR CASE
           WHEN p_club_id IS NOT NULL THEN private.club_is_current_campus(p_club_id)
           ELSE private.user_is_current_campus(p_reporter_id)
         END;
$$;

CREATE OR REPLACE FUNCTION private.batch_is_current_campus(
  p_user_id uuid,
  p_club_ids uuid[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.user_is_current_campus(p_user_id)
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(COALESCE(p_club_ids, ARRAY[]::uuid[])) AS ids(club_id)
        WHERE NOT private.club_is_current_campus(ids.club_id)
     );
$$;

-- Public club pages have no campus parameter. They remain available to anon
-- only in the legacy single-campus mode, where the launch campus is the sole
-- possible campus. Once multi-campus mode is active, an anonymous caller has
-- no campus and receives no scoped club page.
CREATE OR REPLACE FUNCTION private.caller_can_access_club(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.current_is_platform_admin()
      OR private.club_is_current_campus(p_club_id)
      OR (
        (SELECT auth.uid()) IS NULL
        AND COALESCE(
          (SELECT ac.single_campus_mode FROM public.app_config AS ac LIMIT 1),
          false
        )
        AND EXISTS (
          SELECT 1
            FROM public.clubs AS c
            CROSS JOIN LATERAL (
              SELECT ac.launch_university_id
                FROM public.app_config AS ac
               LIMIT 1
            ) AS cfg
           WHERE c.id = p_club_id
             AND COALESCE(c.university_id, cfg.launch_university_id)
                 = cfg.launch_university_id
        )
      );
$$;

REVOKE ALL ON FUNCTION private.current_campus_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.current_is_platform_admin() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.campus_matches(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.club_row_is_current_campus(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.user_is_current_campus(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.club_is_current_campus(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.event_is_current_campus(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.post_row_is_current_campus(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.post_is_current_campus(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.conversation_is_current_campus(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.message_is_current_campus(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.poll_is_current_campus(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.channel_is_current_campus(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.conversation_or_club_is_current_campus(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.notification_is_current_campus(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_is_current_campus(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.batch_is_current_campus(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.caller_can_access_club(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_campus_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.campus_matches(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.club_row_is_current_campus(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_is_current_campus(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.club_is_current_campus(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.event_is_current_campus(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.post_row_is_current_campus(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.post_is_current_campus(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.conversation_is_current_campus(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.message_is_current_campus(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.poll_is_current_campus(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.channel_is_current_campus(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.conversation_or_club_is_current_campus(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.notification_is_current_campus(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.report_is_current_campus(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.batch_is_current_campus(uuid, uuid[]) TO authenticated;

-- Existing authorization helpers are used by both direct RLS and SECURITY
-- DEFINER RPCs.  Making them campus-aware closes the RPC paths that already
-- require membership/officer status without changing their product meaning.
CREATE OR REPLACE FUNCTION public.is_club_member(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT private.club_is_current_campus(p_club_id)
     AND EXISTS (
       SELECT 1 FROM public.club_members AS cm
        WHERE cm.club_id = p_club_id
          AND cm.user_id = (SELECT auth.uid())
     );
$$;

CREATE OR REPLACE FUNCTION public.is_club_officer(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT private.club_is_current_campus(p_club_id)
     AND EXISTS (
       SELECT 1 FROM public.club_members AS cm
        WHERE cm.club_id = p_club_id
          AND cm.user_id = (SELECT auth.uid())
          AND cm.role = 'officer'
     );
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conv_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT private.conversation_is_current_campus(p_conv_id)
     AND EXISTS (
       SELECT 1 FROM public.conversation_participants AS cp
        WHERE cp.conversation_id = p_conv_id
          AND cp.user_id = (SELECT auth.uid())
     );
$$;

-- --------------------------------------------------------------------------
-- Direct-table campus boundary.  Restrictive policies compose with every
-- existing product policy, so privacy, blocks, lifecycle, role and audience
-- rules remain unchanged while every operation is intersected with campus.
-- --------------------------------------------------------------------------

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('profiles',                    'private.user_is_current_campus(id)'),
      ('user_interests',              'private.user_is_current_campus(user_id)'),
      ('user_activities',              'private.user_is_current_campus(user_id)'),
      ('user_privacy',                'private.user_is_current_campus(user_id)'),
      ('follows',                     'private.user_is_current_campus(follower_id) AND private.user_is_current_campus(following_id)'),
      ('clubs',                       'private.club_row_is_current_campus(university_id)'),
      ('club_goals',                  'private.club_is_current_campus(club_id)'),
      ('club_interests',              'private.club_is_current_campus(club_id)'),
      ('club_members',                'private.club_is_current_campus(club_id) AND private.user_is_current_campus(user_id)'),
      ('club_officers',               'private.club_is_current_campus(club_id) AND (user_id IS NULL OR private.user_is_current_campus(user_id))'),
      ('club_photos',                 'private.club_is_current_campus(club_id)'),
      ('club_categories',             'private.club_is_current_campus(club_id)'),
      ('events',                      'private.club_is_current_campus(club_id) AND private.user_is_current_campus(created_by)'),
      ('event_interests',             'private.event_is_current_campus(event_id)'),
      ('event_activities',            'private.event_is_current_campus(event_id)'),
      ('event_images',                'private.event_is_current_campus(event_id)'),
      ('event_rsvps',                 'private.event_is_current_campus(event_id) AND private.user_is_current_campus(user_id)'),
      ('saved_events',                'private.event_is_current_campus(event_id) AND private.user_is_current_campus(user_id)'),
      ('posts',                       'private.post_row_is_current_campus(author_id, club_id, linked_event_id)'),
      ('post_comments',               'private.post_is_current_campus(post_id) AND private.user_is_current_campus(user_id)'),
      ('post_likes',                  'private.post_is_current_campus(post_id) AND private.user_is_current_campus(user_id)'),
      ('post_club_tags',              'private.post_is_current_campus(post_id) AND private.club_is_current_campus(club_id)'),
      ('post_images',                 'private.post_is_current_campus(post_id)'),
      -- Row-local club_id is required here: re-reading a just-inserted
      -- conversation by id would fail INSERT ... RETURNING under the same
      -- snapshot (the events trap from the authorization audit).
      ('conversations',               'private.current_is_platform_admin() OR club_id IS NULL OR private.club_is_current_campus(club_id)'),
      ('conversation_participants',   'private.conversation_is_current_campus(conversation_id)'),
      ('conversation_channels',       'private.conversation_is_current_campus(conversation_id)'),
      ('channel_posters',             'private.channel_is_current_campus(channel_id)'),
      ('channel_mutes',               'private.channel_is_current_campus(channel_id)'),
      ('channel_reads',               'private.channel_is_current_campus(channel_id)'),
      ('messages',                    'private.conversation_is_current_campus(conversation_id)'),
      ('message_hides',               'private.message_is_current_campus(message_id)'),
      ('message_reactions',           'private.message_is_current_campus(message_id)'),
      ('message_attachments',         'private.message_is_current_campus(message_id)'),
      ('polls',                       'private.message_is_current_campus(message_id)'),
      ('poll_options',                'private.poll_is_current_campus(poll_id)'),
      ('poll_votes',                  'private.poll_is_current_campus(poll_id)'),
      ('notifications',               'private.notification_is_current_campus(user_id)'),
      ('notification_actors',         'EXISTS (SELECT 1 FROM public.notifications AS n WHERE n.id = notification_id AND private.notification_is_current_campus(n.user_id))'),
      ('notification_preferences',    'private.user_is_current_campus(user_id)'),
      ('push_tokens',                 'private.user_is_current_campus(user_id)'),
      ('club_recommendation_batches','private.batch_is_current_campus(user_id, club_ids)'),
      ('reports',                     'private.report_is_current_campus(reporter_id, club_id)'),
      ('user_blocks',                 'private.user_is_current_campus(blocker_id) AND private.user_is_current_campus(blocked_id)'),
      ('chat_invitations',            'private.conversation_or_club_is_current_campus(conversation_id, club_id)')
    ) AS x(table_name, predicate)
  LOOP
    IF to_regclass('public.' || r.table_name) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS campus_isolation ON public.%I', r.table_name);
    EXECUTE format(
      'CREATE POLICY campus_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      r.table_name, r.predicate, r.predicate
    );
    -- A few legacy tables were granted to anon for the single-campus app.
    -- Pre-auth uses the reviewed RPCs instead; direct rows fail closed.
    EXECUTE format('DROP POLICY IF EXISTS campus_isolation_anon_denied ON public.%I', r.table_name);
    EXECUTE format(
      'CREATE POLICY campus_isolation_anon_denied ON public.%I AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false)',
      r.table_name
    );
  END LOOP;
END;
$$;

-- The universities table is policy/configuration, not a public directory.
-- The active picker is list_active_campuses(), whose SECURITY DEFINER body is
-- the only anonymous campus surface.  Authenticated students can read only
-- their own university; platform-admin and service-role reads remain intact.
DROP POLICY IF EXISTS "universities: read all" ON public.universities;
DROP POLICY IF EXISTS campus_isolation ON public.universities;
DROP POLICY IF EXISTS campus_isolation_anon_denied ON public.universities;
CREATE POLICY "universities: authenticated can read through campus boundary"
  ON public.universities FOR SELECT TO authenticated
  USING (true);
CREATE POLICY campus_isolation ON public.universities AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING (private.current_is_platform_admin() OR id = private.current_campus_id());
CREATE POLICY campus_isolation_anon_denied ON public.universities AS RESTRICTIVE FOR SELECT
  TO anon
  USING (false);

-- --------------------------------------------------------------------------
-- Storage paths that carry a club/conversation identifier.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.storage_club_is_current_campus(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN (storage.foldername(p_name))[1] ~ '^[0-9a-fA-F-]{36}$'
      THEN private.club_is_current_campus((storage.foldername(p_name))[1]::uuid)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION private.storage_anon_club_is_launch_campus(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT ac.single_campus_mode FROM public.app_config AS ac LIMIT 1),
    false
  )
  AND CASE
    WHEN (storage.foldername(p_name))[1] ~ '^[0-9a-fA-F-]{36}$' THEN EXISTS (
      SELECT 1
        FROM public.clubs AS c
        CROSS JOIN LATERAL (
          SELECT ac.launch_university_id
            FROM public.app_config AS ac
           LIMIT 1
        ) AS cfg
       WHERE c.id = (storage.foldername(p_name))[1]::uuid
         AND COALESCE(c.university_id, cfg.launch_university_id)
             = cfg.launch_university_id
    )
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION private.storage_club_is_current_campus(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.storage_anon_club_is_launch_campus(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.storage_club_is_current_campus(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.storage_anon_club_is_launch_campus(text) TO anon;

DROP POLICY IF EXISTS campus_storage_club ON storage.objects;
CREATE POLICY campus_storage_club ON storage.objects AS RESTRICTIVE FOR ALL
  TO authenticated
  USING (
    bucket_id NOT IN ('club-covers', 'club-avatars', 'club-photos')
    OR private.storage_club_is_current_campus(name)
  )
  WITH CHECK (
    bucket_id NOT IN ('club-covers', 'club-avatars', 'club-photos')
    OR private.storage_club_is_current_campus(name)
  );

DROP POLICY IF EXISTS campus_storage_club_anon_denied ON storage.objects;
CREATE POLICY campus_storage_club_anon_denied ON storage.objects AS RESTRICTIVE FOR ALL
  TO anon
  USING (
    bucket_id NOT IN ('club-covers', 'club-avatars', 'club-photos')
    OR private.storage_anon_club_is_launch_campus(name)
  )
  WITH CHECK (
    bucket_id NOT IN ('club-covers', 'club-avatars', 'club-photos')
    OR private.storage_anon_club_is_launch_campus(name)
  );

-- --------------------------------------------------------------------------
-- SECURITY DEFINER discovery/search/public-club paths.
-- Existing bodies are retained under private migration-local names and the
-- public signatures become campus-filtering wrappers. This avoids duplicating
-- the mature block/privacy/lifecycle logic in those RPCs.
-- --------------------------------------------------------------------------

ALTER FUNCTION public.search_discovery(uuid, text)
  RENAME TO search_discovery_unscoped_139;
CREATE FUNCTION public.search_discovery(p_user_id uuid, p_query text)
RETURNS TABLE(result_type text, id uuid, name text, avatar_url text, sub text, is_member boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.*
    FROM public.search_discovery_unscoped_139(p_user_id, p_query) AS s
   WHERE private.current_campus_id() IS NOT NULL
     AND (
       (s.result_type = 'person' AND private.user_is_current_campus(s.id))
       OR (s.result_type = 'club' AND private.club_is_current_campus(s.id))
     );
$$;

ALTER FUNCTION public.get_discovery_people(uuid)
  RENAME TO get_discovery_people_unscoped_139;
CREATE FUNCTION public.get_discovery_people(p_user_id uuid)
RETURNS TABLE(user_id uuid, username text, full_name text, avatar_url text, club_name text, club_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.*
    FROM public.get_discovery_people_unscoped_139(p_user_id) AS d
   WHERE private.current_campus_id() IS NOT NULL
     AND private.user_is_current_campus(d.user_id)
     AND (d.club_id IS NULL OR private.club_is_current_campus(d.club_id));
$$;

ALTER FUNCTION public.get_discovery_clubs(uuid, text, integer, integer)
  RENAME TO get_discovery_clubs_unscoped_139;
CREATE FUNCTION public.get_discovery_clubs(
  p_user_id uuid, p_category text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, name text, avatar_url text, cover_image_url text, member_count integer,
              is_member boolean, categories text[], meeting_day text, meeting_time_start text,
              meeting_time_end text, meeting_building text, meeting_room text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.*
    FROM public.get_discovery_clubs_unscoped_139(p_user_id, p_category, p_limit, p_offset) AS d
   WHERE private.current_campus_id() IS NOT NULL
     AND private.club_is_current_campus(d.id);
$$;

ALTER FUNCTION public.get_phone_discovery_clubs(uuid, text, integer, integer)
  RENAME TO get_phone_discovery_clubs_unscoped_139;
CREATE FUNCTION public.get_phone_discovery_clubs(
  p_user_id uuid, p_interest_slug text DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, name text, avatar_url text, cover_image_url text, member_count integer,
              is_member boolean, categories text[], meeting_day text, meeting_time_start text,
              meeting_time_end text, meeting_building text, meeting_room text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.*
    FROM public.get_phone_discovery_clubs_unscoped_139(p_user_id, p_interest_slug, p_limit, p_offset) AS d
   WHERE private.current_campus_id() IS NOT NULL
     AND private.club_is_current_campus(d.id);
$$;

ALTER FUNCTION public.get_discovery_events(uuid, integer, integer)
  RENAME TO get_discovery_events_unscoped_139;
CREATE FUNCTION public.get_discovery_events(
  p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, title text, emoji text, event_date date, start_time time without time zone,
              end_time time without time zone, location text, cover_image_url text, club_id uuid,
              club_name text, club_avatar_url text, member_count integer, is_saved boolean,
              user_rsvp_status text, match_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.*
    FROM public.get_discovery_events_unscoped_139(p_user_id, p_limit, p_offset) AS d
   WHERE private.current_campus_id() IS NOT NULL
     AND private.club_is_current_campus(d.club_id);
$$;

-- The public-club twin is intentionally still usable by anon in single-campus
-- mode, but a direct UUID cannot select a campus once multi-campus is active.
ALTER FUNCTION public.get_public_club_profile(uuid)
  RENAME TO get_public_club_profile_unscoped_139;
CREATE FUNCTION public.get_public_club_profile(p_club_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN private.caller_can_access_club(p_club_id)
              THEN public.get_public_club_profile_unscoped_139(p_club_id)
              ELSE NULL::jsonb END;
$$;

ALTER FUNCTION public.get_public_club_upcoming_events(uuid, text, integer)
  RENAME TO get_public_club_upcoming_events_unscoped_139;
CREATE FUNCTION public.get_public_club_upcoming_events(
  p_club_id uuid, p_after text DEFAULT NULL, p_limit integer DEFAULT 12
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN private.caller_can_access_club(p_club_id)
              THEN public.get_public_club_upcoming_events_unscoped_139(p_club_id, p_after, p_limit)
              ELSE NULL::jsonb END;
$$;

ALTER FUNCTION public.get_public_club_past_events(uuid, text, integer)
  RENAME TO get_public_club_past_events_unscoped_139;
CREATE FUNCTION public.get_public_club_past_events(
  p_club_id uuid, p_after text DEFAULT NULL, p_limit integer DEFAULT 12
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN private.caller_can_access_club(p_club_id)
              THEN public.get_public_club_past_events_unscoped_139(p_club_id, p_after, p_limit)
              ELSE NULL::jsonb END;
$$;

ALTER FUNCTION public.get_public_club_posts(uuid, text, integer)
  RENAME TO get_public_club_posts_unscoped_139;
CREATE FUNCTION public.get_public_club_posts(
  p_club_id uuid, p_after text DEFAULT NULL, p_limit integer DEFAULT 12
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN private.caller_can_access_club(p_club_id)
              THEN public.get_public_club_posts_unscoped_139(p_club_id, p_after, p_limit)
              ELSE NULL::jsonb END;
$$;

ALTER FUNCTION public.get_public_club_media(uuid, text, integer)
  RENAME TO get_public_club_media_unscoped_139;
CREATE FUNCTION public.get_public_club_media(
  p_club_id uuid, p_after text DEFAULT NULL, p_limit integer DEFAULT 12
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN private.caller_can_access_club(p_club_id)
              THEN public.get_public_club_media_unscoped_139(p_club_id, p_after, p_limit)
              ELSE NULL::jsonb END;
$$;

ALTER FUNCTION public.get_club_profile_events(uuid)
  RENAME TO get_club_profile_events_unscoped_139;
CREATE FUNCTION public.get_club_profile_events(p_club_id uuid)
RETURNS TABLE(
  id uuid, title text, description text, cover_image_url text,
  event_date date, start_time time without time zone, end_time time without time zone,
  event_end_at timestamptz, location text, building text, room text, club_id uuid,
  visibility text, activity_tags text[], interest_tags text[], can_open boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT e.*
    FROM public.get_club_profile_events_unscoped_139(p_club_id) AS e
   WHERE private.caller_can_access_club(p_club_id);
$$;

ALTER FUNCTION public.search_event_audience_members(uuid, text, integer)
  RENAME TO search_event_audience_members_unscoped_139;
CREATE FUNCTION public.search_event_audience_members(
  p_club_id uuid, p_query text DEFAULT '', p_limit integer DEFAULT 50
)
RETURNS TABLE(id uuid, username text, full_name text, avatar_url text, club_role text, is_officer boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT private.club_is_current_campus(p_club_id) THEN
    RAISE EXCEPTION 'club_not_in_callers_campus' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT *
      FROM public.search_event_audience_members_unscoped_139(p_club_id, p_query, p_limit);
END;
$$;

-- Renaming preserves the old implementation's internal grants. Remove those
-- grants from the retained bodies, then restore only the original public RPC
-- grants on the guarded signatures.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'search_discovery_unscoped_139(uuid,text)',
    'get_discovery_people_unscoped_139(uuid)',
    'get_discovery_clubs_unscoped_139(uuid,text,integer,integer)',
    'get_phone_discovery_clubs_unscoped_139(uuid,text,integer,integer)',
    'get_discovery_events_unscoped_139(uuid,integer,integer)',
    'get_public_club_profile_unscoped_139(uuid)',
    'get_public_club_upcoming_events_unscoped_139(uuid,text,integer)',
    'get_public_club_past_events_unscoped_139(uuid,text,integer)',
    'get_public_club_posts_unscoped_139(uuid,text,integer)',
    'get_public_club_media_unscoped_139(uuid,text,integer)',
    'get_club_profile_events_unscoped_139(uuid)',
    'search_event_audience_members_unscoped_139(uuid,text,integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', fn);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.search_discovery(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_discovery(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_discovery_people(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_discovery_people(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_discovery_clubs(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_discovery_clubs(uuid, text, integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_phone_discovery_clubs(uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_phone_discovery_clubs(uuid, text, integer, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_discovery_events(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_discovery_events(uuid, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_public_club_profile(uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_profile(uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_club_upcoming_events(uuid, text, integer) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_upcoming_events(uuid, text, integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_club_past_events(uuid, text, integer) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_past_events(uuid, text, integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_club_posts(uuid, text, integer) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_posts(uuid, text, integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_club_media(uuid, text, integer) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_club_media(uuid, text, integer) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_club_profile_events(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_club_profile_events(uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.search_event_audience_members(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_event_audience_members(uuid, text, integer) TO authenticated;

-- Campus-aware preview: an authenticated caller cannot choose another campus;
-- the anonymous onboarding preview may choose only an active campus slug.
CREATE OR REPLACE FUNCTION public.preview_club_match_count(
  p_interests text[],
  p_university_slug text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_university_id uuid;
  v_natural integer;
  v_eligible integer;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL THEN
    v_university_id := private.current_campus_id();
    IF v_university_id IS NULL AND NOT private.current_is_platform_admin() THEN
      RETURN 0;
    END IF;
  ELSE
    IF p_university_slug IS NULL THEN
      -- Preserve the pre-137 anonymous launch-campus preview contract.
      SELECT ac.launch_university_id
        INTO v_university_id
        FROM public.app_config AS ac
       LIMIT 1;
    ELSE
      SELECT u.id INTO v_university_id
        FROM public.universities AS u
       WHERE u.slug = btrim(p_university_slug)
         AND u.is_active IS TRUE;
    END IF;
    IF v_university_id IS NULL THEN
      RETURN 0;
    END IF;
  END IF;

  SELECT count(*) FILTER (WHERE r.match_score > 0), count(*)
    INTO v_natural, v_eligible
    FROM public.rank_eligible_clubs(NULL, v_university_id, p_interests) AS r;
  RETURN public.club_match_target_count(v_natural, v_eligible);
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_club_match_count(text[], text) TO anon, authenticated;

-- --------------------------------------------------------------------------
-- Performance indexes for the new parent predicates and hot paths.
-- --------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_profiles_university_id_id
  ON public.profiles (university_id, id);
CREATE INDEX IF NOT EXISTS idx_clubs_university_id_active
  ON public.clubs (university_id, is_active, id);
CREATE INDEX IF NOT EXISTS idx_club_members_club_user
  ON public.club_members (club_id, user_id);
CREATE INDEX IF NOT EXISTS idx_club_officers_club_user
  ON public.club_officers (club_id, user_id);
CREATE INDEX IF NOT EXISTS idx_events_club_id_id
  ON public.events (club_id, id);
CREATE INDEX IF NOT EXISTS idx_posts_club_author_id
  ON public.posts (club_id, author_id, id);
CREATE INDEX IF NOT EXISTS idx_conversations_club_id_id
  ON public.conversations (club_id, id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_user
  ON public.conversation_participants (conversation_id, user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_id
  ON public.notifications (user_id, id);
CREATE INDEX IF NOT EXISTS idx_club_recommendation_batches_user_status
  ON public.club_recommendation_batches (user_id, status);

COMMIT;
