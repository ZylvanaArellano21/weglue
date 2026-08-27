-- 097_fix_null_agreed_to_terms_signup_failure.sql
--
-- Bug: handle_new_user()/ensure_profile() computed
--   v_agreed_to_terms := raw_user_meta_data->>'agreed_to_terms' = 'true'
-- which evaluates to NULL (not false) whenever the client never sends that
-- key at all. profiles.agreed_to_terms is NOT NULL with no way to fall back
-- to its DEFAULT once a value is explicitly supplied, so the profile INSERT
-- raised a not-null violation. Both functions swallow that with
-- EXCEPTION WHEN OTHERS (RAISE WARNING only), so auth.users still succeeded,
-- the confirmation email still went out and got verified, but the account
-- ended up with NO profiles row at all: invisible to search, username
-- updates were silent no-ops (UPDATE ... WHERE id = <no such row>), and the
-- client fell back to the placeholder "?" avatar. user_interests,
-- user_activities and the recommendation batch then also failed downstream
-- (their inserts key off the profile row existing).
--
-- Client root cause: apps/mobile/app/onboarding/signup.tsx never included
-- agreed_to_terms in the signUp() metadata (fixed alongside this
-- migration). apps/web/app/onboarding/signup/page.tsx already sent it,
-- which is why only some accounts were affected.
--
-- This migration (1) makes both functions NULL-safe so a missing/malformed
-- value is actually treated as false, as the code already claimed to do,
-- and (2) backfills every account already broken by this bug in prod.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_university_id uuid;
  v_email_domain text;
  v_interests text[];
  v_activities text[];
  v_provider text;
  v_oauth_pending boolean;
  v_agreed_to_terms boolean;
