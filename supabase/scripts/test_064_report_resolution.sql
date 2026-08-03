-- Day 10D local database/security harness. Run only against a disposable local DB.
DO $$
DECLARE
  v_count integer;
  v_rls boolean;
  v_force boolean;
  v_fn_count integer;
BEGIN
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'report_decision_history';
  IF NOT v_rls OR NOT v_force THEN RAISE EXCEPTION 'report decision history must force RLS'; END IF;

  SELECT count(*) INTO v_count FROM public.admin_audit_actions
   WHERE action IN ('report.review','report.resolve','report.dismiss','report.viewEvidence');
  IF v_count <> 4 THEN RAISE EXCEPTION 'missing Day 10D audit catalog entries'; END IF;

  SELECT count(*) INTO v_fn_count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('admin_tx_report_set_status','admin_tx_report_decide','admin_tx_report_supersede');
  IF v_fn_count <> 3 THEN RAISE EXCEPTION 'missing Day 10D RPCs'; END IF;

  IF has_function_privilege('anon', 'public.admin_tx_report_decide(uuid,text,text,uuid,uuid,text,text,text,text,text,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_tx_report_decide(uuid,text,text,uuid,uuid,text,text,text,text,text,text,timestamptz)', 'EXECUTE')
  THEN RAISE EXCEPTION 'students must not execute report decision RPC'; END IF;

  IF NOT has_function_privilege('service_role', 'public.admin_tx_report_decide(uuid,text,text,uuid,uuid,text,text,text,text,text,text,timestamptz)', 'EXECUTE')
  THEN RAISE EXCEPTION 'service_role must execute report decision RPC'; END IF;

  IF has_function_privilege('authenticated', 'public.complete_report_notification_delivery(uuid,uuid,boolean,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.complete_report_notification_delivery(uuid,uuid,boolean,text)', 'EXECUTE')
  THEN RAISE EXCEPTION 'notification delivery RPC grants are incorrect'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'report_decision_history_immutable') THEN
    RAISE EXCEPTION 'decision history immutable trigger missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactional_email_outbox_kind_check') THEN
    RAISE EXCEPTION 'outbox kind constraint missing';
  END IF;
END;
$$;

SELECT '064 report resolution schema/security harness passed' AS result;

BEGIN;
INSERT INTO public.reports (id, entity_type, entity_id, reason, status)
VALUES ('00000000-0000-0000-0000-000000006401', 'user', '00000000-0000-0000-0000-000000006402', 'test', 'pending');

SELECT public.admin_tx_report_decide(
  '00000000-0000-0000-0000-000000006403', 'founder@test.invalid',
  'Day 10D harness decision', '00000000-0000-0000-0000-000000006404',
  '00000000-0000-0000-0000-000000006401', 'dismissed', 'duplicate_or_invalid',
  'Harness decision is retained for verification.', NULL, NULL, 'none', NULL
)->>'status' AS decision_status;

DO $$
DECLARE v_status text; v_history integer;
BEGIN
  SELECT status INTO v_status FROM public.reports WHERE id = '00000000-0000-0000-0000-000000006401';
  SELECT count(*) INTO v_history FROM public.report_decision_history WHERE report_id = '00000000-0000-0000-0000-000000006401';
  IF v_status <> 'dismissed' OR v_history <> 1 THEN RAISE EXCEPTION 'terminal decision did not persist'; END IF;
  BEGIN
    UPDATE public.report_decision_history SET internal_decision_note = 'tampered' WHERE report_id = '00000000-0000-0000-0000-000000006401';
    RAISE EXCEPTION 'immutable history update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55006' THEN NULL;
  END;
END;
$$;
ROLLBACK;

SELECT '064 report decision transaction harness passed' AS result;
