-- ============================================================================
-- 146 — Permanent club QR attendance and event check-in
--
-- Attendance is always available for every event. The only check-in window is
-- the event lifecycle window widened by 15 minutes on either side.
-- ============================================================================

BEGIN;

-- ── Canonical event start timestamp ────────────────────────────────────────
-- This mirrors migration 069's event_end_at derivation, using the established
-- event_date/start_time America/Chicago wall-clock write contract.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_start_at timestamptz;

CREATE OR REPLACE FUNCTION private.set_event_start_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.event_start_at := ((NEW.event_date + NEW.start_time) AT TIME ZONE 'America/Chicago');
  RETURN NEW;
END;
$$;

UPDATE public.events
   SET event_start_at = ((event_date + start_time) AT TIME ZONE 'America/Chicago')
 WHERE event_start_at IS NULL;

ALTER TABLE public.events
  ALTER COLUMN event_start_at SET NOT NULL;

DROP TRIGGER IF EXISTS trg_events_set_start_at ON public.events;
CREATE TRIGGER trg_events_set_start_at
  BEFORE INSERT OR UPDATE OF event_date, start_time ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.set_event_start_at();

CREATE INDEX IF NOT EXISTS idx_events_event_start_at
  ON public.events (event_start_at);

REVOKE ALL ON FUNCTION private.set_event_start_at() FROM PUBLIC, anon, authenticated;

-- ── Attendance storage ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.event_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campus uuid NOT NULL REFERENCES public.universities(id),
  student_id text NOT NULL,
  school_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_attendance_club_event
  ON public.event_attendance (club_id, event_id);

CREATE INDEX IF NOT EXISTS idx_event_attendance_event_created
  ON public.event_attendance (event_id, created_at, id);

CREATE TABLE IF NOT EXISTS public.saved_attendance_info (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campus uuid NOT NULL REFERENCES public.universities(id),
  student_id text NOT NULL,
  school_email text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, campus)
);

ALTER TABLE public.event_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_attendance_info ENABLE ROW LEVEL SECURITY;

-- Attendance PII is never directly writable by client roles. All writes go
-- through submit_event_checkin(), which rechecks the event window and campus.
REVOKE ALL ON TABLE public.event_attendance FROM anon, authenticated;
GRANT SELECT ON TABLE public.event_attendance TO authenticated;

DROP POLICY IF EXISTS "event_attendance: owner, officer, or admin can read"
  ON public.event_attendance;
CREATE POLICY "event_attendance: owner, officer, or admin can read"
  ON public.event_attendance FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (
      public.is_club_officer(club_id)
      AND EXISTS (
        SELECT 1
          FROM public.events AS e
         WHERE e.id = event_attendance.event_id
           AND e.club_id = event_attendance.club_id
      )
    )
    OR (SELECT private.current_is_platform_admin())
  );

REVOKE ALL ON TABLE public.saved_attendance_info FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.saved_attendance_info TO authenticated;

DROP POLICY IF EXISTS "saved_attendance_info: users read own" ON public.saved_attendance_info;
CREATE POLICY "saved_attendance_info: users read own"
  ON public.saved_attendance_info FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "saved_attendance_info: users insert own" ON public.saved_attendance_info;
CREATE POLICY "saved_attendance_info: users insert own"
  ON public.saved_attendance_info FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "saved_attendance_info: users update own" ON public.saved_attendance_info;
CREATE POLICY "saved_attendance_info: users update own"
  ON public.saved_attendance_info FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ── Student-facing RPCs ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_club_active_checkins(p_club_id uuid)
