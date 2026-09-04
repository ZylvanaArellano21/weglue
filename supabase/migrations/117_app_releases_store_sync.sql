-- ============================================================================
-- 117 — store-backed app release detection
--
-- The store poller is deliberately separate from publish_app_release(). Manual
-- publishing keeps its existing signature and notification behavior; the
-- store-only helper below is service-role-only and has the same push dedupe key
-- without re-running a human publish action on every poll.
-- ============================================================================

BEGIN;

ALTER TABLE public.app_releases
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

UPDATE public.app_releases
   SET source = 'manual'
 WHERE source IS NULL;

ALTER TABLE public.app_releases
  ALTER COLUMN source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.app_releases'::regclass
       AND conname = 'app_releases_source_check'
  ) THEN
    ALTER TABLE public.app_releases
      ADD CONSTRAINT app_releases_source_check
      CHECK (source IN ('manual', 'store'));
  END IF;
END $$;

ALTER TABLE public.app_releases
  ADD COLUMN IF NOT EXISTS store_url text;

-- Cron → Edge Function auth (see the pg_cron block at the end of this file):
-- the cron job sends a DEDICATED Supabase Secret API key in the `apikey`
-- header. That key is NOT the project's legacy service_role JWT — it is a
-- purpose-scoped secret the founder provisions in the dashboard and stores
-- in exactly two backend places:
--   * Supabase Vault, as `store_version_sync_api_key`  (this cron job)
--   * the sync-store-versions function's secrets, as STORE_SYNC_API_KEY
-- It is never given to the mobile app, the web client, or the browser. The
-- Edge Function runs with verify_jwt = false and authenticates the caller
-- solely by constant-time comparing that header to STORE_SYNC_API_KEY.

-- One append-only row per completed attempt. The dashboard reads the latest
-- row per platform; clients never receive this operational table.
CREATE TABLE IF NOT EXISTS public.app_release_store_checks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform         text NOT NULL CHECK (platform IN ('ios', 'android')),
  checked_at       timestamptz NOT NULL DEFAULT now(),
  detected_version text,
  ok               boolean NOT NULL,
  error            text
);

CREATE INDEX IF NOT EXISTS idx_app_release_store_checks_platform_checked_at
  ON public.app_release_store_checks (platform, checked_at DESC);

ALTER TABLE public.app_release_store_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_release_store_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.app_release_store_checks TO service_role;

-- The mobile contract is an authenticated public-release read. RLS remains
-- the row-level boundary: drafts are still invisible, and anon has no table
-- privilege per migration 092.
REVOKE ALL ON public.app_releases FROM anon, authenticated;
GRANT SELECT ON public.app_releases TO authenticated;
GRANT SELECT ON public.app_releases TO service_role;

-- Keep migration 092's fail-closed privilege invariant: anon gets no access;
-- authenticated gets SELECT only. This check intentionally runs before COMMIT.
DO $$
DECLARE
  v_bad_count int;
BEGIN
  SELECT count(*) INTO v_bad_count
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'app_releases'
     AND grantee IN ('anon', 'authenticated')
     AND NOT (grantee = 'authenticated' AND privilege_type = 'SELECT');
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION '092: app_releases still has % unexpected grant(s) after lockdown', v_bad_count;
  END IF;
END $$;

-- Keep the existing manual signature and its real push fan-out intact. The
-- explicit source assignment makes provenance stable even if the default is
-- changed later.
CREATE OR REPLACE FUNCTION public.publish_app_release(p_platform TEXT, p_version TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient RECORD;
BEGIN
  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'invalid platform: %', p_platform;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = auth.uid() AND public.is_platform_admin_auth(u.raw_app_meta_data)
  ) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.app_releases (platform, version, is_public, source, released_at, updated_at)
  VALUES (p_platform, p_version, true, 'manual', now(), now())
  ON CONFLICT (platform, version) DO UPDATE
    SET is_public = true,
        source = 'manual',
        released_at = COALESCE(public.app_releases.released_at, now()),
        updated_at = now();

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
      'app_update:' || p_platform || ':' || p_version,
      'app_update:' || p_platform || ':' || p_version || ':' || v_recipient.user_id,
      0
    );
  END LOOP;
  PERFORM public.invoke_push_dispatch();
