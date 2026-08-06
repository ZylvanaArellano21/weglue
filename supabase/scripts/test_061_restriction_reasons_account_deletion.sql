-- Day 10B migration 061 focused harness (throwaway DB only; never Production).
--
-- Load the existing 057 fixture plus 057, 055, 056, 058, 060, then 061. The
-- fixture must provide public.storage_path_from_public_url() (or 052) before
-- 061 because the worker intentionally reuses the reviewed deletion routine.

\set ON_ERROR_STOP on
\pset pager off

CREATE TABLE t061_results (name text PRIMARY KEY, ok boolean NOT NULL);
CREATE OR REPLACE FUNCTION t061_ok(p_name text, p_ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t061_results VALUES (p_name,coalesce(p_ok,false)); END; $$;

\set ADM  '''a1111111-1111-4111-8111-111111111111'''
\set USER '''b2222222-2222-4222-8222-222222222222'''

INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES
  (:ADM,'founder-061@test.invalid','{"account_type":"platform_admin"}'::jsonb),
  (:USER,'student-061@test.invalid','{}'::jsonb);
-- The auth-user trigger may have already created the profile in a full local
-- migration reset; make the fixture valid in both production-shaped orders.
INSERT INTO public.profiles (id,username,full_name) VALUES (:USER,'day10b061','Day 10B 061')
ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, full_name = EXCLUDED.full_name;

SELECT t061_ok('v2 suspension accepts category/public/internal separation',
  (public.admin_tx_restriction_suspend_v2(
    :ADM,'founder-061@test.invalid','Internal decision context',gen_random_uuid(),:USER,NULL,
    'targeted_harassment','Your account was suspended because repeated unwanted messages targeted another student.'
  )->>'status')='ok');

SELECT set_config('request.jwt.claims',json_build_object('sub',:USER)::text,false);
SELECT t061_ok('student sees own public category and reason',
  public.my_access_state()->>'violation_category'='Targeted harassment'
  AND public.my_access_state()->>'public_reason' LIKE 'Your account was suspended%');
SELECT t061_ok('student payload has no internal/admin/audit leakage',
  NOT (public.my_access_state() ? 'internal_reason')
  AND NOT (public.my_access_state() ? 'created_by')
  AND NOT (public.my_access_state() ? 'correlation_id'));
SELECT t061_ok('suspended account is database denied', NOT public.current_student_can_access_app());

CREATE TEMP TABLE t061_schedule_result AS
  SELECT public.admin_tx_schedule_account_deletion(
    :ADM,'founder-061@test.invalid','Deletion decision context',gen_random_uuid(),:USER,
    'targeted_harassment','Your account is scheduled for deletion because repeated unwanted messages targeted another student.',
    'student_reports',NULL,true
  ) AS result;
SELECT t061_ok('seven-day schedule is atomic with email outbox',
  (SELECT result->>'status' FROM t061_schedule_result)='ok'
  AND EXISTS (SELECT 1 FROM public.account_deletion_jobs)
  AND EXISTS (SELECT 1 FROM public.transactional_email_outbox WHERE kind='admin_deletion_scheduled' AND state='pending'));

SELECT t061_ok('pending deletion outranks ordinary restriction without exposing internal data',
  public.my_access_state()->>'state'='deletion_pending'
  AND NOT public.current_student_can_access_app());

UPDATE public.account_deletion_jobs SET run_at=now();
CREATE TEMP TABLE t061_first_claim AS
  SELECT * FROM public.claim_account_deletion_jobs('worker-061-first',10);
SELECT t061_ok('first worker claims one due job',
  (SELECT count(*) FROM t061_first_claim)=1);
SELECT t061_ok('a second worker cannot claim the same job lease',
  (SELECT count(*) FROM public.claim_account_deletion_jobs('worker-061-second',10))=0);

CREATE TEMP TABLE t061_first_finalization AS
  SELECT public.finalize_claimed_account_deletion('worker-061-first',job_id) AS result
  FROM t061_first_claim;
SELECT t061_ok('worker finalizes the claimed account deletion once',
  (SELECT result->>'status' FROM t061_first_finalization)='finalized'
  AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id=:USER));

-- A lost worker response can leave a stale lease attempting to finalize an
-- already committed deletion. Recreate only that lease state here; the retry
-- must reconcile it without another destructive operation, audit event, or
-- transactional-email outbox row.
UPDATE public.account_deletion_jobs
   SET state='processing',claimed_by='worker-061-retry',claimed_at=now(),
       lease_expires_at=now()+interval '10 minutes',completed_at=NULL
 WHERE id=(SELECT job_id FROM t061_first_claim);
CREATE TEMP TABLE t061_completed_retry AS
  SELECT public.finalize_claimed_account_deletion('worker-061-retry',job_id) AS result
  FROM t061_first_claim;
SELECT t061_ok('completed worker retry is an honest no-op',
  (SELECT result->>'status' FROM t061_completed_retry)='already_completed'
  AND (SELECT state FROM public.account_deletion_jobs WHERE id=(SELECT job_id FROM t061_first_claim))='completed'
  AND (SELECT state FROM public.account_deletion_cases WHERE id=(SELECT case_id FROM t061_first_claim))='finalized');
SELECT t061_ok('completed worker retry does not duplicate audit or email work',
  (SELECT count(*) FROM public.transactional_email_outbox
    WHERE kind='admin_deletion_finalized'
      AND idempotency_key='deletion-finalized:' || (SELECT case_id::text FROM t061_first_claim))=1
  AND (SELECT count(*) FROM public.admin_audit_events
    WHERE action='deletion.finalize' AND target_id=:USER)=1);

-- This test runs as pgowner, so it deliberately verifies grants rather than
-- using table access itself. The public self-state RPC is callable; per-user
-- state and internal deletion tables are not student-readable.
SELECT t061_ok('least privilege grants are retained',
  has_function_privilege('authenticated','public.my_access_state()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.get_account_access_state(uuid)','EXECUTE')
  AND NOT has_table_privilege('authenticated','public.account_deletion_cases','SELECT')
  AND NOT has_table_privilege('authenticated','public.transactional_email_outbox','SELECT'));

SELECT name, ok FROM t061_results ORDER BY name;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM t061_results WHERE NOT ok) THEN
    RAISE EXCEPTION '061 harness failed';
  END IF;
END $$;
