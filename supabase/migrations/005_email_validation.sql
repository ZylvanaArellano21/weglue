-- ============================================================
-- We Glue – Email Validation Safety Net
-- Migration: 005_email_validation.sql
-- Server-side enforcement that only educational institution
-- emails can be used to sign up. Client-side validation handles
-- UX; this trigger is the security backstop for bad actors.
-- ============================================================

CREATE OR REPLACE FUNCTION is_educational_email(email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  domain TEXT;
BEGIN
  domain := lower(substring(trim(email) FROM '@(.+)$'));
  IF domain IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Denylist: known consumer / corporate email providers
  IF domain = ANY(ARRAY[
    'gmail.com', 'googlemail.com',
    'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'hotmail.es', 'hotmail.fr',
    'live.com', 'live.co.uk', 'live.ca', 'live.com.au', 'live.com.mx',
    'yahoo.com', 'yahoo.co.uk', 'yahoo.es', 'yahoo.fr', 'yahoo.com.mx', 'yahoo.com.br', 'yahoo.com.ar',
    'icloud.com', 'me.com', 'mac.com',
    'aol.com',
    'protonmail.com', 'proton.me', 'pm.me',
    'zoho.com', 'yandex.com', 'yandex.ru', 'msn.com',
    'mail.com', 'inbox.com', 'gmx.com', 'gmx.net', 'gmx.de', 'web.de',
    'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
    'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net',
    'tutanota.com', 'tuta.io', 'fastmail.com', 'fastmail.fm',
    'runbox.com', 'mailbox.org', 'hushmail.com', 'disroot.org'
  ]) THEN
    RETURN FALSE;
  END IF;

  -- Allowlist: educational TLD patterns (US, international)
  IF domain LIKE '%.edu'    THEN RETURN TRUE; END IF;

  -- .ac.* (UK, NZ, IN, JP, ZA, ID, TH, KR, IL, IR, AE, African nations)
  IF domain LIKE '%.ac.uk'  OR domain LIKE '%.ac.nz'  OR domain LIKE '%.ac.in'
  OR domain LIKE '%.ac.jp'  OR domain LIKE '%.ac.za'  OR domain LIKE '%.ac.id'
  OR domain LIKE '%.ac.th'  OR domain LIKE '%.ac.kr'  OR domain LIKE '%.ac.il'
  OR domain LIKE '%.ac.ir'  OR domain LIKE '%.ac.ae'  OR domain LIKE '%.ac.tz'
  OR domain LIKE '%.ac.ug'  OR domain LIKE '%.ac.rw'  OR domain LIKE '%.ac.zm'
  OR domain LIKE '%.ac.mw'  OR domain LIKE '%.ac.zw'  OR domain LIKE '%.ac.ke'
  THEN RETURN TRUE; END IF;

  -- .edu.* (Latin America)
  IF domain LIKE '%.edu.mx' OR domain LIKE '%.edu.co' OR domain LIKE '%.edu.ar'
  OR domain LIKE '%.edu.pe' OR domain LIKE '%.edu.ec' OR domain LIKE '%.edu.bo'
  OR domain LIKE '%.edu.ve' OR domain LIKE '%.edu.uy' OR domain LIKE '%.edu.py'
  OR domain LIKE '%.edu.gt' OR domain LIKE '%.edu.cu' OR domain LIKE '%.edu.do'
  OR domain LIKE '%.edu.hn' OR domain LIKE '%.edu.sv' OR domain LIKE '%.edu.ni'
  OR domain LIKE '%.edu.cr' OR domain LIKE '%.edu.pa' OR domain LIKE '%.edu.br'
  OR domain LIKE '%.edu.cl'
  THEN RETURN TRUE; END IF;

  -- .edu.* (Asia-Pacific)
  IF domain LIKE '%.edu.au' OR domain LIKE '%.edu.cn' OR domain LIKE '%.edu.sg'
  OR domain LIKE '%.edu.hk' OR domain LIKE '%.edu.ph' OR domain LIKE '%.edu.my'
  OR domain LIKE '%.edu.pk' OR domain LIKE '%.edu.vn' OR domain LIKE '%.edu.kh'
  OR domain LIKE '%.edu.mm' OR domain LIKE '%.edu.bd' OR domain LIKE '%.edu.np'
  OR domain LIKE '%.edu.lk'
  THEN RETURN TRUE; END IF;

  -- .edu.* (Middle East & Africa)
  IF domain LIKE '%.edu.eg' OR domain LIKE '%.edu.ng' OR domain LIKE '%.edu.gh'
  OR domain LIKE '%.edu.ke' OR domain LIKE '%.edu.et' OR domain LIKE '%.edu.ly'
  OR domain LIKE '%.edu.tn' OR domain LIKE '%.edu.ma' OR domain LIKE '%.edu.dz'
  OR domain LIKE '%.edu.sd'
  THEN RETURN TRUE; END IF;

  -- .edu.* (Europe / Other)
  IF domain LIKE '%.edu.tr' OR domain LIKE '%.edu.rs' OR domain LIKE '%.edu.ba'
  OR domain LIKE '%.edu.mk' OR domain LIKE '%.edu.al'
  THEN RETURN TRUE; END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update handle_new_user to enforce educational email before inserting a profile.
-- An exception here rolls back the auth.users INSERT, so Supabase signUp() returns
-- an error to the client. Client-side validation handles the UX; this is the backstop.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT is_educational_email(NEW.email) THEN
    RAISE EXCEPTION 'Please use your university or college email address to sign up.';
  END IF;

  INSERT INTO profiles (id, username, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::text, 8)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