END;
$$;

REVOKE ALL ON FUNCTION public.publish_app_release(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_app_release(TEXT, TEXT) TO authenticated, service_role;

-- Called only after the Edge Function has established that the store version
-- is newer. The service-role claim check prevents an authenticated client from
-- invoking this internal write path even if EXECUTE grants drift later.
CREATE OR REPLACE FUNCTION public.sync_store_app_release(
  p_platform  text,
  p_version   text,
  p_store_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient                RECORD;
  v_had_known_public_release boolean;
  v_is_new_release           boolean;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_platform NOT IN ('ios', 'android') OR NULLIF(btrim(p_version), '') IS NULL THEN
    RAISE EXCEPTION 'invalid store release';
  END IF;

  -- Safe by construction, not by deployment order — see migration 118's
  -- 4-arg replacement of this function for the full rationale. This 3-arg
  -- version is superseded (DROPped) within the same migration run by 118,
  -- but is fixed identically so the ledger never records an unsafe version,
  -- even transiently.
  SELECT EXISTS (
    SELECT 1 FROM public.app_releases WHERE platform = p_platform AND is_public = true
  ) INTO v_had_known_public_release;
  v_is_new_release := NOT EXISTS (
    SELECT 1 FROM public.app_releases WHERE platform = p_platform AND version = p_version
  );

  INSERT INTO public.app_releases (platform, version, is_public, source, store_url, released_at, updated_at)
  VALUES (p_platform, p_version, true, 'store', NULLIF(btrim(p_store_url), ''), now(), now())
  ON CONFLICT (platform, version) DO UPDATE
    SET is_public = true,
        source = 'store',
        store_url = EXCLUDED.store_url,
        released_at = now(),
        updated_at = now();

  -- enqueue_push() owns the unique dedupe constraint too, as extra defense —
  -- but this gate is what stops a baseline/re-detection call from even
  -- attempting to enqueue in the first place.
  IF v_is_new_release AND v_had_known_public_release THEN
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
        'app_update:' || p_platform || ':' || p_version,
        'app_update:' || p_platform || ':' || p_version || ':' || v_recipient.user_id,
        0
      );
    END LOOP;
    PERFORM public.invoke_push_dispatch();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_store_app_release(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_store_app_release(text, text, text) TO service_role;

-- The Edge Function runs with verify_jwt = false (supabase/config.toml) and
-- gates itself on the `apikey` header. The dedicated Secret API key is
-- resolved from Vault at execution time, so no credential is ever written to
-- cron.job.command or cron.job_run_details. The job is only scheduled once
-- that Vault secret exists, so a partially-provisioned project stays inert
-- rather than logging a failing HTTP call every 45 minutes.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    CREATE EXTENSION IF NOT EXISTS pg_net;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'store version sync extensions: %', SQLERRM;
  END;

  BEGIN
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname = 'sync-store-versions';
    PERFORM cron.schedule(
      'sync-store-versions',
      '*/45 * * * *',
      $job$SELECT net.http_post(
        url := 'https://yoozrnosmqtaiksgcixc.supabase.co/functions/v1/sync-store-versions',
        headers := jsonb_build_object(
          'apikey', (SELECT decrypted_secret
            FROM vault.decrypted_secrets
           WHERE name = 'store_version_sync_api_key'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      )
      WHERE EXISTS (
        SELECT 1 FROM vault.decrypted_secrets
         WHERE name = 'store_version_sync_api_key'
      );$job$
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'schedule sync-store-versions failed: %', SQLERRM;
  END;
END $$;

COMMIT;
