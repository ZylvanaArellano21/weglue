-- ============================================================================
-- We Glue - Campus signup and email-change enforcement
-- Migration: 137_campus_signup_enforcement.sql
--
-- Signup metadata is the campus authority for new multi-campus clients. The
-- legacy path deliberately remains the current launch-campus path for clients
-- that predate university_slug.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Campus-aware signup hook
--
-- Supabase's Before User Created payload has this relevant shape:
--   {
--     "user": {
--       "email": "valid.email@example.com",
--       "user_metadata": { "university_slug": "..." }
--     }
--   }
-- The client-supplied options.data object is therefore read as
-- event->'user'->'user_metadata', while the auth.users trigger below reads
-- the same data from NEW.raw_user_meta_data.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_email             text;
  v_has_university_slug   boolean;
  v_university_slug       text;
  v_university_id         uuid;
  v_email_denied_message  text;
BEGIN
  v_user_email := event->'user'->>'email';
  v_has_university_slug := COALESCE(
    (event->'user'->'user_metadata') ? 'university_slug',
    false
  );
  v_university_slug := NULLIF(
    BTRIM(event->'user'->'user_metadata'->>'university_slug'),
    ''
  );

  -- No university_slug means a 1.0.8-or-older client. Preserve the existing
  -- hook behavior exactly, including its existing error messages and its
  -- educational-email-only classification (rather than introducing new
  -- malformed-email behavior for those clients).
  IF NOT v_has_university_slug THEN
    IF v_user_email IS NULL THEN
      RETURN jsonb_build_object(
        'error', jsonb_build_object(
          'http_code', 422,
          'message', 'Please enter a valid email address.'
        )
      );
    END IF;

    IF public.is_educational_email(v_user_email) THEN
      RETURN jsonb_build_object(
        'error', jsonb_build_object(
          'http_code', 422,
          'message', 'Please use another email. Do not use your university or college email.'
        )
      );
    END IF;

    RETURN '{}'::jsonb;
  END IF;

  -- A supplied key is authoritative, even when it is null or blank. Never
  -- fall back to the launch campus for an invalid supplied campus.
  SELECT u.id, u.email_denied_message
    INTO v_university_id, v_email_denied_message
    FROM public.universities AS u
   WHERE u.slug = v_university_slug
     AND u.is_active = TRUE;

  IF v_university_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 422,
        'message', 'That campus is not currently available. Please choose an active campus.'
      )
    );
  END IF;

  IF v_user_email IS NULL
     OR NOT public.campus_email_allowed(v_university_id, v_user_email) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 422,
        'message', COALESCE(
          NULLIF(BTRIM(v_email_denied_message), ''),
          'Please use another email. Do not use your university or college email.'
        )
      )
    );
  END IF;

  RETURN '{}'::jsonb;
END;
$$;

GRANT EXECUTE ON FUNCTION public.before_user_created(jsonb)
  TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.before_user_created(jsonb)
  FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- 2. Signup/profile campus assignment
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_university_id uuid;
  v_university_slug text;
  v_has_university_slug boolean;
  v_email_domain text;
  v_interests text[];
  v_activities text[];
  v_provider text;
  v_oauth_pending boolean;
  v_agreed_to_terms boolean;
  v_avatar_choice_type text;
  v_avatar_choice_value text;
  v_avatar_url text;
  v_picture_prompt_status text;
