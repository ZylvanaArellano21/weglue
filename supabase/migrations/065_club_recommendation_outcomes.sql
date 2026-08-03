-- Surface a result-state without changing get_my_club_recommendations(), whose
-- JSON shape is already consumed by released clients.  The ranking remains in
-- 042's rank_eligible_clubs() so web and native clients cannot invent their own
-- fallback or availability definition.
CREATE OR REPLACE FUNCTION public.get_my_club_recommendation_outcome()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_university uuid;
  v_existing jsonb;
  v_available int := 0;
  v_eligible int := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  -- Calls the existing self-healing resolver.  A nonempty batch is the exact
  -- ordered recommendation set Home will render.
  v_existing := public.get_my_club_recommendations();
  IF v_existing IS NOT NULL AND COALESCE(jsonb_array_length(v_existing->'clubs'), 0) > 0 THEN
    RETURN jsonb_build_object('kind', 'matches', 'batch', v_existing);
  END IF;

  SELECT university_id INTO v_university FROM public.profiles WHERE id = v_user;
  SELECT count(*) INTO v_available
  FROM public.clubs c
  WHERE c.is_active = true
    AND c.university_id IS NOT DISTINCT FROM v_university;

  SELECT count(*) INTO v_eligible
  FROM public.rank_eligible_clubs(v_user, v_university, ARRAY[]::text[], 1);

  -- All available clubs are already memberships.  Inactive/deleted rows and
  -- other campuses never participate, matching rank_eligible_clubs().
  IF v_available > 0 AND v_eligible = 0 THEN
    RETURN jsonb_build_object('kind', 'all_joined');
  END IF;

  RETURN jsonb_build_object('kind', 'none_available');
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_club_recommendation_outcome() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_club_recommendation_outcome() TO authenticated;
