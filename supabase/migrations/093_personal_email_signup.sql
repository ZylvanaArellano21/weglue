-- ============================================================
-- We Glue – Personal Email Signup (invert the .edu gate)
-- Migration: 093_personal_email_signup.sql
--
-- WHY:
--   005/007/008 required a school/university email (.edu or an
--   international academic-institution equivalent) to sign up. Product
--   direction has reversed: We Glue now requires a normal personal/general
--   email (Gmail, Outlook, Hotmail, Yahoo, iCloud, etc.) and BLOCKS a
--   school-issued email instead.
--
--   005/007/008 are immutable once shipped to production, so this is a new
--   additive migration, not an edit to those files. It re-defines the same
--   two functions in place (CREATE OR REPLACE) with inverted semantics —
--   `before_user_created` itself is untouched in shape, still an Auth Hook
--   (not a trigger), because GoTrue still masks a trigger's RAISE EXCEPTION
--   as an opaque 500 (see 008's header for the full explanation). Only the
--   logic inside is flipped.
--
--   `is_educational_email(email)` keeps its NAME (deliberately not renamed).
--   Its MEANING changes: it now returns TRUE when the email IS a school
--   email (i.e. should be BLOCKED), FALSE otherwise. For a given domain the
--   function's actual TRUE/FALSE output is unchanged from 005/008 (a school
--   domain still returns TRUE, a consumer domain still returns FALSE) — only
--   `before_user_created` below was rewritten to reject on TRUE instead of
--   rejecting on FALSE.
--
--   VERIFIED CAVEAT — 047_microsoft_oauth_onboarding.sql's
--   `complete_oauth_onboarding()` still contains its OWN callsite:
--     `IF v_email IS NULL OR NOT public.is_educational_email(v_email)
--      THEN status := 'not_eligible'`
--   That polarity is NOT flipped by this migration (047 is out of this
--   migration's approved scope), so it still requires a school email to
--   complete Microsoft OAuth onboarding — the OLD rule, now inconsistent
--   with the signup gate below. Confirmed harmless today only because no
--   live client code calls `complete_oauth_onboarding()` (Microsoft sign-in
--   was fully removed from both apps). Flagged separately for the founder;
--   fixing 047 needs its own approval before anyone touches that file.
--
--   `resolve_signup_university_id()` (042) is deliberately NOT touched —
--   under `single_campus_mode = true` it already ignores the signup email
--   entirely and always returns the one launch-campus UUID, so campus
--   assignment is already independent of the login email's domain.
--
-- ACTIVATION: none needed beyond running this migration — the
-- `before_user_created` Auth Hook is already wired (locally via
-- supabase/config.toml, remotely via the Supabase dashboard) and calls
-- `public.before_user_created`, whose signature/name is unchanged here.
-- ============================================================

-- is_educational_email now means "should this email be BLOCKED as a school
-- email" — same name, inverted logic. Every existing caller already treats
-- a TRUE return as "reject", so no caller needs to change.
CREATE OR REPLACE FUNCTION public.is_educational_email(email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  domain TEXT;
BEGIN
  domain := lower(substring(trim(email) FROM '@(.+)$'));
  IF domain IS NULL THEN RETURN FALSE; END IF;

  -- United States
  IF domain LIKE '%.edu' THEN RETURN TRUE; END IF;

  -- United Kingdom, New Zealand, India, Japan, South Africa, Indonesia,
  -- Thailand, South Korea, Israel, Iran, UAE, Tanzania, Uganda, Rwanda,
  -- Zambia, Malawi, Zimbabwe, Kenya
  IF domain LIKE '%.ac.uk'  OR domain LIKE '%.ac.nz'  OR domain LIKE '%.ac.in'
  OR domain LIKE '%.ac.jp'  OR domain LIKE '%.ac.za'  OR domain LIKE '%.ac.id'
  OR domain LIKE '%.ac.th'  OR domain LIKE '%.ac.kr'  OR domain LIKE '%.ac.il'
  OR domain LIKE '%.ac.ir'  OR domain LIKE '%.ac.ae'  OR domain LIKE '%.ac.tz'
  OR domain LIKE '%.ac.ug'  OR domain LIKE '%.ac.rw'  OR domain LIKE '%.ac.zm'
  OR domain LIKE '%.ac.mw'  OR domain LIKE '%.ac.zw'  OR domain LIKE '%.ac.ke'
  THEN RETURN TRUE; END IF;

  -- Latin America
  IF domain LIKE '%.edu.mx' OR domain LIKE '%.edu.co' OR domain LIKE '%.edu.ar'
  OR domain LIKE '%.edu.pe' OR domain LIKE '%.edu.ec' OR domain LIKE '%.edu.bo'
  OR domain LIKE '%.edu.ve' OR domain LIKE '%.edu.uy' OR domain LIKE '%.edu.py'
  OR domain LIKE '%.edu.gt' OR domain LIKE '%.edu.cu' OR domain LIKE '%.edu.do'
  OR domain LIKE '%.edu.hn' OR domain LIKE '%.edu.sv' OR domain LIKE '%.edu.ni'
  OR domain LIKE '%.edu.cr' OR domain LIKE '%.edu.pa' OR domain LIKE '%.edu.br'
  OR domain LIKE '%.edu.cl'
  THEN RETURN TRUE; END IF;

  -- Asia-Pacific
  IF domain LIKE '%.edu.au' OR domain LIKE '%.edu.cn' OR domain LIKE '%.edu.sg'
  OR domain LIKE '%.edu.hk' OR domain LIKE '%.edu.ph' OR domain LIKE '%.edu.my'
  OR domain LIKE '%.edu.pk' OR domain LIKE '%.edu.vn' OR domain LIKE '%.edu.kh'
  OR domain LIKE '%.edu.mm' OR domain LIKE '%.edu.bd' OR domain LIKE '%.edu.np'
  OR domain LIKE '%.edu.lk'
  THEN RETURN TRUE; END IF;

  -- Middle East & Africa
  IF domain LIKE '%.edu.eg' OR domain LIKE '%.edu.ng' OR domain LIKE '%.edu.gh'
  OR domain LIKE '%.edu.ke' OR domain LIKE '%.edu.et' OR domain LIKE '%.edu.ly'
  OR domain LIKE '%.edu.tn' OR domain LIKE '%.edu.ma' OR domain LIKE '%.edu.dz'
  OR domain LIKE '%.edu.sd'
  THEN RETURN TRUE; END IF;

  -- Europe
  IF domain LIKE '%.edu.tr' OR domain LIKE '%.edu.rs' OR domain LIKE '%.edu.ba'
  OR domain LIKE '%.edu.mk' OR domain LIKE '%.edu.al'
  THEN RETURN TRUE; END IF;

  -- Everything else (Gmail, Outlook, Hotmail, Yahoo, iCloud, and any other
  -- personal/general provider) is now ALLOWED.
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ============================================================
-- The hook function itself — same shape, inverted gate, new message.
-- ============================================================
CREATE OR REPLACE FUNCTION public.before_user_created(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_email TEXT;
BEGIN
  user_email := event->'user'->>'email';

  -- IMPORTANT: before_user_created rejects via an `error` object (NOT
  -- {"decision":"reject"} — that format is only for the MFA / password
  -- verification hooks). GoTrue silently ignores an unrecognized shape
  -- and lets EVERY signup through, so the email gate must use `error`.
  IF user_email IS NULL THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 422,
        'message',  'Please enter a valid email address.'
      )
    );
  END IF;

  IF public.is_educational_email(user_email) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 422,
        'message',  'Please use another email. Do not use your university or college email.'
      )
    );
  END IF;

  -- Empty object = allow the signup to continue unmodified.
  RETURN '{}'::jsonb;
END;
$$;

-- GoTrue calls this hook as supabase_auth_admin — it must have EXECUTE.
-- CREATE OR REPLACE does not reset grants, but re-stating them is
-- idempotent and matches this repo's existing migration style.
GRANT EXECUTE ON FUNCTION public.before_user_created(jsonb) TO supabase_auth_admin;
-- Revoke from public so anonymous callers can't invoke it directly.
REVOKE EXECUTE ON FUNCTION public.before_user_created(jsonb) FROM PUBLIC;
