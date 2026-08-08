-- =============================================================================
-- 078 — Events read policy becomes row-local (fixes INSERT ... RETURNING)
--
-- DEFECT
-- ------
-- 069/070 replaced the `events` SELECT policy with
--
--     USING (private.can_current_user_access_event(id))
--
-- `private.can_access_event` is a STABLE SECURITY DEFINER function that decides
-- access by looking the event UP AGAIN: `EXISTS (SELECT 1 FROM public.events e
-- WHERE e.id = p_event_id AND ...)`.
--
-- A STABLE function executes against the snapshot of the statement that called
-- it. During `INSERT INTO events (...) RETURNING id` PostgreSQL applies the
-- SELECT policy to the projected row, and that snapshot was taken BEFORE the
-- insert. The function therefore finds no row, returns false, and the whole
-- statement aborts with
--
--     42501: new row violates row-level security policy for table "events"
--
-- Every client creates events with `.insert(...).select('id').single()`
-- (apps/mobile/services/eventService.ts createEvent, apps/web/lib/hooks/
-- useCreateEvent.ts), so event creation has been failing for officers on BOTH
-- platforms — surfacing on mobile as "Failed to create event. Please try
-- again." The officer was always authorized: the INSERT WITH CHECK passes, and
-- selecting the same row in any LATER statement returns it. Only the
-- same-statement RETURNING projection was broken.
--
-- FIX
-- ---
-- Decide access from the ROW'S OWN COLUMNS instead of re-reading the table.
-- The authorization rule is unchanged, term for term, from
-- private.can_access_event — this neither widens nor narrows who may read an
-- event. It only stops the policy from depending on the row already being
-- visible in the caller's snapshot.
--
-- The club-membership tests stay inside a SECURITY DEFINER function on purpose.
-- Inlining `EXISTS (SELECT 1 FROM public.club_members ...)` directly into the
-- policy would run that subquery as the CALLER, so club_members' own RLS could
-- hide rows and silently change the answer.
--
-- private.can_access_event / can_current_user_access_event are deliberately
-- LEFT IN PLACE and unchanged. event_rsvps, event_interests, event_activities,
-- notifications and get_club_profile_events all call them about events that
-- already exist, where the snapshot is never a problem.
-- =============================================================================

BEGIN;

-- ── Row-local access predicate ─────────────────────────────────────────────
-- Same terms as private.can_access_event, but every event attribute arrives as
-- a parameter. Nothing here reads public.events, so the predicate is correct
-- for a row that the caller's statement snapshot cannot see yet.
CREATE OR REPLACE FUNCTION private.can_access_event_row(
  p_event_id          uuid,
  p_club_id           uuid,
  p_created_by        uuid,
  p_visibility        text,
  p_specific_user_ids uuid[],
  p_viewer            uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_viewer IS NOT NULL
     AND public.can_student_access_app(p_viewer)
     AND public.content_is_student_visible('event', p_event_id)
     AND (
       p_visibility = 'everyone'
       OR p_created_by = p_viewer
       OR EXISTS (
         SELECT 1 FROM public.club_members cm
          WHERE cm.club_id = p_club_id
            AND cm.user_id = p_viewer
            AND cm.role = 'officer'
       )
       OR (
         p_visibility = 'members'
         AND EXISTS (
           SELECT 1 FROM public.club_members cm
            WHERE cm.club_id = p_club_id AND cm.user_id = p_viewer
         )
       )
       OR (
         p_visibility = 'specific'
         AND p_viewer = ANY(COALESCE(p_specific_user_ids, ARRAY[]::uuid[]))
       )
     );
$$;

-- Caller-bound wrapper — the only form authenticated clients may execute, so a
-- student can never ask whether some OTHER user can access an event.
CREATE OR REPLACE FUNCTION private.can_current_user_access_event_row(
  p_event_id          uuid,
  p_club_id           uuid,
  p_created_by        uuid,
  p_visibility        text,
  p_specific_user_ids uuid[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.can_access_event_row(
           p_event_id, p_club_id, p_created_by, p_visibility,
           p_specific_user_ids, (SELECT auth.uid())
         );
$$;

REVOKE ALL ON FUNCTION private.can_access_event_row(uuid, uuid, uuid, text, uuid[], uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_current_user_access_event_row(uuid, uuid, uuid, text, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_event_row(uuid, uuid, uuid, text, uuid[], uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION private.can_current_user_access_event_row(uuid, uuid, uuid, text, uuid[])
  TO authenticated;

-- ── The policy ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "events: visibility-aware read" ON public.events;
CREATE POLICY "events: visibility-aware read"
  ON public.events FOR SELECT TO authenticated
  USING (
    private.can_current_user_access_event_row(
      id, club_id, created_by, visibility, specific_user_ids
    )
  );

COMMIT;
