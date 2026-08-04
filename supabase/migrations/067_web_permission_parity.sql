-- ============================================================================
-- 067 — Web permission parity: canonical event expiry and audience enforcement
--
-- Mobile continues to write event_date/start_time/end_time exactly as shipped.
-- This migration derives event_end_at from those columns in America/Chicago,
-- so existing mobile clients remain compatible while every web and PostgREST
-- access path gains an authoritative, DST-safe end timestamp.
-- ============================================================================

BEGIN;

-- ── Canonical event lifecycle timestamp ────────────────────────────────────

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_end_at timestamptz;

CREATE OR REPLACE FUNCTION private.set_event_end_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- event_date and end_time are the established mobile write contract. Treat
  -- them as America/Chicago wall-clock values, then store one UTC instant.
  NEW.event_end_at := ((NEW.event_date + NEW.end_time) AT TIME ZONE 'America/Chicago');
  RETURN NEW;
END;
$$;

UPDATE public.events
   SET event_end_at = ((event_date + end_time) AT TIME ZONE 'America/Chicago')
 WHERE event_end_at IS NULL;

ALTER TABLE public.events
  ALTER COLUMN event_end_at SET NOT NULL;

DROP TRIGGER IF EXISTS trg_events_set_end_at ON public.events;
CREATE TRIGGER trg_events_set_end_at
  BEFORE INSERT OR UPDATE OF event_date, end_time ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.set_event_end_at();

CREATE INDEX IF NOT EXISTS idx_events_event_end_at
  ON public.events (event_end_at);

-- ── Security-definer predicates used by RLS and the narrow web RPCs ─────────

