-- ============================================================
-- Verification for migration 121's sync_store_app_release() role guard fix.
--
-- 117/119 rejected any caller whose `request.jwt.claim.role` GUC was not
-- EXACTLY 'service_role'. That assumption was false for this project's real
-- Edge Function → PostgREST call path (confirmed live: the deployed
-- sync-store-versions function got 42501 "service_role_required" from this
-- function's own RAISE, even while correctly holding the Postgres-level
-- EXECUTE grant proven below). 121 relaxes the in-body check to reject only
-- the two client-facing roles, relying on the REVOKE/GRANT as the real gate.
--
-- This test proves both halves of that fix:
--   1. anon is still rejected (in-body check)
--   2. authenticated is still rejected (in-body check)
--   3. an empty/unset role claim -- the real production condition for the
--      genuine service-role caller -- is now ALLOWED (this is the bug fix)
--   4. an exact 'service_role' claim still works (no regression)
--   5. the Postgres-level EXECUTE grant itself -- the actual security
--      boundary -- still denies anon/authenticated and allows service_role,
--      independent of any JWT claim GUC
-- ============================================================
BEGIN;

CREATE TEMP TABLE t_guard (test text, ok boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  v_msg  text;
  v_code text;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  BEGIN
    PERFORM public.sync_store_app_release('ios', '9.9.9-test121', 'https://example.com');
    INSERT INTO t_guard VALUES ('1 anon is rejected', false, 'no exception raised');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    INSERT INTO t_guard VALUES ('1 anon is rejected', true, SQLERRM);
  END;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM public.sync_store_app_release('ios', '9.9.9-test121', 'https://example.com');
    INSERT INTO t_guard VALUES ('2 authenticated is rejected', false, 'no exception raised');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    INSERT INTO t_guard VALUES ('2 authenticated is rejected', true, SQLERRM);
  END;

  PERFORM set_config('request.jwt.claim.role', '', true);
  BEGIN
    PERFORM public.sync_store_app_release('ios', '9.9.9-test121', 'https://example.com/reset');
    INSERT INTO t_guard VALUES ('3 empty/unset role claim is allowed (prod repro)', true, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_code = RETURNED_SQLSTATE;
    INSERT INTO t_guard VALUES ('3 empty/unset role claim is allowed (prod repro)', false, v_code || ': ' || v_msg);
  END;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  BEGIN
    PERFORM public.sync_store_app_release('ios', '9.9.9-test121', 'https://example.com/reset2');
    INSERT INTO t_guard VALUES ('4 exact service_role claim still allowed', true, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_code = RETURNED_SQLSTATE;
    INSERT INTO t_guard VALUES ('4 exact service_role claim still allowed', false, v_code || ': ' || v_msg);
  END;
END $$;

INSERT INTO t_guard
SELECT '5 EXECUTE grant: anon denied, authenticated denied, service_role allowed',
       NOT has_function_privilege('anon', 'public.sync_store_app_release(text,text,text,integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.sync_store_app_release(text,text,text,integer)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.sync_store_app_release(text,text,text,integer)', 'EXECUTE'),
       format('anon=%s authenticated=%s service_role=%s',
         has_function_privilege('anon', 'public.sync_store_app_release(text,text,text,integer)', 'EXECUTE'),
         has_function_privilege('authenticated', 'public.sync_store_app_release(text,text,text,integer)', 'EXECUTE'),
         has_function_privilege('service_role', 'public.sync_store_app_release(text,text,text,integer)', 'EXECUTE'));

\echo '=== GUARD TEST RESULTS ==='
SELECT * FROM t_guard ORDER BY test;

DO $$
DECLARE v_fail int;
BEGIN
  SELECT count(*) INTO v_fail FROM t_guard WHERE NOT ok;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'FAIL: % guard assertion(s) failed', v_fail;
  END IF;
  RAISE NOTICE 'PASS: all % guard assertions correct', (SELECT count(*) FROM t_guard);
END $$;

ROLLBACK;
