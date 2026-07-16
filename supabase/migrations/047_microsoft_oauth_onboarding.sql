-- ============================================================
-- We Glue – Microsoft (Azure) OAuth onboarding integration
-- Migration: 047_microsoft_oauth_onboarding.sql
--
-- Password signups carry the survey answers + explicit username in their OWN
-- signup metadata, so handle_new_user (042/043) can materialize everything at
-- creation time. An OAuth signup carries NOTHING chosen in the app — the
-- provider controls the metadata — so a brand-new Microsoft user must not be
-- minted as a "complete" account with an auto-generated username and an
-- interest-less recommendation batch.
--
-- This migration:
--   A. Teaches handle_new_user to mark provider signups that carry no survey
--      metadata as onboarding_completed = false and to DEFER batch generation
--      (the batch is generated exactly once, from real interests, in C).
--   B. Keeps ensure_profile's repair path consistent with that rule.
--   C. Adds complete_oauth_onboarding(): the server-authoritative, idempotent
--      completion step — verified-email + .edu eligibility re-checked, the
--      explicit username validated for uniqueness, surveys persisted, the
--      initial recommendation batch generated, onboarding_completed flipped.
--
-- Eligibility remains PRIMARILY enforced by the before_user_created auth hook
-- (008, enabled in production), which rejects ineligible emails BEFORE any
-- auth.users row exists — for OAuth exactly as for password signups, so an
-- ineligible personal Microsoft account never becomes a ghost user. The check
-- in C is the defense-in-depth backstop on the completion path.
--
-- NOTE: never RAISE inside an auth.users trigger — GoTrue masks it as an
-- opaque 500 and every signup breaks. Every trigger block stays
-- exception-guarded (unchanged from 042).
-- ============================================================

-- ============================================================
-- PART A — handle_new_user: OAuth-aware creation
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_university_id UUID;
  v_email_domain  TEXT;
  v_interests     TEXT[];
  v_activities    TEXT[];
  v_provider      TEXT;
  v_oauth_pending BOOLEAN;