CREATE OR REPLACE FUNCTION private.can_access_event(p_event_id uuid, p_viewer uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_viewer IS NOT NULL
     AND public.current_student_can_access_app()
     AND EXISTS (
       SELECT 1
         FROM public.events e
        WHERE e.id = p_event_id
          AND public.content_is_student_visible('event', e.id)
          AND (
            e.visibility = 'everyone'
            OR e.created_by = p_viewer
            OR EXISTS (
              SELECT 1 FROM public.club_members cm
               WHERE cm.club_id = e.club_id
                 AND cm.user_id = p_viewer
                 AND cm.role = 'officer'
            )
            OR (
              e.visibility = 'members'
              AND EXISTS (
                SELECT 1 FROM public.club_members cm
                 WHERE cm.club_id = e.club_id AND cm.user_id = p_viewer
              )
            )
            OR (
              e.visibility = 'specific'
              AND p_viewer = ANY(COALESCE(e.specific_user_ids, ARRAY[]::uuid[]))
            )
          )
     );
$$;

CREATE OR REPLACE FUNCTION private.can_mutate_event_rsvp(p_event_id uuid, p_viewer uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.can_access_event(p_event_id, p_viewer)
     AND EXISTS (
       SELECT 1 FROM public.events e
        WHERE e.id = p_event_id
          -- Equality is deliberately blocked: end_at <= now means past.
          AND e.event_end_at > now()
     );
$$;

REVOKE ALL ON FUNCTION private.set_event_end_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_access_event(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_mutate_event_rsvp(uuid, uuid) FROM PUBLIC, anon, authenticated;
-- PostgreSQL evaluates an RLS predicate as the calling role, including its
-- function ACL. These routines remain in the non-API `private` schema (with
-- no client schema usage), but authenticated needs EXECUTE for the policies
-- below to work. The functions themselves return only a boolean about the
-- caller's own access; no event row or recipient list is exposed.
GRANT EXECUTE ON FUNCTION private.can_access_event(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_mutate_event_rsvp(uuid, uuid) TO authenticated;

-- A selected event is an allow-list of CURRENT club members at submission.
-- Existing events retain their allow-list if a selected person leaves later;
-- that is the established mobile behaviour. Revalidation happens only when an
-- officer creates/edits that audience, preventing stale picker results.
CREATE OR REPLACE FUNCTION private.validate_event_specific_audience()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invalid uuid;
BEGIN
  IF NEW.visibility <> 'specific' THEN
    NEW.specific_user_ids := NULL;
    RETURN NEW;
  END IF;

  IF cardinality(COALESCE(NEW.specific_user_ids, ARRAY[]::uuid[])) = 0 THEN
    RAISE EXCEPTION 'selected_members_required' USING ERRCODE = '23514';
  END IF;

  IF cardinality(NEW.specific_user_ids) <> (
    SELECT count(DISTINCT member_id) FROM unnest(NEW.specific_user_ids) AS member_id
  ) THEN
    RAISE EXCEPTION 'selected_members_must_be_unique' USING ERRCODE = '23514';
  END IF;

  IF NEW.created_by = ANY(NEW.specific_user_ids) THEN
    -- The creator already has the mobile creator exception and is not a picker
    -- result, so accepting it would be a stale-client divergence.
    RAISE EXCEPTION 'event_creator_cannot_be_selected' USING ERRCODE = '23514';
  END IF;

  SELECT selected_id INTO v_invalid
    FROM unnest(NEW.specific_user_ids) AS selected_id
   WHERE selected_id = ANY(public.blocked_user_ids())
      OR NOT EXISTS (
        SELECT 1 FROM public.club_members cm
         WHERE cm.club_id = NEW.club_id AND cm.user_id = selected_id
      )
      OR NOT public.can_student_access_app(selected_id)
   LIMIT 1;

  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'selected_member_is_not_currently_eligible' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_validate_specific_audience ON public.events;
CREATE TRIGGER trg_events_validate_specific_audience
  BEFORE INSERT OR UPDATE OF visibility, club_id, specific_user_ids ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.validate_event_specific_audience();

REVOKE ALL ON FUNCTION private.validate_event_specific_audience() FROM PUBLIC, anon, authenticated;

-- ── Event RLS: one rule for a detail URL, stale cache, and direct PostgREST ─

DROP POLICY IF EXISTS "events: visibility-aware read" ON public.events;
CREATE POLICY "events: visibility-aware read"
  ON public.events FOR SELECT TO authenticated
  USING (private.can_access_event(id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "event_rsvps: read respecting hide_events" ON public.event_rsvps;
CREATE POLICY "event_rsvps: read respecting hide_events"
  ON public.event_rsvps FOR SELECT TO authenticated
  USING (
    private.can_access_event(event_id, (SELECT auth.uid()))
    AND (
      user_id = (SELECT auth.uid())
      OR NOT EXISTS (
        SELECT 1 FROM public.user_privacy up
         WHERE up.user_id = event_rsvps.user_id AND up.hide_events = true
      )
    )
  );

DROP POLICY IF EXISTS "event_rsvps: users manage own" ON public.event_rsvps;
CREATE POLICY "event_rsvps: users insert eligible"
  ON public.event_rsvps FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.can_mutate_event_rsvp(event_id, (SELECT auth.uid()))
  );
CREATE POLICY "event_rsvps: users update eligible"
  ON public.event_rsvps FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.can_mutate_event_rsvp(event_id, (SELECT auth.uid()))
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.can_mutate_event_rsvp(event_id, (SELECT auth.uid()))
  );
CREATE POLICY "event_rsvps: users delete eligible"
  ON public.event_rsvps FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.can_mutate_event_rsvp(event_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "saved_events: users manage own" ON public.saved_events;
CREATE POLICY "saved_events: users manage own"
  ON public.saved_events FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.can_access_event(event_id, (SELECT auth.uid()))
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.can_access_event(event_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "event_activities: anyone authenticated can read" ON public.event_activities;
CREATE POLICY "event_activities: audience-aware read"
  ON public.event_activities FOR SELECT TO authenticated
  USING (private.can_access_event(event_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "event_interests: anyone authenticated can read" ON public.event_interests;
CREATE POLICY "event_interests: audience-aware read"
  ON public.event_interests FOR SELECT TO authenticated
  USING (private.can_access_event(event_id, (SELECT auth.uid())));

-- The club profile is intentionally the only surface that can show a
-- members-only event card to a non-member. It returns no RSVP data, no attendee
-- data, no selected IDs, and an explicit can_open=false. Selected events are
-- never returned unless the caller has ordinary event access.
CREATE OR REPLACE FUNCTION public.get_club_profile_events(p_club_id uuid)
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  cover_image_url text,
  event_date date,
  start_time time without time zone,
  end_time time without time zone,
  event_end_at timestamptz,
  location text,
  building text,
  room text,
  club_id uuid,
  visibility text,
  activity_tags text[],
  interest_tags text[],
  can_open boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    e.id, e.title, e.description, e.cover_image_url, e.event_date, e.start_time,
    e.end_time, e.event_end_at, e.location, e.building, e.room, e.club_id,
    e.visibility,
    CASE WHEN private.can_access_event(e.id, auth.uid()) THEN
      COALESCE((SELECT array_agg(ea.activity ORDER BY ea.activity)
                  FROM public.event_activities ea WHERE ea.event_id = e.id), ARRAY[]::text[])
    ELSE ARRAY[]::text[] END,
    CASE WHEN private.can_access_event(e.id, auth.uid()) THEN
      COALESCE((SELECT array_agg(ei.interest ORDER BY ei.interest)
                  FROM public.event_interests ei WHERE ei.event_id = e.id), ARRAY[]::text[])
    ELSE ARRAY[]::text[] END,
    private.can_access_event(e.id, auth.uid())
  FROM public.events e
  WHERE e.club_id = p_club_id
    AND public.current_student_can_access_app()
    AND public.content_is_student_visible('event', e.id)
    AND (
      e.visibility = 'everyone'
      OR e.visibility = 'members'
      OR private.can_access_event(e.id, auth.uid())
    )
  ORDER BY e.event_date ASC, e.start_time ASC, e.id ASC;
$$;

REVOKE ALL ON FUNCTION public.get_club_profile_events(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_club_profile_events(uuid) TO authenticated;

-- This picker is club-scoped by construction. The officer identity and each
-- result's active membership are checked inside the database, so browser cache
-- and a manually supplied UUID cannot widen a selected audience.
CREATE OR REPLACE FUNCTION public.search_event_audience_members(
  p_club_id uuid,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 50
)
RETURNS TABLE(id uuid, username text, full_name text, avatar_url text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_query text := btrim(COALESCE(p_query, ''));
BEGIN
  IF v_me IS NULL OR NOT public.current_student_can_access_app() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_members cm
     WHERE cm.club_id = p_club_id AND cm.user_id = v_me AND cm.role = 'officer'
  ) THEN
    RAISE EXCEPTION 'only_club_officers_can_select_event_members' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, p.username, p.full_name, p.avatar_url
    FROM public.club_members cm
    JOIN public.profiles p ON p.id = cm.user_id
   WHERE cm.club_id = p_club_id
     AND p.id <> v_me
     AND p.id <> ALL(public.blocked_user_ids())
     AND public.can_student_access_app(p.id)
     AND (
       v_query = ''
       -- Mirrors mobile's unescaped `%query%` substring search. The RPC's
       -- eligibility predicate, rather than a client-side result filter, is
       -- the permission boundary here.
       OR p.username ILIKE '%' || v_query || '%'
       OR p.full_name ILIKE '%' || v_query || '%'
     )
   ORDER BY p.username
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 50));
END;
$$;

REVOKE ALL ON FUNCTION public.search_event_audience_members(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_event_audience_members(uuid, text, integer) TO authenticated;

-- Discovery/search is SECURITY DEFINER behind the 058 wrapper, so it must use
-- the same canonical timestamp and audience predicate instead of relying on
-- client filtering or date-only CURRENT_DATE comparisons.
CREATE OR REPLACE FUNCTION public.get_discovery_events__inner(
  p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, title text, emoji text, event_date date, start_time time without time zone,
  end_time time without time zone, location text, cover_image_url text, club_id uuid,
  club_name text, club_avatar_url text, member_count integer, is_saved boolean,
  user_rsvp_status text, match_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me uuid := public.assert_self_or_null(p_user_id);
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.title, e.emoji, e.event_date, e.start_time, e.end_time, e.location,
    e.cover_image_url, e.club_id, c.name, c.avatar_url, c.member_count,
    EXISTS(SELECT 1 FROM public.saved_events se
            WHERE se.user_id = v_me AND se.event_id = e.id),
    (SELECT er.status::text FROM public.event_rsvps er
      WHERE er.user_id = v_me AND er.event_id = e.id LIMIT 1),
    (SELECT count(DISTINCT ea.activity)::int FROM public.event_activities ea
      WHERE ea.event_id = e.id
        AND EXISTS (SELECT 1 FROM public.user_activities ua
                     WHERE ua.user_id = v_me AND ua.activity = ea.activity))
  FROM public.events e
  JOIN public.clubs c ON c.id = e.club_id
  WHERE e.event_end_at > now()
    AND c.is_active = true
    AND private.can_access_event(e.id, v_me)
  ORDER BY 15 DESC, e.event_date ASC, e.start_time ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.get_discovery_events__inner(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_discovery_events__inner(uuid, integer, integer) TO service_role;

-- Existing notification rows are harmless only while their target remains
-- reachable. When an audience narrows, remove stale event notifications rather
-- than let a notification badge retain a reference to inaccessible content.
CREATE OR REPLACE FUNCTION private.prune_event_notifications_on_audience_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.visibility IS DISTINCT FROM OLD.visibility
    OR NEW.specific_user_ids IS DISTINCT FROM OLD.specific_user_ids
    OR NEW.club_id IS DISTINCT FROM OLD.club_id
  ) THEN
    DELETE FROM public.notifications n
     WHERE n.entity_type = 'event'
       AND n.entity_id = NEW.id
       AND NOT private.can_access_event(NEW.id, n.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_prune_notifications_on_audience_change ON public.events;
CREATE TRIGGER trg_events_prune_notifications_on_audience_change
  AFTER UPDATE OF visibility, specific_user_ids, club_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.prune_event_notifications_on_audience_change();

REVOKE ALL ON FUNCTION private.prune_event_notifications_on_audience_change() FROM PUBLIC, anon, authenticated;

-- 062 and 063 left two permissive post-read policies in force. PostgreSQL ORs
-- permissive policies, so either privacy or blocking could be bypassed. Keep
-- the mobile official-club-post exception but require both protections for
-- personal content.
DROP POLICY IF EXISTS "posts: authenticated read, block-aware" ON public.posts;
DROP POLICY IF EXISTS "posts: read respecting private accounts" ON public.posts;
CREATE POLICY "posts: read respecting privacy, blocking, and lifecycle"
  ON public.posts FOR SELECT TO authenticated
  USING (
    public.content_is_student_visible('post', id)
    AND (
      author_id = (SELECT auth.uid())
      OR club_id IS NOT NULL
      OR (
        author_id <> ALL((SELECT public.blocked_user_ids())::uuid[])
        AND (
          NOT EXISTS (
            SELECT 1 FROM public.user_privacy up
             WHERE up.user_id = posts.author_id AND up.is_private
          )
          OR EXISTS (
            SELECT 1 FROM public.follows f
             WHERE f.follower_id = (SELECT auth.uid())
               AND f.following_id = posts.author_id
               AND f.status = 'accepted'
          )
        )
      )
    )
  );

-- Related rows must inherit the parent post's final RLS decision. Without this
-- second check, a direct comments/likes/tags request could disclose interaction
-- data for a private or blocked personal post even though the post row is gone.
DROP POLICY IF EXISTS "post_comments: authenticated read, block-aware" ON public.post_comments;
CREATE POLICY "post_comments: authenticated read, post-aware"
  ON public.post_comments FOR SELECT TO authenticated
  USING (
    public.content_is_student_visible('comment', id)
    AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_comments.post_id)
    AND (
      user_id = (SELECT auth.uid())
      OR user_id <> ALL((SELECT public.blocked_user_ids())::uuid[])
    )
  );

DROP POLICY IF EXISTS "post_comments: users insert own" ON public.post_comments;
CREATE POLICY "post_comments: users insert own"
  ON public.post_comments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_comments.post_id)
  );

DROP POLICY IF EXISTS "post_comments: users delete own" ON public.post_comments;
CREATE POLICY "post_comments: users delete own"
  ON public.post_comments FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_comments.post_id)
  );

DROP POLICY IF EXISTS "post_likes: authenticated read, block-aware" ON public.post_likes;
CREATE POLICY "post_likes: authenticated read, post-aware"
  ON public.post_likes FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_likes.post_id)
    AND (
      user_id = (SELECT auth.uid())
      OR user_id <> ALL((SELECT public.blocked_user_ids())::uuid[])
    )
  );

DROP POLICY IF EXISTS "post_likes: users manage own" ON public.post_likes;
CREATE POLICY "post_likes: users manage own"
  ON public.post_likes FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_likes.post_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_likes.post_id)
  );

DROP POLICY IF EXISTS post_club_tags_select_public ON public.post_club_tags;
CREATE POLICY post_club_tags_select_public
  ON public.post_club_tags FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_club_tags.post_id));

-- An event notification is readable only while its recipient can still open
-- that event. This prevents a former member or removed selected recipient from
-- seeing title/location text in an old notification row before navigation.
DROP POLICY IF EXISTS "notifications: users read own, block-aware" ON public.notifications;
CREATE POLICY "notifications: users read own, block-aware"
  ON public.notifications FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (
      actor_id IS NULL
      OR actor_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
      OR type <> ALL ((SELECT public.blockable_notification_types())::text[])
    )
    AND (
      entity_type IS NULL
      OR entity_id IS NULL
      OR (
        entity_type = 'event'
        AND private.can_access_event(entity_id, (SELECT auth.uid()))
      )
      OR (
        entity_type <> 'event'
        AND (
          entity_type NOT IN ('post', 'comment')
          OR public.content_is_student_visible(entity_type, entity_id)
        )
      )
    )
  );

COMMIT;
