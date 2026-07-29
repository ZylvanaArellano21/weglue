-- ============================================================
-- We Glue – Platform-admin Auth identities (founder Admin Dashboard)
-- Migration: 053_platform_admin_accounts.sql
--
-- The founder's Admin Dashboard account is an Auth identity that is NOT a
-- student. Creating it through the Supabase Dashboard / Admin API bypasses the
-- before_user_created hook (008) — that hook only runs on the signup path — so
-- the AFTER INSERT trigger on auth.users happily minted it a full student
-- profile: a generated username, the launch campus, an onboarding_completed
-- flag, a recommendation batch, and a social-proof fan-out that notified every
-- real student that "user_94387196 just joined We Glue 🎉".
--
-- This migration makes a platform-admin Auth identity structurally incapable of
-- becoming a student, on EVERY path that can materialize a profile row:
--
--   A. is_platform_admin_auth(jsonb) — the marker predicate.
--   B. handle_new_user()  — the signup/creation path (auth.users AFTER INSERT).
--   C. ensure_profile()   — the repair path called by iOS/Android on PGRST116.
--
-- WHY app_metadata AND NOT user_metadata / a profiles column
--   raw_app_meta_data is writable ONLY by the service role (GoTrue's admin API).
--   No browser, iOS, Android or student-web client has ANY API surface that can
--   set it — signUp({options:{data}}) and auth.updateUser({data}) both write
--   raw_user_meta_data. That is what makes this marker non-spoofable, and it is
--   the same property GoTrue itself relies on for 'provider'/'providers'.
--   A profiles column would be circular: the whole point is that no profile row
--   exists.
--
-- CLASSIFICATION ONLY — NOT AUTHORIZATION
--   This marker must NEVER grant Admin Dashboard access. Dashboard authorization
--   remains exactly: ADMIN_PORTAL_ENABLED + validated Supabase session +
--   immutable UUID in ADMIN_FOUNDER_USER_IDS + optional email consistency +
--   aal2 MFA (+ ADMIN_WRITES_ENABLED for writes). Nothing in apps/web/lib/admin
--   reads account_type as a grant. An attacker who somehow set this marker would
--   gain exactly nothing.
--
-- NEVER RAISE inside an auth.users trigger — GoTrue masks it as an opaque 500
-- and breaks every signup (the 027 lesson). Both guards below are plain RETURNs.
--
-- NOT CHANGED BY THIS MIGRATION (verified byte-for-byte):
--   before_user_created, is_educational_email, the .edu enforcement,
--   complete_oauth_onboarding, resolve_signup_university_id, every RLS policy,
--   every table, column, index and role grant.
-- ============================================================

-- ============================================================
-- PART A — the marker predicate
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_platform_admin_auth(p_app_meta JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- NULL-safe and exact-match: only the literal 'platform_admin' counts. A
  -- missing key, a null jsonb, or any other value is a normal student account.
  SELECT COALESCE(p_app_meta->>'account_type', '') = 'platform_admin';
$$;

COMMENT ON FUNCTION public.is_platform_admin_auth(JSONB) IS
  'True iff auth.users.raw_app_meta_data marks a platform-admin identity. '
  'Classification only — never an Admin Dashboard authorization grant. '
  'app_metadata is service-role-write-only, so clients cannot spoof it.';

-- Read-only classification helper; safe for the app roles to call, but the two
-- consumers below are SECURITY DEFINER and call it internally anyway.
REVOKE ALL ON FUNCTION public.is_platform_admin_auth(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin_auth(JSONB)
  TO authenticated, service_role;

-- ============================================================
-- PART B — handle_new_user(): platform admins get no student footprint
--
-- The body below is the CURRENT PRODUCTION definition, copied verbatim, with
-- exactly one addition: the four-line guard immediately after BEGIN. Returning
-- there skips, in one move, the profile INSERT, the user_interests and
-- user_activities INSERTs, generate_club_recommendation_batch(), and — because
-- trg_profile_social_proof fires AFTER INSERT ON profiles — the social_proof_
-- events row and its 5-minute cron fan-out to every student.
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

-- The trigger is unchanged: exactly one AFTER INSERT on auth.users (from 043),
-- still calling handle_new_user(). Replacing the function above is enough.

-- ============================================================
-- PART C — ensure_profile(): the repair path must not re-mint a student
--
-- ensure_profile() is the server-side repair called by BOTH mobile platforms
-- (apps/mobile/app/_layout.tsx, on a PGRST116 "no profile row" fetch). Without
-- this guard, deleting the founder's generated profile would be undone the
-- first time that account touched the iOS or Android app — and would re-fire
-- the social-proof fan-out a second time.
--
-- Body is the current production definition verbatim, plus the guard and the
-- v_app_meta variable needed to evaluate it.
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
