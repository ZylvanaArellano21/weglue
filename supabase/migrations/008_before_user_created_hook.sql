-- ============================================================
-- We Glue – Before-User-Created Auth Hook
-- Migration: 008_before_user_created_hook.sql
--
-- WHY THIS EXISTS AND NOT A TRIGGER:
--   Supabase GoTrue always masks any RAISE EXCEPTION thrown by an
--   AFTER INSERT ON auth.users trigger — the client only ever sees
--   "Database error saving new user" (500). The rejection message
--   is silently swallowed AND the entire signup transaction rolls
--   back, making sign-up completely broken.
--
--   The correct server-side gate is the `before_user_created` Auth
--   Hook, which runs BEFORE GoTrue writes the user row. GoTrue
--   forwards the hook's rejection message as a real 422 to the
--   client, so the app can display it properly.
--
-- ACTIVATION (two steps after running this migration):
--   Local:  set enabled=true in supabase/config.toml (see below)
--   Remote: Supabase dashboard → Auth → Hooks → Before User Created
--           URI: pg-functions://postgres/public/before_user_created
-- ============================================================

-- is_educational_email must exist before the hook uses it.
-- (Idempotent — safe to recreate even if 007 already ran.)
CREATE OR REPLACE FUNCTION public.is_educational_email(email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  domain TEXT;
BEGIN
  domain := lower(substring(trim(email) FROM '@(.+)$'));
  IF domain IS NULL THEN RETURN FALSE; END IF;

  -- Consumer / corporate denylist
  IF domain = ANY(ARRAY[
    'gmail.com', 'googlemail.com',
    'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'hotmail.es', 'hotmail.fr',
    'live.com', 'live.co.uk', 'live.ca', 'live.com.au', 'live.com.mx',
    'yahoo.com', 'yahoo.co.uk', 'yahoo.es', 'yahoo.fr', 'yahoo.com.mx',
    'yahoo.com.br', 'yahoo.com.ar',
    'icloud.com', 'me.com', 'mac.com', 'aol.com',
    'protonmail.com', 'proton.me', 'pm.me',
    'zoho.com', 'yandex.com', 'yandex.ru', 'msn.com',
    'mail.com', 'inbox.com', 'gmx.com', 'gmx.net', 'gmx.de', 'web.de',
    'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
    'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net',
    'tutanota.com', 'tuta.io', 'fastmail.com', 'fastmail.fm',
    'runbox.com', 'mailbox.org', 'hushmail.com', 'disroot.org'
  ]) THEN RETURN FALSE; END IF;

  -- Educational TLD allowlist
  IF domain LIKE '%.edu' THEN RETURN TRUE; END IF;

  IF domain LIKE '%.ac.uk'  OR domain LIKE '%.ac.nz'  OR domain LIKE '%.ac.in'
  OR domain LIKE '%.ac.jp'  OR domain LIKE '%.ac.za'  OR domain LIKE '%.ac.id'
  OR domain LIKE '%.ac.th'  OR domain LIKE '%.ac.kr'  OR domain LIKE '%.ac.il'
  OR domain LIKE '%.ac.ir'  OR domain LIKE '%.ac.ae'  OR domain LIKE '%.ac.tz'
  OR domain LIKE '%.ac.ug'  OR domain LIKE '%.ac.rw'  OR domain LIKE '%.ac.zm'
  OR domain LIKE '%.ac.mw'  OR domain LIKE '%.ac.zw'  OR domain LIKE '%.ac.ke'
  THEN RETURN TRUE; END IF;

  IF domain LIKE '%.edu.mx' OR domain LIKE '%.edu.co' OR domain LIKE '%.edu.ar'
  OR domain LIKE '%.edu.pe' OR domain LIKE '%.edu.ec' OR domain LIKE '%.edu.bo'
  OR domain LIKE '%.edu.ve' OR domain LIKE '%.edu.uy' OR domain LIKE '%.edu.py'
  OR domain LIKE '%.edu.gt' OR domain LIKE '%.edu.cu' OR domain LIKE '%.edu.do'
  OR domain LIKE '%.edu.hn' OR domain LIKE '%.edu.sv' OR domain LIKE '%.edu.ni'
  OR domain LIKE '%.edu.cr' OR domain LIKE '%.edu.pa' OR domain LIKE '%.edu.br'
  OR domain LIKE '%.edu.cl'
  THEN RETURN TRUE; END IF;

  IF domain LIKE '%.edu.au' OR domain LIKE '%.edu.cn' OR domain LIKE '%.edu.sg'
  OR domain LIKE '%.edu.hk' OR domain LIKE '%.edu.ph' OR domain LIKE '%.edu.my'
  OR domain LIKE '%.edu.pk' OR domain LIKE '%.edu.vn' OR domain LIKE '%.edu.kh'
  OR domain LIKE '%.edu.mm' OR domain LIKE '%.edu.bd' OR domain LIKE '%.edu.np'
  OR domain LIKE '%.edu.lk'
  THEN RETURN TRUE; END IF;

  IF domain LIKE '%.edu.eg' OR domain LIKE '%.edu.ng' OR domain LIKE '%.edu.gh'
  OR domain LIKE '%.edu.ke' OR domain LIKE '%.edu.et' OR domain LIKE '%.edu.ly'
  OR domain LIKE '%.edu.tn' OR domain LIKE '%.edu.ma' OR domain LIKE '%.edu.dz'
  OR domain LIKE '%.edu.sd'
  THEN RETURN TRUE; END IF;

  IF domain LIKE '%.edu.tr' OR domain LIKE '%.edu.rs' OR domain LIKE '%.edu.ba'
  OR domain LIKE '%.edu.mk' OR domain LIKE '%.edu.al'
  THEN RETURN TRUE; END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ============================================================
-- The actual hook function
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
  IF user_email IS NULL OR NOT public.is_educational_email(user_email) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 422,
        'message',  'Please use your university or college email address (.edu or equivalent) to sign up.'
      )
    );
  END IF;

  -- Empty object = allow the signup to continue unmodified.
  RETURN '{}'::jsonb;
END;
$$;

-- GoTrue calls this hook as supabase_auth_admin — it must have EXECUTE.
GRANT EXECUTE ON FUNCTION public.before_user_created(jsonb) TO supabase_auth_admin;
-- Revoke from public so anonymous callers can't invoke it directly.
REVOKE EXECUTE ON FUNCTION public.before_user_created(jsonb) FROM PUBLIC;
