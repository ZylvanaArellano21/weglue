-- ============================================================================
-- We Glue - Campus foundation
-- Migration: 136_campus_foundation.sql
--
-- Per-campus email policy data and the single policy authority used by later
-- signup enforcement. This migration deliberately leaves launch configuration,
-- signup enforcement, backfills, RLS, and matching scope unchanged.
--
-- public.is_educational_email(text) is the existing production authority for
-- the canonical educational suffix set (migration 093). Lone Star therefore
-- reuses it with the existing personal-email polarity instead of copying the
-- suffix list here.
-- ============================================================================

ALTER TABLE public.universities
  ADD COLUMN IF NOT EXISTS email_mode TEXT NOT NULL DEFAULT 'block_educational',
  ADD COLUMN IF NOT EXISTS email_domains TEXT[] NULL,
  ADD COLUMN IF NOT EXISTS email_denied_message TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.universities'::regclass
      AND conname = 'universities_email_mode_check'
  ) THEN
    ALTER TABLE public.universities
      ADD CONSTRAINT universities_email_mode_check
      CHECK (email_mode IN ('block_educational', 'allowlist'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.universities'::regclass
      AND conname = 'universities_email_policy_shape_check'
  ) THEN
    ALTER TABLE public.universities
      ADD CONSTRAINT universities_email_policy_shape_check
      CHECK (
        (email_mode = 'block_educational' AND email_domains IS NULL)
        OR (
          email_mode = 'allowlist'
          AND email_domains IS NOT NULL
          AND cardinality(email_domains) > 0
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.universities'::regclass
      AND conname = 'universities_allowlist_message_check'
  ) THEN
    ALTER TABLE public.universities
      ADD CONSTRAINT universities_allowlist_message_check
      CHECK (email_mode <> 'allowlist' OR email_denied_message IS NOT NULL);
  END IF;
END;
$$;

-- Resolve the launch campus from app_config, retaining its existing UUID.
DO $$
DECLARE
  v_launch_university_id UUID;
BEGIN
  SELECT launch_university_id
  INTO v_launch_university_id
  FROM public.app_config
  LIMIT 1;

  IF v_launch_university_id IS NULL THEN
    RAISE EXCEPTION
      '136: app_config.launch_university_id is NULL; refusing to rename a campus';
  END IF;

  UPDATE public.universities
  SET name = 'Lone Star College – Montgomery',
      slug = 'lone-star-college-montgomery',
      email_mode = 'block_educational',
      email_domains = NULL,
      email_denied_message = NULL
  WHERE id = v_launch_university_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      '136: app_config.launch_university_id % does not reference a university',
      v_launch_university_id;
  END IF;
END;
$$;

-- Add the second campus as policy data, but keep it hidden until the separately
-- approved launch-switch migration flips both is_active and app_config.
INSERT INTO public.universities (
  name,
  slug,
  is_active,
  email_mode,
  email_domains,
  email_denied_message
)
VALUES (
  'Texas A&M University – College Station',
  'texas-am-college-station',
  false,
  'allowlist',
  ARRAY['tamu.edu']::TEXT[],
  'Use your Texas A&M email address (@tamu.edu) to join this campus.'
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    is_active = EXCLUDED.is_active,
    email_mode = EXCLUDED.email_mode,
    email_domains = EXCLUDED.email_domains,
    email_denied_message = EXCLUDED.email_denied_message;

-- One policy authority. Active state is intentionally not consulted here;
-- list_active_campuses() is the active-state gate for the pre-auth picker.
CREATE OR REPLACE FUNCTION public.campus_email_allowed(
  p_university_id UUID,
  p_email TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_email         TEXT;
  v_domain        TEXT;
  v_local_part    TEXT;
  v_email_mode    TEXT;
  v_email_domains TEXT[];
BEGIN
  SELECT email_mode, email_domains
  INTO v_email_mode, v_email_domains
  FROM public.universities
  WHERE id = p_university_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  v_email := LOWER(BTRIM(p_email));
  IF v_email IS NULL OR v_email = '' OR POSITION('@' IN v_email) = 0 THEN
    RETURN FALSE;
  END IF;

  -- The contract extracts the portion after the LAST @. Keep the local part
  -- non-empty, while otherwise leaving domain-policy decisions to the row.
  v_domain := REVERSE(SPLIT_PART(REVERSE(v_email), '@', 1));
  v_local_part := LEFT(v_email, LENGTH(v_email) - LENGTH(v_domain) - 1);

  IF v_local_part IS NULL OR v_local_part = ''
     OR v_local_part LIKE '%@%'
     OR v_domain IS NULL OR v_domain = ''
     OR POSITION('.' IN v_domain) = 0
     OR v_domain LIKE '.%'
     OR v_domain LIKE '%.'
     OR v_domain LIKE '%..%' THEN
    RETURN FALSE;
  END IF;

  IF v_email_mode = 'allowlist' THEN
    -- Exact equality is deliberate: no suffix or subdomain matching.
    RETURN v_domain = ANY(v_email_domains);
  END IF;

  IF v_email_mode = 'block_educational' THEN
    -- 093's existing function returns TRUE for the canonical educational
    -- suffix set. Negating it preserves Lone Star's shipped personal-email
    -- rule: educational domains are rejected, general domains are allowed.
    RETURN NOT COALESCE(public.is_educational_email(v_email), FALSE);
  END IF;

  -- Fail closed if a future row contains an unsupported mode.
  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.campus_email_allowed(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- The only anonymous campus surface. The security-definer owner reads the
-- table, while callers receive only active campuses and the policy fields
-- needed by the pre-auth picker.
CREATE OR REPLACE FUNCTION public.list_active_campuses()
RETURNS TABLE (
  slug TEXT,
  name TEXT,
  email_mode TEXT,
  email_domains TEXT[],
  email_denied_message TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT u.slug,
         u.name,
         u.email_mode,
         u.email_domains,
         u.email_denied_message
  FROM public.universities AS u
  WHERE u.is_active = TRUE
  ORDER BY u.name;
$$;

REVOKE ALL ON FUNCTION public.list_active_campuses()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_campuses()
  TO anon, authenticated;
