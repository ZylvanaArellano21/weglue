\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE migration_148_function_snapshot AS
SELECT
  p.oid::regprocedure::text AS signature,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc AS p
JOIN pg_namespace AS n
  ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'notifications_after_insert_push',
    'notifications_after_group_merge_push',
    'handle_message_push'
  );

DO $required_functions$
BEGIN
  IF (SELECT count(*) FROM migration_148_function_snapshot) <> 3 THEN
    RAISE EXCEPTION 'migration 148 test requires all three immediate dispatch functions';
  END IF;
END;
$required_functions$;

DO $fixture_cleanup$
DECLARE
  dispatch_job record;
BEGIN
  FOR dispatch_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'dispatch-push'
    ORDER BY jobid
  LOOP
    PERFORM cron.unschedule(dispatch_job.jobid);
  END LOOP;
END;
$fixture_cleanup$;

-- Model duplicate legacy rows owned by different roles. The rows are
-- transaction-local because this test always rolls back.
INSERT INTO cron.job (
  schedule,
  command,
  nodeport,
  database,
  username,
  active,
  jobname
)
VALUES
  (
    '5 seconds',
    'SELECT public.invoke_push_dispatch();',
    5432,
    current_database(),
    'postgres',
    true,
    'dispatch-push'
  ),
  (
    '10 seconds',
    'SELECT public.invoke_push_dispatch();',
    5432,
    current_database(),
    'supabase_admin',
    false,
    'dispatch-push'
  );

\ir ../migrations/148_dispatch_push_60s.sql

DO $cron_job_assertions$
DECLARE
  dispatch_job_count integer;
  matching_job_count integer;
BEGIN
  SELECT
    count(*),
    count(*) FILTER (
      WHERE active
        AND schedule = '* * * * *'
        AND command = 'SELECT public.invoke_push_dispatch();'
    )
  INTO dispatch_job_count, matching_job_count
  FROM cron.job
  WHERE jobname = 'dispatch-push';

  IF dispatch_job_count <> 1 THEN
    RAISE EXCEPTION
      'expected duplicate dispatch-push jobs to be replaced by one job, found %',
      dispatch_job_count;
  END IF;

  IF matching_job_count <> 1 THEN
    RAISE EXCEPTION
      'expected one active dispatch-push job with the exact 60-second schedule and command';
  END IF;
END;
$cron_job_assertions$;

DO $function_immutability$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM migration_148_function_snapshot AS before
    FULL JOIN (
      SELECT
        p.oid::regprocedure::text AS signature,
        pg_get_functiondef(p.oid) AS definition
      FROM pg_proc AS p
      JOIN pg_namespace AS n
        ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'notifications_after_insert_push',
          'notifications_after_group_merge_push',
          'handle_message_push'
        )
    ) AS after
      USING (signature, definition)
    WHERE before.signature IS NULL OR after.signature IS NULL
  ) THEN
    RAISE EXCEPTION 'migration 148 changed an immediate dispatch function';
  END IF;
END;
$function_immutability$;

CREATE TEMP TABLE migration_148_pg_net_snapshot AS
SELECT count(*)::bigint AS request_count
FROM net.http_request_queue;

SELECT public.invoke_push_dispatch();

DO $idle_dispatch_assertion$
DECLARE
  request_count_before bigint;
  request_count_after bigint;
BEGIN
  SELECT request_count
  INTO request_count_before
  FROM migration_148_pg_net_snapshot;

  SELECT count(*)::bigint
  INTO request_count_after
  FROM net.http_request_queue;

  IF request_count_after <> request_count_before THEN
    RAISE EXCEPTION
      'idle invoke_push_dispatch() created a pg_net request (% before, % after)',
      request_count_before,
      request_count_after;
  END IF;
END;
$idle_dispatch_assertion$;

ROLLBACK;

\echo 'migration 148 dispatch-push 60-second tests passed'
