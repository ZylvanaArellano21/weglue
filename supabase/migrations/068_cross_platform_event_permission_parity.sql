-- =============================================================================
-- 068 — Cross-platform event permission parity hardening
--
-- 067 is retained unchanged because it is a committed migration. This
-- follow-up tightens its canonical enforcement without changing the established
-- mobile write shape: event_date + end_time remain the only lifecycle inputs.
-- =============================================================================

BEGIN;

-- ── Canonical event end timestamp ──────────────────────────────────────────
-- Fire for every UPDATE, not only an update that names date/end_time. A direct
-- PostgREST `event_end_at` write is therefore overwritten with the derived
-- America/Chicago instant instead of becoming an alternate lifecycle source.
DROP TRIGGER IF EXISTS trg_events_set_end_at ON public.events;
CREATE TRIGGER trg_events_set_end_at
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.set_event_end_at();

-- ── Event access: internal predicate plus caller-bound policy wrapper ──────
-- The two-argument predicate is needed only for database-owned work (the
-- service-role discovery wrapper and notification pruning). Authenticated
-- clients get no EXECUTE permission on it, so they cannot ask whether an
-- arbitrary UUID can access an event. RLS uses the one-argument wrapper bound
-- to auth.uid(). Both functions have a fixed empty search_path.
CREATE OR REPLACE FUNCTION private.can_access_event(
  p_event_id uuid,
  p_viewer uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_viewer IS NOT NULL
     AND public.can_student_access_app(p_viewer)
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

CREATE OR REPLACE FUNCTION private.can_current_user_access_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.can_access_event(p_event_id, (SELECT auth.uid()));
$$;

CREATE OR REPLACE FUNCTION private.can_current_user_mutate_event_rsvp(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.can_current_user_access_event(p_event_id)
     AND EXISTS (
       SELECT 1 FROM public.events e
        WHERE e.id = p_event_id
          -- Exact equality is past: event_end_at <= now blocks all RSVP mutation.
          AND e.event_end_at > now()
     );
$$;

REVOKE ALL ON FUNCTION private.can_access_event(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_mutate_event_rsvp(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_current_user_access_event(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_current_user_mutate_event_rsvp(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_event(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION private.can_current_user_access_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_current_user_mutate_event_rsvp(uuid) TO authenticated;

-- ── Historical selected recipients ─────────────────────────────────────────
-- The OLD allow-list remains valid when an officer makes an unrelated edit
-- after a recipient leaves. Only IDs newly added to the event must satisfy the
-- current-member predicate. Changing the hosting club intentionally makes every
-- selected ID new relative to that club.
CREATE OR REPLACE FUNCTION private.validate_event_specific_audience()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invalid uuid;
  v_existing_ids uuid[] := ARRAY[]::uuid[];
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

  IF TG_OP = 'UPDATE'
     AND OLD.visibility = 'specific'
     AND OLD.club_id = NEW.club_id THEN
    v_existing_ids := COALESCE(OLD.specific_user_ids, ARRAY[]::uuid[]);
  END IF;

  SELECT selected_id INTO v_invalid
    FROM unnest(NEW.specific_user_ids) AS selected_id
   WHERE NOT (selected_id = ANY(v_existing_ids))
     AND (
       selected_id = NEW.created_by
       OR selected_id = ANY(public.blocked_user_ids())
       OR NOT EXISTS (
         SELECT 1 FROM public.club_members cm
          WHERE cm.club_id = NEW.club_id AND cm.user_id = selected_id
       )
       OR NOT public.can_student_access_app(selected_id)
     )
   LIMIT 1;

  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'selected_member_is_not_currently_eligible' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- ── RLS: every client-facing event relationship uses caller-bound access ───
DROP POLICY IF EXISTS "events: visibility-aware read" ON public.events;
CREATE POLICY "events: visibility-aware read"
  ON public.events FOR SELECT TO authenticated
  USING (private.can_current_user_access_event(id));

DROP POLICY IF EXISTS "event_rsvps: read respecting hide_events" ON public.event_rsvps;
CREATE POLICY "event_rsvps: read respecting hide_events"
  ON public.event_rsvps FOR SELECT TO authenticated
  USING (
    private.can_current_user_access_event(event_id)
    AND (
      user_id = (SELECT auth.uid())
      OR NOT EXISTS (
        SELECT 1 FROM public.user_privacy up
         WHERE up.user_id = event_rsvps.user_id AND up.hide_events = true
      )
    )
  );

DROP POLICY IF EXISTS "event_rsvps: users insert eligible" ON public.event_rsvps;
DROP POLICY IF EXISTS "event_rsvps: users update eligible" ON public.event_rsvps;
DROP POLICY IF EXISTS "event_rsvps: users delete eligible" ON public.event_rsvps;
CREATE POLICY "event_rsvps: users insert eligible"
  ON public.event_rsvps FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.can_current_user_mutate_event_rsvp(event_id)
  );
CREATE POLICY "event_rsvps: users update eligible"
  ON public.event_rsvps FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.can_current_user_mutate_event_rsvp(event_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.can_current_user_mutate_event_rsvp(event_id)
  );
CREATE POLICY "event_rsvps: users delete eligible"
  ON public.event_rsvps FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.can_current_user_mutate_event_rsvp(event_id)
  );

DROP POLICY IF EXISTS "saved_events: users manage own" ON public.saved_events;
CREATE POLICY "saved_events: users manage own"
  ON public.saved_events FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.can_current_user_access_event(event_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.can_current_user_access_event(event_id)
  );

DROP POLICY IF EXISTS "event_activities: audience-aware read" ON public.event_activities;
CREATE POLICY "event_activities: audience-aware read"
  ON public.event_activities FOR SELECT TO authenticated
  USING (private.can_current_user_access_event(event_id));

DROP POLICY IF EXISTS "event_interests: audience-aware read" ON public.event_interests;
CREATE POLICY "event_interests: audience-aware read"
  ON public.event_interests FOR SELECT TO authenticated
  USING (private.can_current_user_access_event(event_id));

-- The club-profile RPC is the intentional members-only preview exception.
-- Selected events remain absent until caller-bound access is true.
CREATE OR REPLACE FUNCTION public.get_club_profile_events(p_club_id uuid)
RETURNS TABLE(
  id uuid, title text, description text, cover_image_url text,
  event_date date, start_time time without time zone, end_time time without time zone,
  event_end_at timestamptz, location text, building text, room text, club_id uuid,
  visibility text, activity_tags text[], interest_tags text[], can_open boolean
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
    CASE WHEN private.can_current_user_access_event(e.id) THEN
      COALESCE((SELECT array_agg(ea.activity ORDER BY ea.activity)
                  FROM public.event_activities ea WHERE ea.event_id = e.id), ARRAY[]::text[])
    ELSE ARRAY[]::text[] END,
    CASE WHEN private.can_current_user_access_event(e.id) THEN
      COALESCE((SELECT array_agg(ei.interest ORDER BY ei.interest)
                  FROM public.event_interests ei WHERE ei.event_id = e.id), ARRAY[]::text[])
    ELSE ARRAY[]::text[] END,
    private.can_current_user_access_event(e.id)
  FROM public.events e
  WHERE e.club_id = p_club_id
    AND public.current_student_can_access_app()
    AND public.content_is_student_visible('event', e.id)
    AND (
      e.visibility = 'everyone'
      OR e.visibility = 'members'
      OR private.can_current_user_access_event(e.id)
    )
  ORDER BY e.event_date ASC, e.start_time ASC, e.id ASC;
$$;

-- An event notification is visible only if the recipient can currently open
-- its target. This preserves the existing non-event notification behavior.
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
        AND private.can_current_user_access_event(entity_id)
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

-- ── Opaque access-change convergence ───────────────────────────────────────
-- 066 already owns a private, campus-scoped invalidation channel. Reuse that
-- channel and its receive policy; the payload stays `{}` and contains no event
-- id, recipient list, title, or audience state. Every active client clears its
-- permission-sensitive cache and refetches through RLS.
CREATE OR REPLACE FUNCTION private.broadcast_event_audience_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_university_id uuid;
BEGIN
  IF NEW.visibility IS NOT DISTINCT FROM OLD.visibility
     AND NEW.specific_user_ids IS NOT DISTINCT FROM OLD.specific_user_ids
     AND NEW.club_id IS NOT DISTINCT FROM OLD.club_id THEN
    RETURN NULL;
  END IF;

  SELECT c.university_id INTO v_university_id
    FROM public.clubs c WHERE c.id = NEW.club_id;
  IF v_university_id IS NOT NULL THEN
    PERFORM realtime.send(
      '{}'::jsonb,
      'invalidate',
      'sync:university:' || v_university_id::text,
      true
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_event_audience_sync failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_broadcast_audience_sync ON public.events;
CREATE TRIGGER trg_events_broadcast_audience_sync
  AFTER UPDATE OF visibility, specific_user_ids, club_id ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_event_audience_sync();

REVOKE ALL ON FUNCTION private.broadcast_event_audience_sync() FROM PUBLIC, anon, authenticated;

COMMIT;
