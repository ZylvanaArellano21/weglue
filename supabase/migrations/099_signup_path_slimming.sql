-- ============================================================================
-- 099 — Signup path slimming and post-signup reliability
--
-- A. Do not rank/insert club recommendations from the auth.users INSERT
--    trigger. The canonical reader lazily creates the first batch for a
--    verified, onboarding-complete user, after GoTrue's signup/confirmation
--    work is complete. The reader never recreates a dismissed, completed, or
--    superseded batch.
--
-- B. A student_joined event is created only when all three conditions are true:
--      auth.users.email_confirmed_at IS NOT NULL
--      profiles.onboarding_completed = true
--      profiles.university_id IS NOT NULL
--    The event is inserted on the relevant transition, not during an ordinary
--    unverified email signup. Processing fans out only to the actor's
--    university. A partial unique index makes the one-event rule
--    database-enforced and ON CONFLICT makes retries harmless.
--
-- C. Index the cleanup predicate used by auth_signup_status(). This is a
--    micro-optimization only: the table normally contains at most a few
--    hundred distinct IPs, so it is not a burst-capacity fix.
--
-- No pg_cron job is added here. Recommendation creation uses the canonical
-- reader's synchronous RPC repair path if confirmation/onboarding work was
-- interrupted or a historical row is missing.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- C. The shared probe table is cleaned by window_start on every status call.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_auth_probe_rate_limits_window_start
  ON public.auth_probe_rate_limits (window_start);

-- ----------------------------------------------------------------------------
-- A. Remove the expensive recommendation work from the auth.users INSERT
-- trigger. Everything before the old generator call remains the same so the
-- profile and survey materialization contract is unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Deliberately no recommendation generation here. This is the auth.users
  -- INSERT transaction owned by GoTrue; generation occurs after confirmation
  -- or from the verified onboarding-completion/read-repair paths below.
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- B. One durable, deduplicated event per student_joined actor.
-- ----------------------------------------------------------------------------
-- Remove rows produced by the pre-099 profile trigger for users who are not
-- currently eligible for social proof. This both stops queued abandoned
-- signups from being fanned out and lets a later valid transition create the
-- user's one event. Already-created notifications are not retroactively
-- removed. Rows whose actor has no university are also ineligible.
DELETE FROM public.social_proof_events AS e
WHERE e.processed = false
  AND NOT EXISTS (
  SELECT 1
  FROM auth.users AS u
  JOIN public.profiles AS p ON p.id = u.id
  WHERE u.id = e.actor_id
    AND u.email_confirmed_at IS NOT NULL
    AND p.onboarding_completed IS TRUE
    AND p.university_id IS NOT NULL
    AND COALESCE(p.is_seed, false) = false
);

-- Keep the oldest valid row if a prior retry already produced duplicates.
-- The unique index below then enforces the invariant for all future retries.
DELETE FROM public.social_proof_events AS duplicate
WHERE duplicate.id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY actor_id ORDER BY created_at, id) AS occurrence
    FROM public.social_proof_events
    WHERE kind = 'student_joined'
  ) AS ranked
  WHERE ranked.occurrence > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_proof_student_joined_actor
  ON public.social_proof_events (actor_id)
  WHERE kind = 'student_joined';

