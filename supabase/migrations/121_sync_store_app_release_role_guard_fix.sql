-- ============================================================================
-- 121 — fix sync_store_app_release's role guard: rely on the GRANT, not a
-- JWT claim GUC that this project's PostgREST does not populate the way
-- migrations 117/119 assumed.
--
-- Discovered during live F5 production activation (2026-09-04): the real
-- Edge Function → PostgREST → sync_store_app_release call for Android failed
-- with 42501 "service_role_required" even though the caller correctly held
-- service-role EXECUTE privilege (confirmed independently: calling the RPC
-- directly via PostgREST with the project's actual service-role-resolving
-- key reproduces the same 42501, raised by this function's OWN
-- current_setting('request.jwt.claim.role', true) check — not a native
-- Postgres permission-denied, which would be raised BEFORE ever reaching
-- this function body if the GRANT itself were the problem). iOS's first live
-- check appeared to succeed only because it never actually attempted the
-- call (its version-compare short-circuited before reaching the RPC).
--
-- The real, load-bearing protection was always REVOKE ALL ... GRANT EXECUTE
-- ... TO service_role (migration 117/119, untouched here) — a native
-- Postgres role-privilege check that does not depend on any JWT claim GUC.
-- The in-body check is defense-in-depth on top of that grant, and must not
-- itself become a false-positive that blocks the one legitimate caller. So:
-- reject the two CLIENT-facing roles specifically (still real protection —
-- a genuine anon/authenticated PostgREST call always does populate this GUC
-- correctly, since it comes from a real user JWT) rather than requiring an
-- exact 'service_role' match that this project's key type does not produce.
-- ============================================================================

BEGIN;

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
  -- The REVOKE/GRANT below is the real gate (only service_role may EXECUTE
  -- this function at all — PostgREST/Postgres itself refuses the call
  -- natively for anon/authenticated before this body ever runs). This check
  -- is defense-in-depth against a future grant drift, not the primary gate —
  -- it must not hard-require a specific JWT claim value that this project's
  -- current key/PostgREST configuration does not populate for a legitimate
  -- service-role caller.
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') IN ('anon', 'authenticated') THEN
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

-- Signature is unchanged (CREATE OR REPLACE above), so grants are untouched
-- and do not need to be re-stated — but re-asserting them here costs nothing
-- and keeps this migration self-contained/idempotent if ever re-read in
-- isolation.
REVOKE ALL ON FUNCTION public.sync_store_app_release(text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_store_app_release(text, text, text, integer)
  TO service_role;

COMMENT ON FUNCTION public.sync_store_app_release(text, text, text, integer) IS
  'Service-role-only store release upsert (EXECUTE grant is the real gate). Android uses build_number as versionCode and permits a NULL marketing version.';

COMMIT;
