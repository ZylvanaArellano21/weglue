-- ============================================================================
-- 101 — Storage ownership and retention housekeeping
--
-- A. Restrict `posts` uploads to the authenticated user's first path segment.
--    Existing post and event-image clients already use <user-id>/... paths.
--
-- B. Bound pg_cron execution history, which otherwise grows once per dispatch
--    tick and is not cleaned by pg_cron itself.
--
-- C. Retain only a short operational window for terminal push_queue rows. The
--    persisted terminal statuses are sent, failed, skipped, and suppressed;
--    send-push's `dead` collection is written back as status = 'failed'.
--
-- D. Remove unreferenced pre-auth onboarding avatars after a generous 48-hour
--    grace period. The helper runs as SECURITY DEFINER because Storage's
--    objects table is not a student-facing data path.
--
-- E. get_discovery_people__inner is intentionally unchanged. At the founder's
--    launch target (a few hundred to roughly 2,000 profiles and 50 concurrent
--    active users), its bounded 20-row result and indexed correlated lookups
--    are acceptable pending a real load test. Its cross-university scope is a
--    product decision to confirm with the founder, not changed here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. User-owned `posts` object paths
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "posts bucket: authenticated can upload" ON storage.objects;

CREATE POLICY "posts bucket: authenticated can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'posts'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- Keep the existing public-read and owner-delete policies unchanged.

-- ----------------------------------------------------------------------------
-- B. pg_cron execution-history retention
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('weglue-cron-job-run-details-retention');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'weglue-cron-job-run-details-retention',
    '37 3 * * *',
    'DELETE FROM cron.job_run_details WHERE COALESCE(end_time, start_time) < now() - interval ''7 days'';'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'schedule weglue-cron-job-run-details-retention failed: %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- C. Terminal push_queue retention
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('weglue-push-queue-retention');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'weglue-push-queue-retention',
    '47 3 * * *',
    'DELETE FROM public.push_queue
      WHERE status IN (''sent'', ''failed'', ''skipped'', ''suppressed'')
        AND COALESCE(sent_at, claimed_at, created_at) < now() - interval ''3 days'';'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'schedule weglue-push-queue-retention failed: %', SQLERRM;
END $$;

-- ----------------------------------------------------------------------------
-- D. Pre-auth pending-avatar orphan sweep
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleanup_orphaned_pending_avatars()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Supabase's sanctioned escape hatch: this transaction-local setting allows
  -- the cleanup trigger to permit the direct row delete. It removes the
  -- database record, not backend object bytes; for these small abandoned
  -- onboarding JPEGs that is acceptable, and the row removal stops listing /
  -- serving them.
  PERFORM set_config('storage.allow_delete_query', 'true', true);

  DELETE FROM storage.objects AS o
   WHERE o.bucket_id = 'pending-avatars'
     AND o.created_at < now() - interval '48 hours'
     AND NOT EXISTS (
       SELECT 1
         FROM public.profiles AS p
        WHERE position('/pending-avatars/' || o.name IN COALESCE(p.avatar_url, '')) > 0
     );
END;
$$;

-- The function is invoked only by the postgres-owned cron job. Do not expose a
-- general-purpose Storage delete primitive through PostgREST roles.
REVOKE ALL ON FUNCTION public.cleanup_orphaned_pending_avatars()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('weglue-pending-avatars-orphan-sweep');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'weglue-pending-avatars-orphan-sweep',
    '13 * * * *',
    'SELECT public.cleanup_orphaned_pending_avatars();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'schedule weglue-pending-avatars-orphan-sweep failed: %', SQLERRM;
END $$;

-- ==========================================================================
-- ROLLBACK NOTES — this repo never runs migration down.
--
-- A future NNN_revert_101.sql would:
--
--   DROP POLICY IF EXISTS "posts bucket: authenticated can upload"
--     ON storage.objects;
--   CREATE POLICY "posts bucket: authenticated can upload"
--     ON storage.objects FOR INSERT TO authenticated
--     WITH CHECK (bucket_id = 'posts');
--
--   DO $$
--   BEGIN
--     PERFORM cron.unschedule('weglue-cron-job-run-details-retention');
--   EXCEPTION WHEN OTHERS THEN NULL;
--   END $$;
--
--   DO $$
--   BEGIN
--     PERFORM cron.unschedule('weglue-push-queue-retention');
--   EXCEPTION WHEN OTHERS THEN NULL;
--   END $$;
--
--   DO $$
--   BEGIN
--     PERFORM cron.unschedule('weglue-pending-avatars-orphan-sweep');
--   EXCEPTION WHEN OTHERS THEN NULL;
--   END $$;
--
--   DROP FUNCTION IF EXISTS public.cleanup_orphaned_pending_avatars();
--
-- Migration 021 directly queried storage.objects for a one-time cleanup;
-- this helper follows that fully-qualified table-access pattern while adding
-- SECURITY DEFINER for the scheduled orphan delete.
--
-- get_discovery_people__inner was not changed, so it has no rollback action.
-- ============================================================================