BEGIN
  IF public.is_platform_admin_auth(NEW.raw_app_meta_data) THEN
    RETURN NEW;
  END IF;

  v_has_university_slug := COALESCE(
    NEW.raw_user_meta_data ? 'university_slug',
    false
  );
  v_university_slug := NULLIF(
    BTRIM(NEW.raw_user_meta_data->>'university_slug'),
    ''
  );

  v_provider := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  v_oauth_pending := v_provider <> 'email'
    AND NOT (NEW.raw_user_meta_data ? 'interests')
    AND NOT (NEW.raw_user_meta_data ? 'activities');
  v_agreed_to_terms := COALESCE(NEW.raw_user_meta_data->>'agreed_to_terms' = 'true', false);

  v_avatar_choice_type := NEW.raw_user_meta_data->>'avatar_choice_type';
  v_avatar_choice_value := NEW.raw_user_meta_data->>'avatar_choice_value';
  v_avatar_url := CASE
    WHEN v_avatar_choice_type = 'preset' AND v_avatar_choice_value IN (
      'avatar_01', 'avatar_02', 'avatar_03', 'avatar_04', 'avatar_05',
      'avatar_06', 'avatar_07', 'avatar_08', 'avatar_09', 'avatar_10',
      'avatar_11', 'avatar_12', 'avatar_13', 'avatar_14', 'avatar_15',
      'avatar_16', 'avatar_17', 'avatar_18', 'avatar_19', 'avatar_20',
      'avatar_21', 'avatar_22', 'avatar_23', 'avatar_24', 'avatar_25',
      'avatar_26', 'avatar_27', 'avatar_28', 'avatar_29', 'avatar_30'
    ) THEN 'preset:' || v_avatar_choice_value
    WHEN v_avatar_choice_type = 'text' AND v_avatar_choice_value IS NOT NULL
      AND length(trim(v_avatar_choice_value)) BETWEEN 1 AND 4
    THEN 'text:' || upper(trim(v_avatar_choice_value))
    WHEN v_avatar_choice_type IN ('photo', 'camera')
      AND v_avatar_choice_value ~ '^[0-9a-f]{32}$'
    THEN 'https://yoozrnosmqtaiksgcixc.supabase.co/storage/v1/object/public/pending-avatars/'
      || v_avatar_choice_value || '.jpg'
    ELSE NULL
  END;
  v_picture_prompt_status := CASE WHEN v_avatar_url IS NOT NULL THEN 'hidden' ELSE 'pending' END;

  BEGIN
    IF v_has_university_slug THEN
      SELECT u.id
        INTO v_university_id
        FROM public.universities AS u
       WHERE u.slug = v_university_slug
         AND u.is_active = TRUE;
    ELSE
      -- This is the exact pre-137 assignment path for old clients.
      v_university_id := public.resolve_signup_university_id(NEW.email);
    END IF;

    v_email_domain := NULLIF(LOWER(SPLIT_PART(NEW.email, '@', 2)), '');

    INSERT INTO public.profiles (
      id, username, full_name, university_id, email_domain,
      picture_prompt_status, avatar_url, onboarding_completed, push_permission_prompt_pending,
      agreed_to_terms, agreed_at
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::text, 8)),
      CASE WHEN v_oauth_pending THEN ''
           ELSE COALESCE(NEW.raw_user_meta_data->>'full_name', '') END,
      v_university_id,
      v_email_domain,
      v_picture_prompt_status,
      v_avatar_url,
      NOT v_oauth_pending,
      true,
      v_agreed_to_terms,
      CASE WHEN v_agreed_to_terms THEN now() ELSE NULL END
    )
    ON CONFLICT (id) DO NOTHING;

    -- A pre-existing pending profile can be encountered by a re-signup. Heal
    -- only a missing campus, using the same resolved value and no fallback.
    PERFORM set_config('weglue.profile_repair', 'on', true);
    UPDATE public.profiles
       SET university_id = v_university_id
     WHERE id = NEW.id
       AND university_id IS NULL
       AND v_university_id IS NOT NULL;
    PERFORM set_config('weglue.profile_repair', 'off', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('weglue.profile_repair', 'off', true);
    RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    SELECT COALESCE(ARRAY_AGG(value::text), ARRAY[]::text[])
      INTO v_interests
      FROM JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(NEW.raw_user_meta_data->'interests', '[]'::jsonb)) AS value;
    SELECT COALESCE(ARRAY_AGG(value::text), ARRAY[]::text[])
      INTO v_activities
      FROM JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(NEW.raw_user_meta_data->'activities', '[]'::jsonb)) AS value;

    INSERT INTO public.user_interests (user_id, interest, interest_id)
    SELECT NEW.id, itr.label, itr.id
    FROM UNNEST(v_interests) AS raw
    JOIN public.interests itr
      ON lower(itr.label) = lower(raw)
     AND itr.is_active
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
      PERFORM public.generate_club_recommendation_batch(NEW.id, 'onboarding');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: batch generation failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- The repair path uses the same metadata-first assignment rule as signup.
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_meta jsonb;
  v_app_meta jsonb;
  v_provider text;
  v_pending boolean;
  v_agreed_to_terms boolean;
  v_has_university_slug boolean;
  v_university_slug text;
  v_university_id uuid;
  v_profile public.profiles;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT email, raw_user_meta_data, raw_app_meta_data,
         COALESCE(raw_app_meta_data->>'provider', 'email')
    INTO v_email, v_meta, v_app_meta, v_provider
    FROM auth.users
   WHERE id = v_user_id;

  IF public.is_platform_admin_auth(v_app_meta) THEN RETURN NULL; END IF;

  v_has_university_slug := COALESCE(v_meta ? 'university_slug', false);
  v_university_slug := NULLIF(BTRIM(v_meta->>'university_slug'), '');
  IF v_has_university_slug THEN
    SELECT u.id
      INTO v_university_id
      FROM public.universities AS u
     WHERE u.slug = v_university_slug
       AND u.is_active = TRUE;
  ELSE
    v_university_id := public.resolve_signup_university_id(v_email);
  END IF;

  v_pending := v_provider <> 'email'
    AND NOT (v_meta ? 'interests')
    AND NOT (v_meta ? 'activities')
    AND NOT EXISTS (SELECT 1 FROM public.user_interests WHERE user_id = v_user_id);
  v_agreed_to_terms := COALESCE(v_meta->>'agreed_to_terms' = 'true', false);

  INSERT INTO public.profiles (
    id, username, full_name, university_id, email_domain,
    picture_prompt_status, onboarding_completed, push_permission_prompt_pending,
    agreed_to_terms, agreed_at
  )
  VALUES (
    v_user_id,
    COALESCE(v_meta->>'username', 'user_' || LEFT(v_user_id::text, 8)) || '_' || LEFT(gen_random_uuid()::text, 4),
    CASE WHEN v_pending THEN '' ELSE COALESCE(v_meta->>'full_name', '') END,
    v_university_id,
    NULLIF(LOWER(SPLIT_PART(v_email, '@', 2)), ''),
    'pending', NOT v_pending, true,
    v_agreed_to_terms,
    CASE WHEN v_agreed_to_terms THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('weglue.profile_repair', 'on', true);
  UPDATE public.profiles
     SET university_id = v_university_id
   WHERE id = v_user_id
     AND university_id IS NULL
     AND v_university_id IS NOT NULL;
  PERFORM set_config('weglue.profile_repair', 'off', true);

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
  RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;

-- --------------------------------------------------------------------------
-- 3. Signed-in campus lookup
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_campus()
RETURNS TABLE (
  slug text,
  name text,
  email_mode text,
  email_domains text[],
  email_denied_message text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT u.slug,
         u.name,
         u.email_mode,
         u.email_domains,
         u.email_denied_message
    FROM public.profiles AS p
    JOIN public.universities AS u
      ON u.id = p.university_id
   WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.my_campus()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.my_campus()
  TO authenticated;

-- --------------------------------------------------------------------------
-- 4. Auth email-change enforcement
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_campus_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_university_id uuid;
BEGIN
  -- No campus means preserve the existing behavior for that account.
  SELECT p.university_id
    INTO v_university_id
    FROM public.profiles AS p
   WHERE p.id = NEW.id;

  IF v_university_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- GoTrue may first stage the new address in email_change and later copy it
  -- into email. Check both columns, but ignore the normal clearing of the
  -- pending value (NULL/blank) and unchanged values.
  IF NEW.email IS DISTINCT FROM OLD.email
     AND NULLIF(BTRIM(NEW.email), '') IS NOT NULL
     AND NOT public.campus_email_allowed(v_university_id, NEW.email) THEN
    RAISE EXCEPTION
      'Email change rejected: the address does not meet your campus email policy.';
  END IF;

  IF NEW.email_change IS DISTINCT FROM OLD.email_change
     AND NULLIF(BTRIM(NEW.email_change), '') IS NOT NULL
     AND NOT public.campus_email_allowed(v_university_id, NEW.email_change) THEN
    RAISE EXCEPTION
      'Email change rejected: the address does not meet your campus email policy.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_campus_email_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_auth_users_enforce_campus_email_change ON auth.users;
CREATE TRIGGER trg_auth_users_enforce_campus_email_change
  BEFORE UPDATE OF email, email_change ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_campus_email_change();

-- --------------------------------------------------------------------------
-- 5. Client immutability for profiles.university_id
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_client_campus_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_repair text := COALESCE(current_setting('weglue.profile_repair', true), '');
BEGIN
  IF NEW.university_id IS DISTINCT FROM OLD.university_id
     AND v_role <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role')
     AND v_repair <> 'on' THEN
    RAISE EXCEPTION
      'Profile campus is immutable; campus transfers are not supported.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_client_campus_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_profiles_university_id_immutable ON public.profiles;
CREATE TRIGGER trg_profiles_university_id_immutable
  BEFORE UPDATE OF university_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_client_campus_change();

-- --------------------------------------------------------------------------
-- 6. Campus-scoped preview, retaining the one-argument client contract
-- --------------------------------------------------------------------------
-- Keep NULL exactly equivalent to the pre-137 launch-campus call. A supplied
-- slug is resolved only to an active campus; an unknown/inactive slug fails
-- closed with a zero count rather than leaking another campus's clubs.
DROP FUNCTION IF EXISTS public.preview_club_match_count(text[]);

CREATE OR REPLACE FUNCTION public.preview_club_match_count(
  p_interests text[],
  p_university_slug text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_university_id uuid;
  v_natural int;
  v_eligible int;
BEGIN
  IF p_university_slug IS NULL THEN
    SELECT launch_university_id
      INTO v_university_id
      FROM public.app_config
     LIMIT 1;
  ELSE
    SELECT u.id
      INTO v_university_id
      FROM public.universities AS u
     WHERE u.slug = BTRIM(p_university_slug)
       AND u.is_active = TRUE;

    IF v_university_id IS NULL THEN
      RETURN 0;
    END IF;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE r.match_score > 0),
    COUNT(*)
    INTO v_natural, v_eligible
    FROM public.rank_eligible_clubs(NULL, v_university_id, p_interests) AS r;

  RETURN public.club_match_target_count(v_natural, v_eligible);
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_club_match_count(text[], text)
  TO anon, authenticated;

-- NULL-university rows are legacy launch-campus clubs. Keep them in the
-- launch pool, but never let them leak into a second campus's pool. This
-- preserves the ranking/scoring rules and makes the preview and signup batch
-- use the same campus boundary.
CREATE OR REPLACE FUNCTION public.rank_eligible_clubs(
  p_user_id uuid,
  p_university_id uuid,
  p_interests text[],
  p_limit int DEFAULT 12
)
RETURNS TABLE (club_id uuid, interest_overlap int, match_score int)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH v_ids AS (
    SELECT COALESCE(array_agg(i.id), ARRAY[]::uuid[]) AS ids
      FROM public.interests AS i
     WHERE i.is_active = true
       AND EXISTS (
         SELECT 1
           FROM unnest(COALESCE(p_interests, ARRAY[]::text[])) AS requested(label)
          WHERE lower(i.label) = lower(requested.label)
       )
  )
  SELECT
    c.id,
    (
      SELECT COUNT(DISTINCT ci.interest_id)::int
        FROM public.club_interests AS ci
       WHERE ci.club_id = c.id
         AND ci.interest_id = ANY(v_ids.ids)
    ) AS interest_overlap,
    COALESCE((
      SELECT SUM(
        CASE ci.tier
          WHEN 'primary' THEN 3
          WHEN 'secondary' THEN 1
          ELSE 0
        END
      )::int
        FROM public.club_interests AS ci
       WHERE ci.club_id = c.id
         AND ci.interest_id = ANY(v_ids.ids)
    ), 0) AS match_score
    FROM public.clubs AS c
    CROSS JOIN v_ids
   WHERE c.is_active = true
     AND (
       c.university_id IS NOT DISTINCT FROM p_university_id
       OR (
         c.university_id IS NULL
         AND p_university_id IS NOT DISTINCT FROM (
           SELECT ac.launch_university_id
             FROM public.app_config AS ac
            LIMIT 1
         )
       )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.club_members AS cm
        WHERE cm.club_id = c.id
          AND cm.user_id = p_user_id
     )
   ORDER BY match_score DESC, c.member_count DESC, c.name ASC
   LIMIT GREATEST(p_limit, 2);
$$;
