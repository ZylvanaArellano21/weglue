-- Day 10F hosted-runtime regression harness. Run only after a disposable
-- migration reset through 068; never run against Production.
--
-- docker exec -i supabase_db_weglue psql -U postgres -d postgres \
--   -v ON_ERROR_STOP=1 < supabase/scripts/test_068_deleted_message_privacy_runtime_fix.sql

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE t068_results (name text PRIMARY KEY, ok boolean NOT NULL);
GRANT INSERT ON t068_results TO service_role;

CREATE OR REPLACE FUNCTION t068_ok(p_name text, p_ok boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t068_results VALUES (p_name, COALESCE(p_ok, false));
END;
$$;

-- Match hosted PostgREST's JSON claim setting, rather than the retired
-- request.jwt.claim.role setting that caused the Production worker failure.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT t068_ok('valid service-role JSON claim is accepted', private.is_service_role_request());

SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false);
SELECT t068_ok('authenticated claim is denied', NOT private.is_service_role_request());

SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT t068_ok('anonymous claim is denied', NOT private.is_service_role_request());

SELECT set_config('request.jwt.claims', '', false);
SELECT t068_ok('missing claim is denied', NOT private.is_service_role_request());

SELECT set_config('request.jwt.claims', '{malformed', false);
SELECT t068_ok('malformed claim is denied', NOT private.is_service_role_request());

SELECT set_config('request.jwt.claims', '{"role":"platform_admin"}', false);
SELECT t068_ok('unexpected role is denied', NOT private.is_service_role_request());

SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT t068_ok(
  'service worker claim RPC succeeds with hosted JSON claim',
  (SELECT count(*) FROM public.claim_message_attachment_cleanup_jobs('day10f-runtime-fix', 1)) = 0
);

SELECT set_config('request.jwt.claims', '', false);
DO $$
BEGIN
  BEGIN
    PERFORM public.claim_message_attachment_cleanup_jobs('forged-worker', 1);
    RAISE EXCEPTION 'missing claims invoked service-only cleanup RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t068_ok('missing claim cannot invoke service worker RPC', true);
  END;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM t068_results WHERE NOT ok) THEN
    RAISE EXCEPTION '068 runtime-fix harness failed';
  END IF;
END;
$$;

SELECT count(*) FILTER (WHERE ok) AS passed,
       count(*) FILTER (WHERE NOT ok) AS failed,
       count(*) AS total
  FROM t068_results;

ROLLBACK;

SELECT '068 deleted-message privacy runtime-fix harness passed' AS result;
