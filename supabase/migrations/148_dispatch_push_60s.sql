-- Reduce only the dispatch-push fallback cadence from every 5 seconds to once
-- per minute. Immediate notification and message dispatch remain unchanged.

DO $dispatch_push_cleanup$
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
$dispatch_push_cleanup$;

SELECT cron.schedule(
  'dispatch-push',
  '* * * * *',
  'SELECT public.invoke_push_dispatch();'
);

DO $dispatch_push_assertion$
DECLARE
  matching_job_count integer;
  named_job_count integer;
BEGIN
  SELECT
    count(*) FILTER (
      WHERE active
        AND schedule = '* * * * *'
        AND command = 'SELECT public.invoke_push_dispatch();'
    ),
    count(*)
  INTO matching_job_count, named_job_count
  FROM cron.job
  WHERE jobname = 'dispatch-push';

  IF matching_job_count <> 1 OR named_job_count <> 1 THEN
    RAISE EXCEPTION
      'dispatch-push verification failed: expected one active 60-second job, found % matching of % named jobs',
      matching_job_count,
      named_job_count;
  END IF;
END;
$dispatch_push_assertion$;

-- Rollback strategy (documented only; do not run as part of this migration):
-- unschedule every dispatch-push row by jobid, then schedule exactly one job as
-- cron.schedule('dispatch-push', '5 seconds',
--               'SELECT public.invoke_push_dispatch();') and assert uniqueness.
