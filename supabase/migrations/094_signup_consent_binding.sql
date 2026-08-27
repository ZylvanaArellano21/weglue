-- 094_signup_consent_binding.sql
--
-- Signup consent must be bound to the auth.users row created by GoTrue. The
-- old web server action accepted an arbitrary profile UUID and used the
-- service role without proving ownership of that UUID.
--
-- This preserves the current 047 signup trigger behavior and records consent
-- only while inserting the profile for NEW.id. Existing profiles are never
-- updated by this migration.

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
  v_agreed_to_terms BOOLEAN;
BEGIN
  -- 'email' for password signups. Anything else (azure, …) is an OAuth
  -- provider. A provider signup with no survey metadata has not been through
  -- We Glue onboarding: it gets a placeholder profile, no recommendation
  -- batch, and onboarding_completed = false until complete_oauth_onboarding.
  v_provider      := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  v_oauth_pending := v_provider <> 'email'
                     AND NOT (NEW.raw_user_meta_data ? 'interests')
                     AND NOT (NEW.raw_user_meta_data ? 'activities');

  -- This is an assertion from this signup request, but the target identity is
  -- always NEW.id supplied by Auth. A malformed/tampered value is treated as
  -- false and can never redirect the write to another profile.
  v_agreed_to_terms := NEW.raw_user_meta_data->>'agreed_to_terms' = 'true';

  BEGIN
    v_university_id := resolve_signup_university_id(NEW.email);
    v_email_domain  := NULLIF(LOWER(SPLIT_PART(NEW.email, '@', 2)), '');

    INSERT INTO public.profiles (
      id, username, full_name, university_id, email_domain,
      picture_prompt_status, onboarding_completed, agreed_to_terms, agreed_at
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
      NOT v_oauth_pending,
      v_agreed_to_terms,
      CASE WHEN v_agreed_to_terms THEN now() ELSE NULL END
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