CREATE OR REPLACE FUNCTION public.maybe_enqueue_student_joined(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.social_proof_events (kind, actor_id)
  SELECT 'student_joined', p.id
  FROM public.profiles AS p
  JOIN auth.users AS u ON u.id = p.id
  WHERE p.id = p_user_id
    AND COALESCE(p.is_seed, false) = false
    AND p.onboarding_completed IS TRUE
    AND p.university_id IS NOT NULL
    AND u.email_confirmed_at IS NOT NULL
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  -- Social proof is an outbox concern and must never block auth or onboarding.
  RAISE WARNING 'maybe_enqueue_student_joined failed for %: %', p_user_id, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.maybe_enqueue_student_joined(uuid)
  FROM PUBLIC, anon, authenticated;

-- Keep the existing trigger name and trigger timing, but gate its outbox
-- insert. For the normal password signup this performs a cheap eligibility
-- check and inserts nothing because email_confirmed_at is still NULL.
CREATE OR REPLACE FUNCTION public.handle_profile_created_social_proof()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.maybe_enqueue_student_joined(NEW.id);
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- B. The auth.users UPDATE trigger handles email confirmation only for the
-- social-proof edge. Recommendation generation stays completely off GoTrue's
-- pool and is performed by the lazy reader below.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_pending_profile_meta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
BEGIN
  IF NEW.email_confirmed_at IS NULL
     AND (NEW.raw_user_meta_data->>'username') IS DISTINCT FROM (OLD.raw_user_meta_data->>'username')
  THEN
    v_username := NULLIF(trim(NEW.raw_user_meta_data->>'username'), '');
    IF v_username IS NOT NULL THEN
      BEGIN
        UPDATE public.profiles
        SET username  = v_username,
            full_name = COALESCE(NEW.raw_user_meta_data->>'full_name', full_name)
        WHERE id = NEW.id;
      EXCEPTION WHEN OTHERS THEN
        -- unique_violation etc. — the signup status probe blocks taken
        -- usernames up front; never block the auth.users write here.
        RAISE WARNING 'sync_pending_profile_meta: skipped for %: %', NEW.id, SQLERRM;
      END;
    END IF;
  END IF;

  IF NEW.email_confirmed_at IS NOT NULL
     AND OLD.email_confirmed_at IS NULL
  THEN
    -- The profile trigger ran before confirmation and intentionally did not
    -- create social proof. This is the first point where both gates can hold
    -- for a password signup.
    PERFORM public.maybe_enqueue_student_joined(NEW.id);

  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- A. Lazy repair in the canonical reader.
--
-- This is deliberately limited to users with NO recommendation row at all.
-- It therefore preserves the existing meaning of NULL for dismissed,
-- completed, and superseded batches.
-- ----------------------------------------------------------------------------
-- Returns the active batch with its clubs resolved. If a stored club was
-- deleted, deactivated, or already joined since batch creation, it is dropped
-- and replaced from the ranked fallback pool so the original match count is
-- preserved whenever enough eligible clubs still exist.
CREATE OR REPLACE FUNCTION public.get_my_club_recommendations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_user_id       uuid := auth.uid();
  v_batch         public.club_recommendation_batches;
  v_university_id uuid;
  v_interests     text[];
  v_valid         uuid[];
  v_final         uuid[];
  v_clubs         jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_batch
  FROM public.club_recommendation_batches
  WHERE user_id = v_user_id AND status = 'active'
  LIMIT 1;

  IF v_batch.id IS NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.club_recommendation_batches AS prior
       WHERE prior.user_id = v_user_id
     )
     AND EXISTS (
       SELECT 1
       FROM auth.users AS u
       JOIN public.profiles AS p ON p.id = u.id
       WHERE u.id = v_user_id
         AND u.email_confirmed_at IS NOT NULL
         AND p.onboarding_completed IS TRUE
     )
  THEN
    -- generate_club_recommendation_batch() takes the per-user advisory
    -- transaction lock and preserves the floor-of-2 target via
    -- club_match_target_count().
    SELECT * INTO v_batch
    FROM public.generate_club_recommendation_batch(v_user_id, 'onboarding');
  END IF;

  IF v_batch.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT university_id INTO v_university_id
  FROM public.profiles
  WHERE id = v_user_id;

  SELECT COALESCE(ARRAY_AGG(x.id ORDER BY x.ord), ARRAY[]::uuid[])
  INTO   v_valid
  FROM (
    SELECT c.id, o.ord
    FROM UNNEST(v_batch.club_ids) WITH ORDINALITY AS o(id, ord)
    JOIN public.clubs AS c ON c.id = o.id
    WHERE c.is_active = true
      AND (
        c.university_id IS NOT DISTINCT FROM v_university_id
        OR c.university_id IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.club_members AS cm
        WHERE cm.club_id = c.id AND cm.user_id = v_user_id
      )
  ) AS x;

  v_final := v_valid;

  IF COALESCE(ARRAY_LENGTH(v_final, 1), 0) < v_batch.match_count THEN
    SELECT COALESCE(ARRAY_AGG(ui.interest), ARRAY[]::text[])
    INTO   v_interests
    FROM public.user_interests AS ui
    WHERE ui.user_id = v_user_id;

    SELECT v_final || COALESCE(ARRAY_AGG(t.club_id ORDER BY t.ord), ARRAY[]::uuid[])
    INTO   v_final
    FROM (
      SELECT r.club_id, ROW_NUMBER() OVER () AS ord
      FROM public.rank_eligible_clubs(v_user_id, v_university_id, v_interests) AS r
      WHERE NOT (r.club_id = ANY(v_final))
      LIMIT GREATEST(v_batch.match_count - COALESCE(ARRAY_LENGTH(v_final, 1), 0), 0)
    ) AS t;
  END IF;

  IF COALESCE(ARRAY_LENGTH(v_final, 1), 0) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT JSONB_AGG(
           JSONB_BUILD_OBJECT(
             'id', c.id,
             'name', c.name,
             'avatar_url', c.avatar_url,
             'cover_image_url', c.cover_image_url
           ) ORDER BY o.ord
         )
  INTO v_clubs
  FROM UNNEST(v_final) WITH ORDINALITY AS o(id, ord)
  JOIN public.clubs AS c ON c.id = o.id;

  RETURN JSONB_BUILD_OBJECT(
    'batch_id', v_batch.id,
    'count', COALESCE(JSONB_ARRAY_LENGTH(v_clubs), 0),
    'source', v_batch.source,
    'clubs', v_clubs
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- B. Fan out the queued event asynchronously, but only within the actor's
-- university. The actor's university is resolved once per event. A NULL
-- university is a defensive skip for any historical/in-flight row that was
-- created before the helper's non-NULL gate above; it is still marked
-- processed and can never fan out globally.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_social_proof_events()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event               RECORD;
  v_name                TEXT;
  v_actor_university_id UUID;
  v_count               INT := 0;
BEGIN
  FOR v_event IN
    SELECT * FROM public.social_proof_events
    WHERE processed = false AND created_at > now() - interval '2 days'
    ORDER BY created_at
    LIMIT 50
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT p.university_id,
           COALESCE(NULLIF(p.full_name, ''), p.username)
      INTO v_actor_university_id, v_name
    FROM public.profiles AS p
    WHERE p.id = v_event.actor_id;

    IF v_actor_university_id IS NOT NULL AND v_name IS NOT NULL THEN
      -- Daily-grouped, push-disabled (registry): the inbox feels alive
      -- without a push per signup. The BEFORE-INSERT trigger merges these
      -- into the named format (grouped_notification_message, PART B) per
      -- recipient once a second student joins within the group window.
      -- 085: "[Name] joined We Glue 🎉" — exact founder template.
      INSERT INTO public.notifications (
        user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key
      )
      SELECT p.id,
             v_event.actor_id,
             'student_joined',
             NULL,
             NULL,
             false,
             v_name || ' joined We Glue 🎉',
             'student_joined:' || v_event.actor_id::text || ':' || p.id::text
      FROM public.profiles AS p
      WHERE p.id <> v_event.actor_id
        AND COALESCE(p.is_seed, false) = false
        AND p.university_id = v_actor_university_id
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END IF;

    UPDATE public.social_proof_events
    SET processed = true
    WHERE id = v_event.id;
    v_count := v_count + 1;
  END LOOP;

  -- Housekeeping: anything older than the freshness window is stale noise.
  UPDATE public.social_proof_events
  SET processed = true
  WHERE processed = false AND created_at <= now() - interval '2 days';

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.process_social_proof_events() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- ROLLBACK NOTES — this repo never runs migration down.
--
-- A future NNN_revert_099.sql would:
--   -- The existing auth.users trigger remains bound to the replaced function.
--   DROP FUNCTION IF EXISTS public.maybe_enqueue_student_joined(uuid);
--   DROP INDEX IF EXISTS public.uq_social_proof_student_joined_actor;
--   DROP INDEX IF EXISTS public.idx_auth_probe_rate_limits_window_start;
--   CREATE OR REPLACE FUNCTION public.handle_new_user() ...;
--   CREATE OR REPLACE FUNCTION public.handle_profile_created_social_proof() ...;
--   CREATE OR REPLACE FUNCTION public.sync_pending_profile_meta() ...;
--   CREATE OR REPLACE FUNCTION public.get_my_club_recommendations() ...;
--   CREATE OR REPLACE FUNCTION public.process_social_proof_events() ...;
--
-- The exact pre-099 function bodies are preserved below. Strip the SQL-comment
-- marker from each statement when assembling the revert file. Rollback cannot
-- restore invalid pre-099 outbox rows removed by the cleanup above; any
-- already-fanned-out notification is intentionally left intact.
-- ============================================================================

/*
-- OLD public.handle_new_user() from 098_onboarding_profile_picture.sql
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

-- OLD public.handle_profile_created_social_proof() from 046/085
CREATE OR REPLACE FUNCTION public.handle_profile_created_social_proof()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NOT COALESCE(NEW.is_seed, false) THEN
      INSERT INTO social_proof_events (kind, actor_id) VALUES ('student_joined', NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_profile_created_social_proof failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- OLD public.sync_pending_profile_meta() from 027
CREATE OR REPLACE FUNCTION public.sync_pending_profile_meta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
BEGIN
  IF NEW.email_confirmed_at IS NULL
     AND (NEW.raw_user_meta_data->>'username') IS DISTINCT FROM (OLD.raw_user_meta_data->>'username')
  THEN
    v_username := NULLIF(trim(NEW.raw_user_meta_data->>'username'), '');
    IF v_username IS NOT NULL THEN
      BEGIN
        UPDATE public.profiles
        SET username  = v_username,
            full_name = COALESCE(NEW.raw_user_meta_data->>'full_name', full_name)
        WHERE id = NEW.id;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'sync_pending_profile_meta: skipped for %: %', NEW.id, SQLERRM;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- OLD public.process_social_proof_events() from 085_student_joined_named_copy.sql
CREATE OR REPLACE FUNCTION public.process_social_proof_events()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event  RECORD;
  v_name   TEXT;
  v_count  INT := 0;
BEGIN
  FOR v_event IN
    SELECT * FROM social_proof_events
    WHERE processed = false AND created_at > now() - interval '2 days'
    ORDER BY created_at
    LIMIT 50
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT COALESCE(NULLIF(full_name, ''), username) INTO v_name
    FROM profiles WHERE id = v_event.actor_id;

    IF v_name IS NOT NULL THEN
      -- Daily-grouped, push-disabled (registry): the inbox feels alive
      -- without a push per signup. The BEFORE-INSERT trigger merges these
      -- into the named format (grouped_notification_message, PART B) per
      -- recipient once a second student joins within the group window.
      -- 085: "[Name] joined We Glue 🎉" — exact founder template.
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
      SELECT p.id, v_event.actor_id, 'student_joined', NULL, NULL, false,
             v_name || ' joined We Glue 🎉'
      FROM profiles p
      WHERE p.id <> v_event.actor_id AND COALESCE(p.is_seed, false) = false;
    END IF;

    UPDATE social_proof_events SET processed = true WHERE id = v_event.id;
    v_count := v_count + 1;
  END LOOP;

  -- Housekeeping: anything older than the freshness window is stale noise.
  UPDATE social_proof_events SET processed = true
  WHERE processed = false AND created_at <= now() - interval '2 days';

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION process_social_proof_events() FROM PUBLIC, anon, authenticated;

-- OLD public.get_my_club_recommendations() from 087
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
  IF v_user_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_batch FROM club_recommendation_batches
  WHERE user_id = v_user_id AND status = 'active' LIMIT 1;
  IF v_batch.id IS NULL THEN RETURN NULL; END IF;
  SELECT university_id INTO v_university_id FROM profiles WHERE id = v_user_id;
  SELECT COALESCE(ARRAY_AGG(x.id ORDER BY x.ord), ARRAY[]::UUID[]) INTO v_valid
  FROM (
    SELECT c.id, o.ord
    FROM UNNEST(v_batch.club_ids) WITH ORDINALITY AS o(id, ord)
    JOIN clubs c ON c.id = o.id
    WHERE c.is_active = true
      AND (c.university_id IS NOT DISTINCT FROM v_university_id OR c.university_id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM club_members cm WHERE cm.club_id = c.id AND cm.user_id = v_user_id)
  ) x;
  v_final := v_valid;
  IF COALESCE(ARRAY_LENGTH(v_final, 1), 0) < v_batch.match_count THEN
    SELECT COALESCE(ARRAY_AGG(ui.interest), ARRAY[]::TEXT[]) INTO v_interests
    FROM user_interests ui WHERE ui.user_id = v_user_id;
    SELECT v_final || COALESCE(ARRAY_AGG(t.club_id ORDER BY t.ord), ARRAY[]::UUID[]) INTO v_final
    FROM (
      SELECT r.club_id, ROW_NUMBER() OVER () AS ord
      FROM rank_eligible_clubs(v_user_id, v_university_id, v_interests) r
      WHERE NOT (r.club_id = ANY(v_final)
      )
      LIMIT GREATEST(v_batch.match_count - COALESCE(ARRAY_LENGTH(v_final, 1), 0), 0)
    ) t;
  END IF;
  IF COALESCE(ARRAY_LENGTH(v_final, 1), 0) = 0 THEN RETURN NULL; END IF;
  SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
           'id', c.id, 'name', c.name, 'avatar_url', c.avatar_url,
           'cover_image_url', c.cover_image_url) ORDER BY o.ord) INTO v_clubs
  FROM UNNEST(v_final) WITH ORDINALITY AS o(id, ord) JOIN clubs c ON c.id = o.id;
  RETURN JSONB_BUILD_OBJECT('batch_id', v_batch.id,
    'count', COALESCE(JSONB_ARRAY_LENGTH(v_clubs), 0),
    'source', v_batch.source, 'clubs', v_clubs);
END;
$$;

*/