RETURNS TABLE(
  event_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  SELECT e.id, e.title, e.event_start_at, e.event_end_at
    FROM public.events AS e
    JOIN public.clubs AS c ON c.id = e.club_id
   WHERE e.club_id = p_club_id
     AND private.club_row_is_current_campus(c.university_id)
     AND now() >= e.event_start_at - interval '15 minutes'
     AND now() <= e.event_end_at + interval '15 minutes'
   ORDER BY e.event_start_at ASC, e.id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_event_checkin(
  p_event_id uuid,
  p_student_id text,
  p_school_email text,
  p_save_for_future boolean
)
RETURNS public.event_attendance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_event public.events%ROWTYPE;
  v_user_campus_id uuid := private.current_campus_id();
  v_club_university_id uuid;
  v_launch_university_id uuid;
  v_student_id text := NULLIF(btrim(p_student_id), '');
  v_school_email text := NULLIF(btrim(p_school_email), '');
  v_attendance public.event_attendance%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT *
    INTO v_event
    FROM public.events AS e
   WHERE e.id = p_event_id;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- This check intentionally runs before every upsert, including edits.
  IF now() < v_event.event_start_at - interval '15 minutes'
     OR now() > v_event.event_end_at + interval '15 minutes' THEN
    RAISE EXCEPTION 'checkin_window_closed';
  END IF;

  SELECT c.university_id
    INTO v_club_university_id
    FROM public.clubs AS c
   WHERE c.id = v_event.club_id;

  SELECT ac.launch_university_id
    INTO v_launch_university_id
    FROM public.app_config AS ac
   LIMIT 1;

  -- Do not use private.club_row_is_current_campus() here: its intentional
  -- platform-admin bypass is correct for campus-scoped reads, but a platform
  -- admin submitting a student check-in must still match a real caller campus.
  IF v_user_campus_id IS NULL
     OR COALESCE(v_club_university_id, v_launch_university_id)
          IS DISTINCT FROM v_user_campus_id THEN
    RAISE EXCEPTION 'campus_mismatch';
  END IF;

  IF v_student_id IS NULL OR v_school_email IS NULL THEN
    RAISE EXCEPTION 'attendance_fields_required';
  END IF;

  INSERT INTO public.event_attendance (
    event_id, club_id, user_id, campus, student_id, school_email
  )
  VALUES (
    v_event.id, v_event.club_id, v_user_id, v_user_campus_id, v_student_id, v_school_email
  )
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET campus = EXCLUDED.campus,
        student_id = EXCLUDED.student_id,
        school_email = EXCLUDED.school_email,
        updated_at = now()
  RETURNING * INTO v_attendance;

  IF COALESCE(p_save_for_future, false) THEN
    INSERT INTO public.saved_attendance_info (
      user_id, campus, student_id, school_email
    )
    VALUES (
      v_user_id, v_user_campus_id, v_student_id, v_school_email
    )
    ON CONFLICT (user_id, campus) DO UPDATE
      SET student_id = EXCLUDED.student_id,
          school_email = EXCLUDED.school_email,
          updated_at = now();
  END IF;

  RETURN v_attendance;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_saved_attendance_info(p_campus text DEFAULT NULL)
RETURNS TABLE(
  student_id text,
  school_email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_campus_id uuid := private.current_campus_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Keep the text parameter for existing clients, but never trust or compare
  -- it. The caller's university_id is the only campus authority.
  IF v_campus_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.student_id, s.school_email
   FROM public.saved_attendance_info AS s
   WHERE s.user_id = v_user_id
     AND s.campus = v_campus_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_event_attendance(p_event_id uuid)
RETURNS TABLE(
  student_id text,
  school_email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_club_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT e.club_id
    INTO v_club_id
    FROM public.events AS e
   WHERE e.id = p_event_id;

  IF v_club_id IS NULL OR NOT public.is_club_officer(v_club_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Keep this projection deliberately limited to the two approved privacy
  -- fields. Do not add IDs, campus, or timestamps to this contract.
  RETURN QUERY
  SELECT a.student_id, a.school_email
    FROM public.event_attendance AS a
   WHERE a.event_id = p_event_id
   ORDER BY a.created_at ASC, a.id ASC;
END;
$$;

-- ── Platform-admin RPCs ────────────────────────────────────────────────────
-- The SQL-side idiom is the same one used by existing admin-aware policies:
-- private.current_is_platform_admin(), which checks the immutable
-- raw_app_meta_data platform-admin marker. The web admin entrypoint layers
-- its portal allow-list, AAL2, recent-MFA, and write-switch checks before
-- invoking database operations.

CREATE OR REPLACE FUNCTION public.admin_list_event_attendance(p_event_id uuid)
RETURNS TABLE(
  student_id text,
  school_email text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT private.current_is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Hard privacy boundary: this function can return only these two columns.
  RETURN QUERY
  SELECT a.student_id, a.school_email
    FROM public.event_attendance AS a
   WHERE a.event_id = p_event_id
   ORDER BY a.created_at ASC, a.id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_event_attendance_summary(p_club_id uuid DEFAULT NULL)
RETURNS TABLE(
  club_id uuid,
  event_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  checkin_applies boolean,
  window_starts_at timestamptz,
  window_ends_at timestamptz,
  current_count bigint,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT private.current_is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    e.club_id,
    e.id,
    e.title,
    e.event_start_at,
    e.event_end_at,
    true,
    e.event_start_at - interval '15 minutes',
    e.event_end_at + interval '15 minutes',
    COUNT(a.id),
    COUNT(a.id)
    FROM public.events AS e
    LEFT JOIN public.event_attendance AS a ON a.event_id = e.id
   WHERE p_club_id IS NULL OR e.club_id = p_club_id
   GROUP BY e.club_id, e.id, e.title, e.event_start_at, e.event_end_at
   ORDER BY e.event_start_at DESC, e.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_club_attendance_summary(p_club_id uuid DEFAULT NULL)
RETURNS TABLE(
  club_id uuid,
  checkin_applies boolean,
  event_count bigint,
  current_count bigint,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT private.current_is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    e.club_id,
    true,
    COUNT(DISTINCT e.id),
    COUNT(a.id),
    COUNT(a.id)
    FROM public.events AS e
    LEFT JOIN public.event_attendance AS a ON a.event_id = e.id
   WHERE p_club_id IS NULL OR e.club_id = p_club_id
   GROUP BY e.club_id
   ORDER BY e.club_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_club_active_checkins(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_event_checkin(uuid, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_saved_attendance_info(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_event_attendance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_event_attendance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_event_attendance_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_club_attendance_summary(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.resolve_club_active_checkins(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_checkin(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_saved_attendance_info(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_event_attendance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_event_attendance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_event_attendance_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_club_attendance_summary(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_event_attendance_summary(uuid) IS
  'Secure-admin per-event attendance summary. Check-in always applies; current_count equals total_count.';
COMMENT ON FUNCTION public.admin_club_attendance_summary(uuid) IS
  'Secure-admin per-club attendance aggregate. Check-in always applies; current_count equals total_count.';

COMMIT;
