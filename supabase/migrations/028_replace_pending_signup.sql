-- ============================================================
-- We Glue – Replace abandoned pending signups
-- Migration: 028_replace_pending_signup.sql
--
-- WHY: GoTrue's signUp() on an existing UNCONFIRMED email only
-- re-sends the old confirmation email — it does NOT update the
-- password or metadata (verified empirically against this project
-- on 2026-07-07). A user who abandons signup and later signs up
-- again with the same email but a new password/username would be
-- locked out: the new password would never be saved.
--
-- FIX: the client calls replace_pending_signup(email) right before
-- signUp() when auth_signup_status() reports exists_unverified.
-- The stale unverified auth user is deleted (profiles + children
-- cascade), then the normal signUp() creates a brand-new pending
-- account with the latest password/username and sends a fresh
-- verification email.
--
-- SAFETY:
--   * Only deletes users with email_confirmed_at IS NULL — a
--     verified account can never be touched.
--   * Rate-limited via the shared auth_probe_rate_limits table
--     (heavier cost per call than a status probe).
--   * Worst-case abuse = resetting a stranger's unverified,
--     never-used pending signup; nothing is disclosed and the
--     attacker still cannot verify an email they don't own.
-- ============================================================

CREATE OR REPLACE FUNCTION public.replace_pending_signup(p_email TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip           TEXT;
  v_count        INT;
  v_email        TEXT;
  v_user_id      UUID;
  v_confirmed_at TIMESTAMPTZ;
BEGIN
  -- ---- abuse protection: shares the probe window, costs 5 -----
  v_ip := COALESCE(
    NULLIF(split_part(
      COALESCE(current_setting('request.headers', true)::jsonb->>'x-forwarded-for', ''),
      ',', 1), ''),
    'unknown'
  );

  INSERT INTO auth_probe_rate_limits AS r (ip, window_start, request_count)
  VALUES (v_ip, now(), 5)
  ON CONFLICT (ip) DO UPDATE SET
    request_count = CASE WHEN r.window_start < now() - interval '5 minutes'
                         THEN 5 ELSE r.request_count + 5 END,
    window_start  = CASE WHEN r.window_start < now() - interval '5 minutes'
                         THEN now() ELSE r.window_start END
  RETURNING request_count INTO v_count;

  IF v_count > 30 THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;

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

  IF v_user_id IS NULL THEN
    -- Nothing pending — the caller can proceed with a normal signup.
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF v_confirmed_at IS NOT NULL THEN
    -- Never touch a verified account.
    RETURN jsonb_build_object('status', 'exists_verified');
  END IF;

  DELETE FROM auth.users
  WHERE id = v_user_id
    AND email_confirmed_at IS NULL;

  RETURN jsonb_build_object('status', 'pending_signup_replaced');
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_pending_signup(TEXT) TO anon, authenticated;