BEGIN
  IF public.is_platform_admin_auth(NEW.raw_app_meta_data) THEN
    RETURN NEW;
  END IF;

  v_provider := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  v_oauth_pending := v_provider <> 'email'
    AND NOT (NEW.raw_user_meta_data ? 'interests')
    AND NOT (NEW.raw_user_meta_data ? 'activities');
  -- NULL-safe: a missing or malformed value is treated as false, never NULL.
  v_agreed_to_terms := COALESCE(NEW.raw_user_meta_data->>'agreed_to_terms' = 'true', false);

  BEGIN
    v_university_id := resolve_signup_university_id(NEW.email);
    v_email_domain := NULLIF(LOWER(SPLIT_PART(NEW.email, '@', 2)), '');

    INSERT INTO public.profiles (
      id, username, full_name, university_id, email_domain,
      picture_prompt_status, onboarding_completed, push_permission_prompt_pending,
      agreed_to_terms, agreed_at
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::text, 8)),
      CASE WHEN v_oauth_pending THEN ''
           ELSE COALESCE(NEW.raw_user_meta_data->>'full_name', '') END,
      v_university_id,
      v_email_domain,
      'pending',
      NOT v_oauth_pending,
      true,
      v_agreed_to_terms,
      CASE WHEN v_agreed_to_terms THEN now() ELSE NULL END
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    SELECT COALESCE(ARRAY_AGG(value::text), ARRAY[]::text[])
      INTO v_interests
      FROM JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(NEW.raw_user_meta_data->'interests', '[]'::jsonb)) AS value;
    SELECT COALESCE(ARRAY_AGG(value::text), ARRAY[]::text[])
      INTO v_activities
      FROM JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(NEW.raw_user_meta_data->'activities', '[]'::jsonb)) AS value;

    INSERT INTO public.user_interests (user_id, interest)
    SELECT NEW.id, i
      FROM UNNEST(v_interests) AS i
     WHERE i IN (
       'Finance & Business', 'Social Events', 'Music', 'Fashion',
       'Art & Culture', 'Social Justice & Activism', 'Numbers & Economics',
       'Gaming', 'Health & Wellness', 'Environment', 'Sports & Athletics',
       'Community Service', 'Crafts', 'Religion', 'Technology and Computer',
       'Film & Media', 'Photography', 'Strategy and Critical Thinking',
       'Writing', 'Theater', 'Travel & Languages', 'Debate & Politics'
     )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.user_activities (user_id, activity)
    SELECT NEW.id, a
      FROM UNNEST(v_activities) AS a
     WHERE a IN (
       'Projects', 'Volunteering', 'Workshops', 'Campus Fairs', 'Trips',
       'Study Groups', 'Networking', 'Tournaments', 'Social Events', 'Campus Tours'
     )
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: survey insert failed for %: %', NEW.id, SQLERRM;
  END;

  IF NOT v_oauth_pending THEN
    BEGIN
      PERFORM generate_club_recommendation_batch(NEW.id, 'onboarding');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: batch generation failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_profile()
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_meta jsonb;
  v_app_meta jsonb;
  v_provider text;
  v_pending boolean;
  v_agreed_to_terms boolean;
  v_profile profiles;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT email, raw_user_meta_data, raw_app_meta_data,
         COALESCE(raw_app_meta_data->>'provider', 'email')
    INTO v_email, v_meta, v_app_meta, v_provider
    FROM auth.users WHERE id = v_user_id;

  IF public.is_platform_admin_auth(v_app_meta) THEN RETURN NULL; END IF;

  v_pending := v_provider <> 'email'
    AND NOT (v_meta ? 'interests')
    AND NOT (v_meta ? 'activities')
    AND NOT EXISTS (SELECT 1 FROM user_interests WHERE user_id = v_user_id);
  -- NULL-safe: a missing or malformed value is treated as false, never NULL.
  v_agreed_to_terms := COALESCE(v_meta->>'agreed_to_terms' = 'true', false);

  INSERT INTO profiles (
    id, username, full_name, university_id, email_domain,
    picture_prompt_status, onboarding_completed, push_permission_prompt_pending,
    agreed_to_terms, agreed_at
  )
  VALUES (
    v_user_id,
    COALESCE(v_meta->>'username', 'user_' || LEFT(v_user_id::text, 8)) || '_' || LEFT(gen_random_uuid()::text, 4),
    CASE WHEN v_pending THEN '' ELSE COALESCE(v_meta->>'full_name', '') END,
    resolve_signup_university_id(v_email),
    NULLIF(LOWER(SPLIT_PART(v_email, '@', 2)), ''),
    'pending', NOT v_pending, true,
    v_agreed_to_terms,
    CASE WHEN v_agreed_to_terms THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;

  UPDATE profiles
     SET university_id = resolve_signup_university_id(v_email)
   WHERE id = v_user_id AND university_id IS NULL;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  RETURN v_profile;
END;
$function$;

-- Backfill every account already broken by this bug: a confirmed,
-- non-platform-admin auth.users row with no profiles row at all. Replays
-- exactly what handle_new_user() should have done, using the survey answers
-- and consent that were already captured in the user's own signup metadata.
DO $$
DECLARE
  r RECORD;
  v_university_id uuid;
  v_email_domain text;
  v_interests text[];
  v_activities text[];
BEGIN
  FOR r IN
    SELECT u.id, u.email, u.raw_user_meta_data, u.email_confirmed_at
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL
      AND NOT public.is_platform_admin_auth(u.raw_app_meta_data)
  LOOP
    v_university_id := public.resolve_signup_university_id(r.email);
    v_email_domain := NULLIF(LOWER(SPLIT_PART(r.email, '@', 2)), '');

    INSERT INTO public.profiles (
      id, username, full_name, university_id, email_domain,
      picture_prompt_status, onboarding_completed, push_permission_prompt_pending,
      agreed_to_terms, agreed_at
    )
    VALUES (
      r.id,
      COALESCE(r.raw_user_meta_data->>'username', 'user_' || LEFT(r.id::text, 8)),
      COALESCE(r.raw_user_meta_data->>'full_name', ''),
      v_university_id,
      v_email_domain,
      'pending',
      true,
      true,
      true,
      COALESCE(r.email_confirmed_at, now())
    )
    ON CONFLICT (id) DO NOTHING;

    SELECT COALESCE(ARRAY_AGG(value::text), ARRAY[]::text[])
      INTO v_interests
      FROM JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(r.raw_user_meta_data->'interests', '[]'::jsonb)) AS value;
    SELECT COALESCE(ARRAY_AGG(value::text), ARRAY[]::text[])
      INTO v_activities
      FROM JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(r.raw_user_meta_data->'activities', '[]'::jsonb)) AS value;

    INSERT INTO public.user_interests (user_id, interest)
    SELECT r.id, i
      FROM UNNEST(v_interests) AS i
     WHERE i IN (
       'Finance & Business', 'Social Events', 'Music', 'Fashion',
       'Art & Culture', 'Social Justice & Activism', 'Numbers & Economics',
       'Gaming', 'Health & Wellness', 'Environment', 'Sports & Athletics',
       'Community Service', 'Crafts', 'Religion', 'Technology and Computer',
       'Film & Media', 'Photography', 'Strategy and Critical Thinking',
       'Writing', 'Theater', 'Travel & Languages', 'Debate & Politics'
     )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.user_activities (user_id, activity)
    SELECT r.id, a
      FROM UNNEST(v_activities) AS a
     WHERE a IN (
       'Projects', 'Volunteering', 'Workshops', 'Campus Fairs', 'Trips',
       'Study Groups', 'Networking', 'Tournaments', 'Social Events', 'Campus Tours'
     )
    ON CONFLICT DO NOTHING;

    PERFORM public.generate_club_recommendation_batch(r.id, 'onboarding');
  END LOOP;
END $$;
