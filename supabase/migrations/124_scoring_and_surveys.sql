-- 124 — Weighted interest matching and catalog-driven survey writes.
-- Keeps the frozen recommendation contracts while scoring primary interests
-- 3x and secondary interests 1x, with no activity contribution.
-- Applies on prod ledger @ 121; see docs/interest-matching/.

-- PostgreSQL cannot change a table-returning function's OUT-column list with
-- CREATE OR REPLACE, so replace the old two-column definition atomically.
-- Claude: confirm on staging that this DROP succeeds without CASCADE; plpgsql
-- callers should not create a hard dependency, but this must be verified.
DROP FUNCTION IF EXISTS public.rank_eligible_clubs(uuid, uuid, text[], integer);

CREATE OR REPLACE FUNCTION public.rank_eligible_clubs(
  p_user_id       uuid,
  p_university_id uuid,
  p_interests     text[],
  p_limit         int DEFAULT 12
)
RETURNS TABLE (club_id uuid, interest_overlap int, match_score int)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH v_ids AS (
    SELECT COALESCE(array_agg(i.id), ARRAY[]::uuid[]) AS ids
    FROM public.interests i
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
      FROM public.club_interests ci
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
      FROM public.club_interests ci
      WHERE ci.club_id = c.id
        AND ci.interest_id = ANY(v_ids.ids)
    ), 0) AS match_score
  FROM public.clubs c
  CROSS JOIN v_ids
  WHERE c.is_active = true
    AND (
      c.university_id IS NOT DISTINCT FROM p_university_id
      OR c.university_id IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.club_members cm
      WHERE cm.club_id = c.id
        AND cm.user_id = p_user_id
    )
  ORDER BY match_score DESC, c.member_count DESC, c.name ASC
  LIMIT GREATEST(p_limit, 2);
$$;

