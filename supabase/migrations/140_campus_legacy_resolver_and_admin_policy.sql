-- ============================================================================
-- We Glue - Legacy campus resolver and admin email-policy editing
-- Migration: 140_campus_legacy_resolver_and_admin_policy.sql
--
-- Legacy clients do not send university_slug. They predate campus selection,
-- so they can only mean the configured launch campus, even after the
-- single-campus launch switch is turned off. Policy edits remain atomic with
-- their existing university.edit audit row.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Legacy signup campus resolution
-- --------------------------------------------------------------------------
-- This is intentionally fixed at the shared resolver rather than duplicated
-- at handle_new_user()/ensure_profile() call sites. Both callers already use
-- this function for the no-university_slug path, as does the OAuth repair /
-- completion path when it has to materialize a profile.
CREATE OR REPLACE FUNCTION public.resolve_signup_university_id(p_email text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_launch_id uuid;
BEGIN
  SELECT launch_university_id
    INTO v_launch_id
    FROM public.app_config
   LIMIT 1;

  -- A client that sends no campus predates multi-campus selection. Its only
  -- possible meaning is the launch campus. Do not inspect p_email: Lone Star
  -- accepts arbitrary personal domains and email-domain inference is not a
  -- campus authority.
  RETURN v_launch_id;
END;
$$;

COMMENT ON FUNCTION public.resolve_signup_university_id(text) IS
  'Resolves the legacy no-campus signup path to app_config.launch_university_id '
  'regardless of single_campus_mode. Does not infer a campus from email domain; '
  'supplied university_slug values are resolved and validated by the 137 signup '
  'and profile paths before they are used.';

REVOKE ALL ON FUNCTION public.resolve_signup_university_id(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_signup_university_id(text)
  TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- 2. Atomic university edit with per-campus email policy
-- --------------------------------------------------------------------------
-- The old 7-argument function must be removed before adding the policy
-- parameters. Otherwise PostgreSQL would retain an overload that PostgREST
-- could select for old calls, leaving two competing university.edit paths.
DROP FUNCTION IF EXISTS public.admin_tx_university_edit(
  uuid, text, text, uuid, uuid, text, text
);

CREATE OR REPLACE FUNCTION public.admin_tx_university_edit(
  p_actor_id              uuid,
  p_actor_email           text,
  p_reason                text,
  p_correlation_id        uuid,
  p_id                    uuid,
  p_name                  text DEFAULT NULL,
  p_slug                 text DEFAULT NULL,
  p_email_mode            text DEFAULT NULL,
  p_email_domains         text[] DEFAULT NULL,
  p_email_denied_message  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta                 jsonb := jsonb_build_object('id', p_id);
  before_row           jsonb;
  after_row            jsonb;
  new_name             text;
  new_slug             text;
  old_email_mode       text;
  old_email_domains    text[];
  old_denied_message   text;
  new_email_mode       text;
  new_email_domains    text[];
  new_denied_message   text;
  raw_domain           text;
  normalized_domain    text;
  normalized_domains   text[] := ARRAY[]::text[];
BEGIN
  SELECT jsonb_build_object(
           'id', u.id,
           'name', u.name,
           'slug', u.slug,
           'is_active', u.is_active,
           'email_mode', u.email_mode,
           'email_domains', u.email_domains,
           'email_denied_message', u.email_denied_message
         ),
         u.email_mode,
         u.email_domains,
         u.email_denied_message
    INTO before_row, old_email_mode, old_email_domains, old_denied_message
    FROM public.universities AS u
   WHERE u.id = p_id;

  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(
      p_actor_id, p_actor_email, 'university.edit', 'university', p_id,
      meta, p_correlation_id, 'not_found'
    );
  END IF;

  new_name := COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), before_row ->> 'name');
  new_slug := COALESCE(NULLIF(btrim(COALESCE(p_slug, '')), ''), before_row ->> 'slug');
  new_email_mode := COALESCE(btrim(p_email_mode), old_email_mode);
  new_denied_message := COALESCE(p_email_denied_message, old_denied_message);

  IF char_length(new_name) < 2 OR char_length(new_name) > 100 THEN
    RETURN private.admin_tx_fail(
      p_actor_id, p_actor_email, 'university.edit', 'university', p_id,
      meta, p_correlation_id, 'invalid_name'
    );
  END IF;
  IF new_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(new_slug) > 60 THEN
    RETURN private.admin_tx_fail(
      p_actor_id, p_actor_email, 'university.edit', 'university', p_id,
      meta, p_correlation_id, 'invalid_slug'
    );
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.universities AS u
     WHERE u.id <> p_id
       AND (u.name = new_name OR u.slug = new_slug)
  ) THEN
    RETURN private.admin_tx_fail(
      p_actor_id, p_actor_email, 'university.edit', 'university', p_id,
      meta, p_correlation_id, 'duplicate'
    );
  END IF;

  IF new_email_mode NOT IN ('block_educational', 'allowlist') THEN
    RETURN private.admin_tx_fail(
      p_actor_id, p_actor_email, 'university.edit', 'university', p_id,
      meta, p_correlation_id, 'invalid_email_mode'
    );
  END IF;

  -- NULL means leave the existing array unchanged. A supplied array is
  -- canonicalized before validation and writing: trim, lowercase, remove a
  -- leading @, discard blanks, and deduplicate.
  IF p_email_domains IS NULL THEN
    new_email_domains := old_email_domains;
  ELSE
    FOREACH raw_domain IN ARRAY p_email_domains LOOP
      -- Trim BEFORE stripping a leading '@'. The other order leaves the '@' in
      -- place whenever the admin typed a leading space, and the hostname check
      -- below then rejects " @tamu.edu" as an invalid domain.
      normalized_domain := lower(
        regexp_replace(btrim(COALESCE(raw_domain, '')), '^@', '')
      );

      IF normalized_domain = '' THEN
        CONTINUE;
      END IF;

      IF length(normalized_domain) > 253
         OR normalized_domain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$'
      THEN
        RETURN private.admin_tx_fail(
          p_actor_id, p_actor_email, 'university.edit', 'university', p_id,
          meta, p_correlation_id, 'invalid_email_domain'
        );
      END IF;

      IF NOT normalized_domain = ANY(normalized_domains) THEN
        normalized_domains := array_append(normalized_domains, normalized_domain);
      END IF;
    END LOOP;

    IF cardinality(normalized_domains) = 0 THEN
      new_email_domains := NULL;
    ELSE
      new_email_domains := normalized_domains;
    END IF;
  END IF;

  IF new_email_mode = 'allowlist'
     AND (new_email_domains IS NULL OR cardinality(new_email_domains) = 0)
  THEN
    RETURN private.admin_tx_fail(
      p_actor_id, p_actor_email, 'university.edit', 'university', p_id,
      meta, p_correlation_id, 'email_domains_required'
    );
  END IF;

  IF new_email_mode = 'allowlist' AND new_denied_message IS NULL THEN
    RETURN private.admin_tx_fail(
      p_actor_id, p_actor_email, 'university.edit', 'university', p_id,
      meta, p_correlation_id, 'email_denied_message_required'
    );
  END IF;

  IF new_email_mode = 'block_educational' AND new_email_domains IS NOT NULL THEN
    RETURN private.admin_tx_fail(
      p_actor_id, p_actor_email, 'university.edit', 'university', p_id,
      meta, p_correlation_id, 'email_domains_must_be_null'
    );
  END IF;

  UPDATE public.universities
     SET name = new_name,
         slug = new_slug,
         email_mode = new_email_mode,
         email_domains = new_email_domains,
         email_denied_message = new_denied_message
   WHERE id = p_id;

  SELECT jsonb_build_object(
           'id', u.id,
           'name', u.name,
           'slug', u.slug,
           'is_active', u.is_active,
           'email_mode', u.email_mode,
           'email_domains', u.email_domains,
           'email_denied_message', u.email_denied_message
         )
    INTO after_row
    FROM public.universities AS u
   WHERE u.id = p_id;

  RETURN private.admin_tx_ok(
    p_actor_id, p_actor_email, 'university.edit', 'university', p_id,
    p_reason, before_row, after_row, meta, p_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_tx_university_edit(
  uuid, text, text, uuid, uuid, text, text, text, text[], text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_university_edit(
  uuid, text, text, uuid, uuid, text, text, text, text[], text
) TO service_role;

COMMIT;
