-- ============================================================================
-- We Glue - Associate existing student profiles with the launch campus
-- Migration: 138_campus_backfill.sql
--
-- This is deliberately a profile-only backfill. It does not create, delete,
-- merge, or modify auth identities, and it does not change any profile column
-- other than university_id in the UPDATE below.
-- ============================================================================

DO $$
DECLARE
  v_launch_university_id UUID;
  v_null_profiles_before BIGINT;
  v_profiles_updated     BIGINT;
  v_null_profiles_after  BIGINT;
  v_platform_admins      BIGINT;
  v_null_clubs           BIGINT;
BEGIN
  -- The launch campus is configuration, not migration-owned data. Refuse to
  -- guess if the configuration is missing or points nowhere.
  SELECT ac.launch_university_id
    INTO v_launch_university_id
    FROM public.app_config AS ac
   WHERE ac.id = TRUE
   LIMIT 1;

  IF v_launch_university_id IS NULL THEN
    RAISE EXCEPTION
      '138: app_config.launch_university_id is NULL; refusing to backfill profiles';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.universities AS u
     WHERE u.id = v_launch_university_id
  ) THEN
    RAISE EXCEPTION
      '138: app_config.launch_university_id % does not reference a university',
      v_launch_university_id;
  END IF;

  -- Platform-admin identities are not student accounts.  The exact marker is
  -- auth.users.raw_app_meta_data.account_type = 'platform_admin', as
  -- centralized by is_platform_admin_auth(). The normal schema has no profile
  -- row for these identities; the predicate also protects an unexpected
  -- NULL-campus admin profile from receiving a campus.
  SELECT COUNT(*)
    INTO v_platform_admins
    FROM auth.users AS au
   WHERE public.is_platform_admin_auth(au.raw_app_meta_data);

  SELECT COUNT(*)
    INTO v_null_profiles_before
    FROM public.profiles AS p
    JOIN auth.users AS au ON au.id = p.id
   WHERE p.university_id IS NULL
     AND NOT public.is_platform_admin_auth(au.raw_app_meta_data);

  RAISE NOTICE
    '138: NULL student profiles before backfill = %, platform-admin identities excluded = %',
    v_null_profiles_before, v_platform_admins;

  -- Exact row-selection predicate for the backfill:
  --   profiles.university_id IS NULL
  --   AND the owning auth identity is not marked platform_admin.
  -- The inner join is safe because profiles.id has an FK to auth.users.id;
  -- therefore no non-account/orphan profile can be selected.
  UPDATE public.profiles AS p
     SET university_id = v_launch_university_id
    FROM auth.users AS au
   WHERE au.id = p.id
     AND p.university_id IS NULL
     AND NOT public.is_platform_admin_auth(au.raw_app_meta_data);

  GET DIAGNOSTICS v_profiles_updated = ROW_COUNT;

  SELECT COUNT(*)
    INTO v_null_profiles_after
    FROM public.profiles AS p
    JOIN auth.users AS au ON au.id = p.id
   WHERE p.university_id IS NULL
     AND NOT public.is_platform_admin_auth(au.raw_app_meta_data);

  RAISE NOTICE
    '138: profiles updated = %, NULL student profiles after backfill = %',
    v_profiles_updated, v_null_profiles_after;

  -- BE-4 dependency audit only. NULL club rows are reported but intentionally
  -- left unchanged here: this migration is scoped to existing student
  -- profiles, and club ownership needs its own reviewed decision/backfill.
  SELECT COUNT(*)
    INTO v_null_clubs
    FROM public.clubs AS c
   WHERE c.university_id IS NULL;

  RAISE NOTICE
    '138: clubs with NULL university_id = %; recommendation: resolve these before BE-4 campus isolation; no club rows changed by 138',
    v_null_clubs;

  IF v_null_profiles_after > 0 THEN
    RAISE EXCEPTION
      '138: % student profiles still have NULL university_id after backfill',
      v_null_profiles_after;
  END IF;
END;
$$;