REVOKE EXECUTE ON FUNCTION public.rank_eligible_clubs(uuid, uuid, text[], integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_club_recommendation_batch(
  p_user_id UUID,
  p_source  TEXT
)
RETURNS club_recommendation_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_university_id UUID;
  v_interests     TEXT[];
  v_natural       INT;
  v_eligible      INT;
  v_target        INT;
  v_club_ids      UUID[];
  v_batch         club_recommendation_batches;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT university_id INTO v_university_id FROM profiles WHERE id = p_user_id;

  SELECT COALESCE(ARRAY_AGG(itr.label), ARRAY[]::TEXT[])
  INTO   v_interests
  FROM   user_interests ui
  JOIN   interests itr ON itr.id = ui.interest_id AND itr.is_active
  WHERE  ui.user_id = p_user_id;

  SELECT
    COUNT(*) FILTER (WHERE r.match_score > 0),
    COUNT(*)
  INTO v_natural, v_eligible
  FROM rank_eligible_clubs(p_user_id, v_university_id, v_interests) r;

  v_target := club_match_target_count(v_natural, v_eligible);

  IF v_target < 1 THEN
    UPDATE club_recommendation_batches
    SET status = 'superseded', resolved_at = NOW()
    WHERE user_id = p_user_id AND status = 'active';
    RETURN NULL;
  END IF;

  SELECT ARRAY_AGG(t.club_id ORDER BY t.ord)
  INTO   v_club_ids
  FROM   (
    SELECT r.club_id, ROW_NUMBER() OVER () AS ord
    FROM   rank_eligible_clubs(p_user_id, v_university_id, v_interests) r
    LIMIT  v_target
  ) t;

  UPDATE club_recommendation_batches
  SET status = 'superseded', resolved_at = NOW()
  WHERE user_id = p_user_id AND status = 'active';

  INSERT INTO club_recommendation_batches (user_id, club_ids, match_count, source, status)
  VALUES (p_user_id, v_club_ids, COALESCE(ARRAY_LENGTH(v_club_ids, 1), 0), p_source, 'active')
  RETURNING * INTO v_batch;

  RETURN v_batch;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_club_recommendation_batch(uuid, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preview_club_match_count(p_interests TEXT[])
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_university_id UUID;
  v_natural       INT;
  v_eligible      INT;
BEGIN
  SELECT launch_university_id INTO v_university_id FROM app_config LIMIT 1;

  SELECT
    COUNT(*) FILTER (WHERE r.match_score > 0),
    COUNT(*)
  INTO v_natural, v_eligible
  FROM rank_eligible_clubs(NULL, v_university_id, p_interests) r;

  RETURN club_match_target_count(v_natural, v_eligible);
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_club_match_count(TEXT[])
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_club_recommendations()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user_id       UUID := auth.uid();
  v_batch         club_recommendation_batches;
  v_university_id UUID;
  v_interests     TEXT[];
  v_valid         UUID[];
  v_final         UUID[];
  v_clubs         JSONB;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_batch
  FROM club_recommendation_batches
  WHERE user_id = v_user_id AND status = 'active'
  LIMIT 1;

  IF v_batch.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT university_id INTO v_university_id FROM profiles WHERE id = v_user_id;

  SELECT COALESCE(ARRAY_AGG(x.id ORDER BY x.ord), ARRAY[]::UUID[])
  INTO   v_valid
  FROM (
    SELECT c.id, o.ord
    FROM UNNEST(v_batch.club_ids) WITH ORDINALITY AS o(id, ord)
    JOIN clubs c ON c.id = o.id
    WHERE c.is_active = true
      AND (
        c.university_id IS NOT DISTINCT FROM v_university_id
        OR c.university_id IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM club_members cm
        WHERE cm.club_id = c.id AND cm.user_id = v_user_id
      )
  ) x;

  v_final := v_valid;

  IF COALESCE(ARRAY_LENGTH(v_final, 1), 0) < v_batch.match_count THEN
    SELECT COALESCE(ARRAY_AGG(itr.label), ARRAY[]::TEXT[])
    INTO   v_interests
    FROM   user_interests ui
    JOIN   interests itr ON itr.id = ui.interest_id AND itr.is_active
    WHERE  ui.user_id = v_user_id;

    SELECT v_final || COALESCE(ARRAY_AGG(t.club_id ORDER BY t.ord), ARRAY[]::UUID[])
    INTO   v_final
    FROM (
      SELECT r.club_id, ROW_NUMBER() OVER () AS ord
      FROM   rank_eligible_clubs(v_user_id, v_university_id, v_interests) r
      WHERE  NOT (r.club_id = ANY(v_final))
      LIMIT  GREATEST(v_batch.match_count - COALESCE(ARRAY_LENGTH(v_final, 1), 0), 0)
    ) t;
  END IF;

  IF COALESCE(ARRAY_LENGTH(v_final, 1), 0) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT JSONB_AGG(
           JSONB_BUILD_OBJECT(
             'id',         c.id,
             'name',       c.name,
             'avatar_url', c.avatar_url,
             'cover_image_url', c.cover_image_url
           ) ORDER BY o.ord
         )
  INTO   v_clubs
  FROM   UNNEST(v_final) WITH ORDINALITY AS o(id, ord)
  JOIN   clubs c ON c.id = o.id;

  RETURN JSONB_BUILD_OBJECT(
    'batch_id', v_batch.id,
    'count',    COALESCE(JSONB_ARRAY_LENGTH(v_clubs), 0),
    'source',   v_batch.source,
    'clubs',    v_clubs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_club_recommendations()
  TO authenticated;

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
  v_avatar_choice_type text;
  v_avatar_choice_value text;
  v_avatar_url text;
  v_picture_prompt_status text;
BEGIN
  IF public.is_platform_admin_auth(NEW.raw_app_meta_data) THEN
    RETURN NEW;
  END IF;

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
    v_university_id := resolve_signup_university_id(NEW.email);
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
      PERFORM generate_club_recommendation_batch(NEW.id, 'onboarding');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: batch generation failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_signup_survey(p_user_id uuid)
RETURNS TABLE (interests_added integer, activities_added integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb;
  v_i integer := 0;
  v_a integer := 0;
BEGIN
  SELECT raw_user_meta_data INTO v_meta FROM auth.users WHERE id = p_user_id;
  IF v_meta IS NULL THEN
    interests_added := 0; activities_added := 0; RETURN NEXT; RETURN;
  END IF;

  BEGIN
    WITH ins AS (
      INSERT INTO public.user_interests (user_id, interest, interest_id)
      SELECT p_user_id, itr.label, itr.id
      FROM jsonb_array_elements_text(COALESCE(v_meta->'interests', '[]'::jsonb)) AS raw
      JOIN public.interests itr
        ON lower(itr.label) = lower(raw)
       AND itr.is_active
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_i FROM ins;

    WITH ins AS (
      INSERT INTO public.user_activities (user_id, activity)
      SELECT p_user_id, value
      FROM jsonb_array_elements_text(COALESCE(v_meta->'activities', '[]'::jsonb)) AS value
      WHERE value IN (
        'Projects', 'Volunteering', 'Workshops', 'Campus Fairs', 'Trips',
        'Study Groups', 'Networking', 'Tournaments', 'Social Events', 'Campus Tours'
      )
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_a FROM ins;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'reconcile_signup_survey insert failed for %: %', p_user_id, SQLERRM;
  END;

  interests_added := v_i; activities_added := v_a; RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_signup_survey(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_recent_signup_surveys(interval, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_my_signup_survey()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_my_signup_survey()
  TO authenticated;

DO $$
BEGIN
  RAISE NOTICE '124 ok';
END
$$;
