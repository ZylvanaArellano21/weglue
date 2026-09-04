-- ============================================================================
-- 118 — Google Play versionCode support
--
-- The sync helper is still service-role-only. Android store rows identify the
-- live release by build_number (Google Play versionCode); the marketing
-- version is optional because Play does not require a dotted release name.
-- ============================================================================

BEGIN;

ALTER TABLE public.app_releases
  ADD COLUMN IF NOT EXISTS build_number integer;

-- Android's official API can expose a completed versionCode without a
-- marketing version. The existing 090 column was NOT NULL, so make only that
-- field nullable; an empty/placeholder marketing version is never written.
ALTER TABLE public.app_releases
  ALTER COLUMN version DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS app_releases_android_build_number_key
  ON public.app_releases (platform, build_number)
  WHERE platform = 'android' AND build_number IS NOT NULL;

-- Replace the three-argument identity rather than leaving two divergent RPCs.
-- The default preserves existing three-argument PostgREST calls.
DROP FUNCTION public.sync_store_app_release(text, text, text);

CREATE OR REPLACE FUNCTION public.sync_store_app_release(
  p_platform     text,
  p_version      text,
  p_store_url    text,
  p_build_number integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient                 record;
  v_release_id                uuid;
  v_version                   text := NULLIF(btrim(p_version), '');
  v_store_url                 text := NULLIF(btrim(p_store_url), '');
  v_build                     integer := CASE WHEN p_platform = 'android' THEN p_build_number ELSE NULL END;
  v_release_key               text;
  v_had_known_public_release  boolean;
  v_is_new_release            boolean;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'invalid store release';
  END IF;
  IF p_platform = 'ios' AND v_version IS NULL THEN
    RAISE EXCEPTION 'ios_store_version_required';
  END IF;
  IF p_platform = 'android' AND v_build IS NULL AND v_version IS NULL THEN
    RAISE EXCEPTION 'android_store_version_or_build_required';
  END IF;

  -- Snapshot BEFORE this call writes anything: did this platform already
  -- have ANY known public release? A push must be measured against this —
  -- not merely "did a row already exist for this exact version/build" —
  -- so the function is safe BY CONSTRUCTION, not by deployment order. The
  -- very first store-detected release for a platform is a baseline: it can
  -- never be "genuinely newer than the previously known public release"
  -- (there is no previous one), so it can never push, no matter when this
  -- function first runs or how its Vault-armed cron happened to be sequenced.
  SELECT EXISTS (
    SELECT 1 FROM public.app_releases WHERE platform = p_platform AND is_public = true
  ) INTO v_had_known_public_release;

  -- Prefer an existing Android versionCode row. Otherwise match the stable
  -- (platform, version) key used by iOS and the legacy three-argument call.
  SELECT ar.id
    INTO v_release_id
    FROM public.app_releases ar
   WHERE ar.platform = p_platform
     AND (
       (p_platform = 'android' AND v_build IS NOT NULL AND ar.build_number = v_build)
       OR (v_version IS NOT NULL AND ar.version = v_version)
     )
   ORDER BY ar.released_at DESC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  -- No matching row means this exact version/build was never on file for
  -- this platform before — a re-detection of something already known always
  -- finds it above and takes the ELSE branch below instead.
  v_is_new_release := v_release_id IS NULL;

  IF v_release_id IS NULL THEN
    INSERT INTO public.app_releases (
      platform, version, build_number, is_public, source, store_url, released_at, updated_at
    )
    VALUES (
      p_platform, v_version, v_build, true, 'store', v_store_url, now(), now()
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_release_id;
  END IF;

  -- This also handles a concurrent poll that won either the version or the
  -- partial Android build-number unique index between the SELECT and INSERT.
  -- Losing that race means another transaction already inserted the new row
  -- (and is the one responsible for its push, itself gated by this same
  -- logic) — this call only refreshes it, so it must not also count as
  -- having created a new release.
  IF v_release_id IS NULL THEN
    v_is_new_release := false;
    UPDATE public.app_releases ar
       SET version = v_version,
           build_number = v_build,
           is_public = true,
           source = 'store',
           store_url = v_store_url,
           released_at = now(),
           updated_at = now()
     WHERE ar.platform = p_platform
       AND (
         (p_platform = 'android' AND v_build IS NOT NULL AND ar.build_number = v_build)
         OR (v_version IS NOT NULL AND ar.version = v_version)
       )
    RETURNING ar.id INTO v_release_id;
  ELSE
    UPDATE public.app_releases ar
       SET version = v_version,
           build_number = v_build,
           is_public = true,
           source = 'store',
           store_url = v_store_url,
           released_at = now(),
           updated_at = now()
     WHERE ar.id = v_release_id;
  END IF;

  IF v_release_id IS NULL THEN
    RAISE EXCEPTION 'store_release_upsert_failed';
  END IF;

  -- Push only when this call both (a) recorded a version/build that was NOT
  -- already on file — a re-detection of something already known never
  -- reaches here, so it stays idempotent and sends nothing — AND (b) the
  -- platform already had a prior known public release to be newer than.
  -- (a) alone is what the previous version of this function gated on, which
  -- also pushed on a platform's very first detected release — precisely the
  -- false "update available" this now guards against. (a) AND (b) together
  -- are the literal definition of "a genuinely newer public release than
  -- the previously known one".
  IF v_is_new_release AND v_had_known_public_release THEN
    -- A versionCode is the stable dedupe identity when Play has no marketing
    -- version. This never calls publish_app_release(), so polling has no
    -- repeated human-publish side effect.
    v_release_key := CASE WHEN p_platform = 'android' AND v_build IS NOT NULL THEN 'build-' || v_build::text ELSE v_version END;
    FOR v_recipient IN
      SELECT DISTINCT pt.user_id
        FROM public.push_tokens pt
       WHERE pt.platform = p_platform
         AND pt.status = 'active'
         AND pt.environment = 'production'
    LOOP
      PERFORM public.enqueue_push(
        v_recipient.user_id,
        NULL,
        'app_update',
        'A new We Glue update is ready',
        'Update now to get the latest improvements.',
        jsonb_build_object('screen', 'update'),
        'app_update:' || p_platform || ':' || v_release_key,
        'app_update:' || p_platform || ':' || v_release_key || ':' || v_recipient.user_id,
        0
      );
    END LOOP;
    PERFORM public.invoke_push_dispatch();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_store_app_release(text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_store_app_release(text, text, text, integer)
  TO service_role;

COMMENT ON COLUMN public.app_releases.build_number IS
  'Google Play versionCode for Android store rows; NULL for iOS and legacy/manual rows.';
COMMENT ON FUNCTION public.sync_store_app_release(text, text, text, integer) IS
  'Service-role-only store release upsert. Android uses build_number as versionCode and permits a NULL marketing version.';

COMMIT;
