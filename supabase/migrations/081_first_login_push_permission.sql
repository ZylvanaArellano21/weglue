-- ============================================================
-- We Glue – First-login notification permission (correction 1)
-- Migration: 081_first_login_push_permission.sql
--
-- PROBLEM: new mobile users never see the OS notification-permission box.
-- requestPermissionFromUserAction() (apps/mobile/lib/notifications/
-- permissions.ts) is only ever called reactively, when a user happens to
-- open the Notifications inbox or the Notifications settings screen — there
-- is no first-login trigger at all.
--
-- FIX: a one-shot, server-persisted flag on profiles, set true ONLY at the
-- moment a brand-new profile row is created, exactly like the existing
-- `picture_prompt_status` "pending"-for-new-accounts pattern (042/053). The
-- mobile app checks this flag the first time it reaches the authenticated
-- tabs and, if true, fires the native permission box, then consumes the
-- flag via consume_push_permission_prompt() so it can never fire again.
--
-- WHY THIS CANNOT AFFECT EXISTING ACCOUNTS
--   ADD COLUMN ... DEFAULT false applies that default to every existing row
--   with no UPDATE statement — there is no backfill, no migration logic that
--   targets or even looks at existing accounts. Only handle_new_user() and
--   ensure_profile() — the two functions that INSERT a brand-new profiles
--   row — are changed to set the flag true, mirroring picture_prompt_status
--   exactly (see 042_single_campus_and_club_recommendations.sql, PART C, and
--   053_platform_admin_accounts.sql, PARTS B/C, whose bodies below are
--   reproduced verbatim aside from this one addition).
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS push_permission_prompt_pending BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.push_permission_prompt_pending IS
  'True only for a brand-new account that has not yet reached the '
  'authenticated app for the first time. handle_new_user()/ensure_profile() '
  'set it true at INSERT; consume_push_permission_prompt() clears it. '
  'Never touched for an existing row.';

-- ============================================================
-- PART A — handle_new_user(): current production body (053) + one field
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
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
  -- 053: a platform-admin Auth identity is not a student. Return BEFORE any
  -- student artifact is created: no profiles row, no survey rows, no interests
  -- or activities, no recommendation batch, no social-proof event, no
  -- onboarding record, and therefore no student_joined notifications.
  -- A plain RETURN (never RAISE) — the auth.users write must always succeed.
  IF public.is_platform_admin_auth(NEW.raw_app_meta_data) THEN
    RETURN NEW;
  END IF;

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
      picture_prompt_status, onboarding_completed, push_permission_prompt_pending
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
      -- 081: genuinely new account → ask for OS push permission once, the
      -- first time it reaches the authenticated tabs.
      true
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

-- ============================================================
-- PART B — ensure_profile(): current production body (053) + one field
-- ============================================================

CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_email    TEXT;
  v_meta     JSONB;
  v_app_meta JSONB;   -- 053: needed for the platform-admin guard
  v_provider TEXT;
  v_pending  BOOLEAN;
  v_profile  profiles;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT email, raw_user_meta_data, raw_app_meta_data,
         COALESCE(raw_app_meta_data->>'provider', 'email')
  INTO v_email, v_meta, v_app_meta, v_provider
  FROM auth.users WHERE id = v_user_id;

  -- 053: never repair a platform-admin Auth identity into a student profile.
  -- Returns NULL rather than raising: the mobile caller does
  -- `const { data: repaired } = await supabase.rpc("ensure_profile")` and then
  -- `if (repaired)`, so a null composite is handled cleanly with no client
  -- error, while the app's own platform-admin guard shows the blocking screen.
  IF public.is_platform_admin_auth(v_app_meta) THEN
    RETURN NULL;
  END IF;

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
    picture_prompt_status, onboarding_completed, push_permission_prompt_pending
  )
  VALUES (
    v_user_id,
    COALESCE(v_meta->>'username', 'user_' || LEFT(v_user_id::TEXT, 8)) || '_' || LEFT(gen_random_uuid()::TEXT, 4),
    CASE WHEN v_pending THEN '' ELSE COALESCE(v_meta->>'full_name', '') END,
    resolve_signup_university_id(v_email),
    NULLIF(LOWER(SPLIT_PART(v_email, '@', 2)), ''),
    'pending',
    NOT v_pending,
    -- 081: this INSERT only ever fires for a row that did not already exist
    -- (ON CONFLICT DO NOTHING below) — an existing account repaired here
    -- never reaches this VALUES list at all, so this can never retroactively
    -- flip the flag for a pre-existing profile.
    true
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

-- ============================================================
-- PART C — consume_push_permission_prompt(): the one-shot guard
--
-- Mirrors dismiss_picture_prompt() (042) exactly: SECURITY DEFINER,
-- auth.uid()-scoped, idempotent (a second call is a harmless no-op).
-- ============================================================

CREATE OR REPLACE FUNCTION public.consume_push_permission_prompt()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  UPDATE profiles SET push_permission_prompt_pending = false WHERE id = auth.uid();
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_push_permission_prompt() TO authenticated;
