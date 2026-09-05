-- ============================================================================
-- 130 — event audience member club roles (search_event_audience_members returns
--       club_role + is_officer for the hosting club only)
--
-- (Renumbered from 124 after the interest-matching family 122-127 merged to
-- main / production. No behavioral change from the reviewed-and-accepted 124.)
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.search_event_audience_members(uuid, text, integer);

-- This picker is club-scoped by construction. The officer identity and each
-- result's active membership are checked inside the database, so browser cache
-- and a manually supplied UUID cannot widen a selected audience.
CREATE OR REPLACE FUNCTION public.search_event_audience_members(
  p_club_id uuid,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 50
)
RETURNS TABLE(id uuid, username text, full_name text, avatar_url text, club_role text, is_officer boolean)
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
  SELECT p.id, p.username, p.full_name, p.avatar_url,
         co.role_title AS club_role, (cm.role = 'officer') AS is_officer
    FROM public.club_members cm
    JOIN public.profiles p ON p.id = cm.user_id
    LEFT JOIN public.club_officers co
      ON co.club_id = p_club_id AND co.user_id = cm.user_id
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

DO $$
DECLARE
  v_result text;
BEGIN
  SELECT pg_get_function_result(
           'public.search_event_audience_members(uuid,text,integer)'::regprocedure
         )
    INTO v_result;
  IF position('club_role text' IN v_result) = 0
     OR position('is_officer boolean' IN v_result) = 0 THEN
    RAISE EXCEPTION '130: search_event_audience_members return shape is missing club_role/is_officer: %', v_result;
  END IF;
END;
$$;

COMMIT;
