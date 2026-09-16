-- Repair the denormalized profiles.university copy after migration 136's
-- campus rename; sync_university_name() keeps it correct for all future writes.

DO $$
DECLARE
  v_mismatches_before BIGINT;
  v_rows_updated     BIGINT;
  v_mismatches_after  BIGINT;
BEGIN
  SELECT COUNT(*)
    INTO v_mismatches_before
    FROM public.profiles AS p
    JOIN public.universities AS u
      ON u.id = p.university_id
   WHERE p.university_id IS NOT NULL
     AND p.university IS DISTINCT FROM u.name;

  RAISE NOTICE 'profiles.university mismatches before sync: %', v_mismatches_before;

  UPDATE public.profiles AS p
     SET university = u.name
    FROM public.universities AS u
   WHERE p.university_id IS NOT NULL
     AND u.id = p.university_id
     AND p.university IS DISTINCT FROM u.name;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RAISE NOTICE 'profiles.university rows updated: %', v_rows_updated;

  SELECT COUNT(*)
    INTO v_mismatches_after
    FROM public.profiles AS p
    JOIN public.universities AS u
      ON u.id = p.university_id
   WHERE p.university_id IS NOT NULL
     AND p.university IS DISTINCT FROM u.name;

  RAISE NOTICE 'profiles.university mismatches after sync: %', v_mismatches_after;

  IF v_mismatches_after > 0 THEN
    RAISE EXCEPTION
      'profiles.university sync incomplete: % mismatches remain',
      v_mismatches_after;
  END IF;
END;
$$;