BEGIN
  -- 'email' for password signups. Anything else (azure, …) is an OAuth
  -- provider. A provider signup with no survey metadata has not been through
  -- We Glue onboarding: it gets a placeholder profile, no recommendation
  -- batch, and onboarding_completed = false until complete_oauth_onboarding.
  v_provider      := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  v_oauth_pending := v_provider <> 'email'
                     AND NOT (NEW.raw_user_meta_data ? 'interests')
                     AND NOT (NEW.raw_user_meta_data ? 'activities');

  BEGIN
    v_university_id := resolve_signup_university_id(NEW.email);
    v_email_domain  := NULLIF(LOWER(SPLIT_PART(NEW.email, '@', 2)), '');

    INSERT INTO public.profiles (
      id, username, full_name, university_id, email_domain,
      picture_prompt_status, onboarding_completed
    )
    VALUES (
      NEW.id,
      -- OAuth metadata never carries a We Glue username; the placeholder is
      -- replaced by the user's explicit choice during onboarding completion.
      COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::text, 8)),
      -- The Microsoft display name is deliberately NOT adopted: full_name is
      -- set from the explicit username at completion, same as password signup.
      CASE WHEN v_oauth_pending THEN ''
           ELSE COALESCE(NEW.raw_user_meta_data->>'full_name', '') END,
      v_university_id,
      v_email_domain,
      -- Genuinely new account with no picture yet → show the Home prompt once.
      'pending',
      NOT v_oauth_pending
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
  END;

  -- Survey answers chosen before the account existed (password signups only —
  -- an OAuth-pending signup has none, and its inserts below are empty no-ops).
  BEGIN
    SELECT COALESCE(ARRAY_AGG(value::TEXT), ARRAY[]::TEXT[])
    INTO   v_interests
    FROM   JSONB_ARRAY_ELEMENTS_TEXT(
             COALESCE(NEW.raw_user_meta_data->'interests', '[]'::JSONB)
           ) AS value;

    SELECT COALESCE(ARRAY_AGG(value::TEXT), ARRAY[]::TEXT[])
    INTO   v_activities
    FROM   JSONB_ARRAY_ELEMENTS_TEXT(
             COALESCE(NEW.raw_user_meta_data->'activities', '[]'::JSONB)
           ) AS value;

    -- Insert only values the CHECK constraints accept. A junk value from a
    -- tampered client is dropped instead of raising (which would 500 signup).
    INSERT INTO public.user_interests (user_id, interest)
    SELECT NEW.id, i
    FROM   UNNEST(v_interests) AS i
    WHERE  i IN (
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
    FROM   UNNEST(v_activities) AS a
    WHERE  a IN (
      'Projects', 'Volunteering', 'Workshops', 'Campus Fairs',
      'Trips', 'Study Groups', 'Networking', 'Tournaments',
      'Social Events', 'Campus Tours'
    )
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: survey insert failed for %: %', NEW.id, SQLERRM;
  END;

  -- The recommendation batch the user will see on Home. Deferred for an
  -- OAuth-pending signup: generating it here would rank on ZERO interests and
  -- complete_oauth_onboarding would immediately supersede it — the batch the
  -- user saw counted on the signup screen is the one generated there instead.
  IF NOT v_oauth_pending THEN
    BEGIN
      PERFORM generate_club_recommendation_batch(NEW.id, 'onboarding');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: batch generation failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged (exactly one, from 043) — recreating the
-- function above is enough.

-- ============================================================
-- PART B — ensure_profile: repairs respect OAuth-pending onboarding
-- ============================================================

CREATE OR REPLACE FUNCTION ensure_profile()
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_email    TEXT;
  v_meta     JSONB;
  v_provider TEXT;
  v_pending  BOOLEAN;
  v_profile  profiles;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT email, raw_user_meta_data, COALESCE(raw_app_meta_data->>'provider', 'email')
  INTO v_email, v_meta, v_provider
  FROM auth.users WHERE id = v_user_id;

  -- Same rule as handle_new_user: an OAuth account that has never been
  -- through onboarding (no survey metadata, no persisted interests) must not
  -- be repaired into a "complete" account.
  v_pending := v_provider <> 'email'
               AND NOT (v_meta ? 'interests')
               AND NOT (v_meta ? 'activities')
               AND NOT EXISTS (
                 SELECT 1 FROM user_interests WHERE user_id = v_user_id
               );

  INSERT INTO profiles (
    id, username, full_name, university_id, email_domain,
    picture_prompt_status, onboarding_completed
  )
  VALUES (
    v_user_id,
    COALESCE(v_meta->>'username', 'user_' || LEFT(v_user_id::TEXT, 8)) || '_' || LEFT(gen_random_uuid()::TEXT, 4),
    CASE WHEN v_pending THEN '' ELSE COALESCE(v_meta->>'full_name', '') END,
    resolve_signup_university_id(v_email),
    NULLIF(LOWER(SPLIT_PART(v_email, '@', 2)), ''),
    'pending',
    NOT v_pending
  )
  ON CONFLICT (id) DO NOTHING;

  -- Existing row missing a campus (pre-042 account) — heal it.
  UPDATE profiles
  SET university_id = resolve_signup_university_id(v_email)
  WHERE id = v_user_id AND university_id IS NULL;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_profile() TO authenticated;

-- ============================================================
-- PART C — complete_oauth_onboarding: the one completion path
-- ============================================================

-- Called by the app after Microsoft OAuth once the user has been through
-- Interests → Activities and chosen an explicit username. Idempotent and
-- self-serializing: a double tap, a replayed callback, or two racing calls
-- produce exactly one username, one survey set, one recommendation batch.
--
-- Identity comes ONLY from auth.uid(). Statuses come back as data (not
-- exceptions) so the app can render friendly inline errors.
CREATE OR REPLACE FUNCTION complete_oauth_onboarding(
  p_username   TEXT,
  p_interests  TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_activities TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_email     TEXT;
  v_confirmed TIMESTAMPTZ;
  v_username  TEXT;
  v_profile   profiles;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  -- Serialize per user (same lock the batch generator uses) so concurrent
  -- completion attempts cannot interleave.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::TEXT, 0));

  SELECT email, email_confirmed_at
  INTO   v_email, v_confirmed
  FROM   auth.users WHERE id = v_uid;

  -- Server-authoritative gates. The before_user_created hook (008) already
  -- rejected ineligible emails at creation; these are the backstop so a
  -- misconfigured provider or disabled hook still cannot mint a usable
  -- account from an unverified or non-school identity.
  IF v_confirmed IS NULL THEN
    RETURN jsonb_build_object('status', 'email_unverified');
  END IF;
  IF v_email IS NULL OR NOT public.is_educational_email(v_email) THEN
    RETURN jsonb_build_object('status', 'not_eligible');
  END IF;

  -- Missing profile row (trigger lost a race / historical account) — repair
  -- it as ONBOARDING-PENDING so the completion below runs on a real row.
  INSERT INTO profiles (
    id, username, full_name, university_id, email_domain,
    picture_prompt_status, onboarding_completed
  )
  VALUES (
    v_uid,
    'user_' || LEFT(v_uid::TEXT, 8) || '_' || LEFT(gen_random_uuid()::TEXT, 4),
    '',
    resolve_signup_university_id(v_email),
    NULLIF(LOWER(SPLIT_PART(v_email, '@', 2)), ''),
    'pending',
    false
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;

  -- Completed accounts are untouchable here: an EXISTING user who taps
  -- "Continue with Microsoft" on the signup screen keeps their username,
  -- display name, surveys, batches — nothing is overwritten, ever.
  IF v_profile.onboarding_completed THEN
    RETURN jsonb_build_object(
      'status', 'already_completed',
      'profile', to_jsonb(v_profile)
    );
  END IF;

  -- The username is the user's explicit choice — required, never derived
  -- from the Microsoft email prefix or provider display name.
  v_username := NULLIF(REGEXP_REPLACE(TRIM(COALESCE(p_username, '')), '^@', ''), '');
  IF v_username IS NULL OR LENGTH(v_username) > 60 THEN
    RETURN jsonb_build_object('status', 'username_invalid');
  END IF;
  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE LOWER(username) = LOWER(v_username) AND id <> v_uid
  ) THEN
    RETURN jsonb_build_object('status', 'username_taken');
  END IF;

  BEGIN
    UPDATE profiles
    SET username             = v_username,
        -- Same rule as password signup: display name starts as the username.
        full_name            = v_username,
        university_id        = COALESCE(university_id, resolve_signup_university_id(v_email)),
        email_domain         = COALESCE(email_domain, NULLIF(LOWER(SPLIT_PART(v_email, '@', 2)), '')),
        onboarding_completed = true
    WHERE id = v_uid;
  EXCEPTION WHEN unique_violation THEN
    -- Race with another signup claiming the same username between the check
    -- above and this write — surface it exactly like the check would have.
    RETURN jsonb_build_object('status', 'username_taken');
  END;

  -- Survey answers — same allowlists the signup trigger enforces (042); junk
  -- from a tampered client is dropped, never raised.
  INSERT INTO user_interests (user_id, interest)
  SELECT v_uid, i
  FROM   UNNEST(COALESCE(p_interests, ARRAY[]::TEXT[])) AS i
  WHERE  i IN (
    'Finance & Business', 'Social Events', 'Music', 'Fashion',
    'Art & Culture', 'Social Justice & Activism', 'Numbers & Economics',
    'Gaming', 'Health & Wellness', 'Environment', 'Sports & Athletics',
    'Community Service', 'Crafts', 'Religion', 'Technology and Computer',
    'Film & Media', 'Photography', 'Strategy and Critical Thinking',
    'Writing', 'Theater', 'Travel & Languages', 'Debate & Politics'
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO user_activities (user_id, activity)
  SELECT v_uid, a
  FROM   UNNEST(COALESCE(p_activities, ARRAY[]::TEXT[])) AS a
  WHERE  a IN (
    'Projects', 'Volunteering', 'Workshops', 'Campus Fairs',
    'Trips', 'Study Groups', 'Networking', 'Tournaments',
    'Social Events', 'Campus Tours'
  )
  ON CONFLICT DO NOTHING;

  -- The initial batch, generated exactly once from the real interests
  -- (handle_new_user deliberately skipped it for this account). The
  -- generator itself supersedes any stray active batch, so retries and
  -- races cannot leave two active ones.
  PERFORM generate_club_recommendation_batch(v_uid, 'onboarding');

  SELECT * INTO v_profile FROM profiles WHERE id = v_uid;
  RETURN jsonb_build_object(
    'status', 'completed',
    'profile', to_jsonb(v_profile)
  );
END;
$$;

REVOKE ALL ON FUNCTION complete_oauth_onboarding(TEXT, TEXT[], TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_oauth_onboarding(TEXT, TEXT[], TEXT[]) TO authenticated;
