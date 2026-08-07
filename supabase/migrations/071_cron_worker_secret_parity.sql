-- 071_cron_worker_secret_parity.sql
--
-- Defect: 061's install_account_deletion_worker_schedule() interpolated the
-- decrypted Vault secret directly into the pg_cron command with format(%L).
-- pg_cron persists that command text in cron.job.command AND copies it into
-- every cron.job_run_details row, so a per-minute job wrote the worker secret
-- into thousands of cleartext rows readable by any postgres/service_role
-- holder -- including the Admin Dashboard's service-role client. Rotating the
-- secret under the old installer would immediately re-create the exposure.
--
-- Fix: the installers no longer embed the secret. The generated command joins
-- vault.decrypted_secrets at execution time, so the stored command text never
-- contains a credential. Selecting FROM the vault view also makes the job
-- fail closed: if the secret row is missing, the statement matches zero rows
-- and issues no HTTP request at all, rather than calling the worker with an
-- empty or NULL header.
--
-- Both installers remain intentionally uninvoked, exactly as in 061:
-- Production supplies the real worker URL operationally.

CREATE OR REPLACE FUNCTION public.install_account_deletion_worker_schedule(p_worker_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Presence check only. The value is never read into a variable, never
  -- formatted into the command, and never leaves the vault view.
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'account_deletion_worker_secret')
     OR char_length(btrim(COALESCE(p_worker_url, ''))) < 16 THEN
    RAISE EXCEPTION 'account deletion worker URL or Vault secret is not configured' USING ERRCODE = 'P0001';
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'weglue-account-deletion-worker';
  -- Run every minute: scheduled/cancelled notices are durable outbox work and
  -- should be dispatched promptly, while finalization remains due-date gated.
  PERFORM cron.schedule(
    'weglue-account-deletion-worker',
    '* * * * *',
    format(
      $job$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-weglue-worker-secret', s.decrypted_secret), body := '{}'::jsonb, timeout_milliseconds := 10000) FROM vault.decrypted_secrets s WHERE s.name = 'account_deletion_worker_secret';$job$,
      p_worker_url
    )
  );
END;
$$;

-- Day 10F deleted-message reconciliation. Same fail-closed, no-literal shape.
-- Daily at 03:17 UTC; cron.timezone is GMT on this project, so the cron
-- expression is already UTC.
CREATE OR REPLACE FUNCTION public.install_deleted_message_reconciler_schedule(p_worker_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'message_privacy_worker_secret')
     OR char_length(btrim(COALESCE(p_worker_url, ''))) < 16 THEN
    RAISE EXCEPTION 'deleted-message reconciler URL or Vault secret is not configured' USING ERRCODE = 'P0001';
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'weglue-day10f-deleted-message-reconciler-daily';
  -- The worker is lease-based and idempotent, so a longer pg_net timeout only
  -- improves observability of the run; it can never double-process work.
  PERFORM cron.schedule(
    'weglue-day10f-deleted-message-reconciler-daily',
    '17 3 * * *',
    format(
      $job$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-weglue-message-privacy-secret', s.decrypted_secret), body := '{}'::jsonb, timeout_milliseconds := 55000) FROM vault.decrypted_secrets s WHERE s.name = 'message_privacy_worker_secret';$job$,
      p_worker_url
    )
  );
END;
$$;

DO $grants$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'install_account_deletion_worker_schedule(text)',
    'install_deleted_message_reconciler_schedule(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role;', fn);
  END LOOP;
END
$grants$;
