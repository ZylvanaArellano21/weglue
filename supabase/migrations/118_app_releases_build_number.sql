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
  v_recipient   record;
  v_release_id  uuid;
  v_version     text := NULLIF(btrim(p_version), '');
  v_store_url   text := NULLIF(btrim(p_store_url), '');
  v_build       integer := CASE WHEN p_platform = 'android' THEN p_build_number ELSE NULL END;
  v_release_key text;
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
  IF v_release_id IS NULL THEN
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
