-- ============================================================
-- We Glue – Auth / Signup / Onboarding hardening
-- Migration: 027_auth_signup_hardening.sql
--
-- 1. Case-insensitive unique usernames (live data verified: no
--    lower() duplicates exist as of 2026-07-07).
-- 2. profiles.onboarding_completed — single source of truth for
--    "finished the club-matches step". Backfilled true for every
--    profile that already has an avatar (pre-existing users must
--    never be bounced back into onboarding).
-- 3. handle_new_user made collision-proof: a username clash with
--    another profile now falls back to a suffixed username instead
--    of silently failing and leaving the auth user with no profile.
-- 4. Pending (unconfirmed) re-signups update auth.users metadata;
--    a new AFTER UPDATE trigger mirrors the latest username onto
--    the pending profile row so the abandoned attempt's choice
--    never wins. Never raises — auth writes must not be blocked.
-- 5. ensure_profile(): self-repair RPC — recreates a missing
--    profile row for the calling (authenticated) user.
-- 6. auth_signup_status(): SECURITY DEFINER, rate-limited probe the
--    clients use to distinguish available / exists_verified /
--    exists_unverified emails and taken usernames WITHOUT touching
--    auth.users from the client. Powers the product rules:
--      verified dup    -> "You already have an account. Try to log in."
--      unverified dup  -> silently resume/replace the pending signup
--      username taken  -> "This username is already taken."
-- ============================================================

-- ------------------------------------------------------------
-- 1. Case-insensitive username uniqueness
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_username_lower
  ON profiles (lower(username));

-- ------------------------------------------------------------
-- 2. Onboarding completion flag
-- ------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;

-- Anyone who already set an avatar predates this flag and has been
-- using the app — mark them complete so login keeps sending them Home.
UPDATE profiles SET onboarding_completed = true WHERE avatar_url IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Collision-proof profile auto-creation
--    (NEVER raises — see 007: a raise here breaks every signup)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
BEGIN
  v_username := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'username'), ''),
    'user_' || LEFT(NEW.id::text, 8)
  );

  BEGIN
    INSERT INTO public.profiles (id, username, full_name)
    VALUES (
      NEW.id,
      v_username,
      COALESCE(NEW.raw_user_meta_data->>'full_name', '')
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      -- Username already held by another profile — fall back to a
      -- unique suffix so the auth user is never left without a profile.
      BEGIN
        INSERT INTO public.profiles (id, username, full_name)
        VALUES (
          NEW.id,
          v_username || '_' || LEFT(NEW.id::text, 6),
          COALESCE(NEW.raw_user_meta_data->>'full_name', '')
        )
        ON CONFLICT (id) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_new_user: fallback insert failed for %: %', NEW.id, SQLERRM;
      END;
    WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 4. Mirror re-signup metadata onto the pending profile
--    GoTrue UPDATEs auth.users when an unconfirmed email signs up
--    again (new password + metadata). Keep the profile row's
--    username in sync with the LATEST attempt. Never raises.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_pending_profile_meta()
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
        -- unique_violation etc. — the signup status probe blocks taken
        -- usernames up front; never block the auth.users write here.
        RAISE WARNING 'sync_pending_profile_meta: skipped for %: %', NEW.id, SQLERRM;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_auth_user_updated_pending ON auth.users;
CREATE TRIGGER trg_on_auth_user_updated_pending
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_pending_profile_meta();

-- ------------------------------------------------------------
-- 5. Self-repair: recreate a missing profile row
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_profile  public.profiles;
  v_username TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  IF FOUND THEN
    RETURN v_profile;
  END IF;

  SELECT COALESCE(
           NULLIF(trim(u.raw_user_meta_data->>'username'), ''),
           'user_' || LEFT(u.id::text, 8)
         )
  INTO v_username
  FROM auth.users u WHERE u.id = v_uid;

  BEGIN
    INSERT INTO public.profiles (id, username, full_name)
    VALUES (v_uid, v_username, '')
    RETURNING * INTO v_profile;
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO public.profiles (id, username, full_name)
    VALUES (v_uid, v_username || '_' || LEFT(v_uid::text, 6), '')
    ON CONFLICT (id) DO NOTHING
    RETURNING * INTO v_profile;
  END;

  IF v_profile.id IS NULL THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
  END IF;
  RETURN v_profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profile() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_profile() FROM anon;

-- ------------------------------------------------------------
-- 6. Rate-limited signup status probe
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_probe_rate_limits (
  ip            TEXT PRIMARY KEY,
  window_start  TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL
);

-- No policies: RLS on with none means only SECURITY DEFINER functions
-- (owner) can read/write this table.
ALTER TABLE auth_probe_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.auth_signup_status(
  p_email    TEXT,
  p_username TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip              TEXT;
  v_count           INT;
  v_email           TEXT;
  v_username        TEXT;
  v_user_id         UUID;
  v_confirmed_at    TIMESTAMPTZ;
  v_email_status    TEXT := 'available';
  v_username_status TEXT := NULL;
  v_owner_id        UUID;
BEGIN
  -- ---- abuse protection: 30 probes / 5 min / IP --------------
  v_ip := COALESCE(
    NULLIF(split_part(
      COALESCE(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ''),
      ',', 1), ''),
    'unknown'
  );

  DELETE FROM auth_probe_rate_limits WHERE window_start < now() - interval '1 hour';

  INSERT INTO auth_probe_rate_limits AS r (ip, window_start, request_count)
  VALUES (v_ip, now(), 1)
  ON CONFLICT (ip) DO UPDATE SET
    request_count = CASE WHEN r.window_start < now() - interval '5 minutes'
                         THEN 1 ELSE r.request_count + 1 END,
    window_start  = CASE WHEN r.window_start < now() - interval '5 minutes'
                         THEN now() ELSE r.window_start END
  RETURNING request_count INTO v_count;

  IF v_count > 30 THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;

  -- ---- email status ------------------------------------------
  v_email := lower(trim(p_email));
  IF v_email IS NULL OR v_email = '' OR position('@' IN v_email) = 0 THEN
    RETURN jsonb_build_object('status', 'invalid_email');
  END IF;

  SELECT u.id, u.email_confirmed_at
  INTO v_user_id, v_confirmed_at
  FROM auth.users u
  WHERE lower(u.email) = v_email
    AND u.deleted_at IS NULL
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    v_email_status := CASE WHEN v_confirmed_at IS NOT NULL
                           THEN 'exists_verified'
                           ELSE 'exists_unverified' END;
  END IF;

  -- ---- username status ---------------------------------------
  IF p_username IS NOT NULL AND trim(p_username) <> '' THEN
    v_username := lower(trim(regexp_replace(trim(p_username), '^@', '')));

    SELECT p.id INTO v_owner_id
    FROM profiles p
    WHERE lower(p.username) = v_username
    LIMIT 1;

    IF v_owner_id IS NULL THEN
      v_username_status := 'available';
    ELSIF v_owner_id = v_user_id AND v_confirmed_at IS NULL THEN
      -- Their own abandoned/pending signup — they may keep the name.
      v_username_status := 'yours_pending';
    ELSE
      v_username_status := 'taken';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status',          'ok',
    'email_status',    v_email_status,
    'username_status', v_username_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.auth_signup_status(TEXT, TEXT) TO anon, authenticated;
