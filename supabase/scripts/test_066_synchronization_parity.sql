-- Day 10E local database/security harness. Run only after a disposable local
-- reset with migrations through 066; never run it against Production.
--
-- docker exec -i supabase_db_weglue psql -U postgres -d postgres \
--   -v ON_ERROR_STOP=1 < supabase/scripts/test_066_synchronization_parity.sql

\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  v_access_fn text;
  v_content_fn text;
  v_policy text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'private' AND p.proname = 'can_receive_access_sync')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'private' AND p.proname = 'can_receive_university_sync')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'my_sync_university_id') THEN
    RAISE EXCEPTION 'Day 10E receive helpers are missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_broadcast_account_restriction_sync')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_broadcast_account_deletion_sync')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_broadcast_content_lifecycle_sync') THEN
    RAISE EXCEPTION 'Day 10E canonical-table triggers are missing';
  END IF;

  SELECT pg_get_functiondef('private.broadcast_access_sync()'::regprocedure) INTO v_access_fn;
  SELECT pg_get_functiondef('private.broadcast_content_lifecycle_sync()'::regprocedure) INTO v_content_fn;
  IF position('''{}''::jsonb' IN v_access_fn) = 0
     OR position('''{}''::jsonb' IN v_content_fn) = 0
     OR v_access_fn ~* '(internal_reason|public_reason|email|correlation|audit|report|evidence)'
     OR v_content_fn ~* '(internal_reason|public_reason|email|correlation|audit|report|evidence)' THEN
    RAISE EXCEPTION 'Day 10E broadcasts must remain opaque and metadata-free';
  END IF;

  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_policy
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'realtime' AND c.relname = 'messages' AND p.polname = 'weglue_receive_access_sync';
  IF v_policy IS NULL OR position('can_receive_access_sync' IN v_policy) = 0
     OR position('extension = ''broadcast''' IN v_policy) = 0 THEN
    RAISE EXCEPTION 'account sync receive policy is not private broadcast-only';
  END IF;

  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_policy
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'realtime' AND c.relname = 'messages' AND p.polname = 'weglue_receive_university_sync';
  IF v_policy IS NULL OR position('can_receive_university_sync' IN v_policy) = 0
     OR position('extension = ''broadcast''' IN v_policy) = 0 THEN
    RAISE EXCEPTION 'university sync receive policy is not private broadcast-only';
  END IF;

  IF has_function_privilege('anon', 'private.can_receive_access_sync(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.can_receive_university_sync(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.broadcast_access_sync()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.broadcast_content_lifecycle_sync()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.my_sync_university_id()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Day 10E grants exceed receive-only least privilege';
  END IF;
END;
$$;

BEGIN;
INSERT INTO public.universities (id, name, slug) VALUES
  ('a6500000-0000-4000-8000-0000000000a1', 'Day 10E Alpha', 'day-10e-alpha'),
  ('a6500000-0000-4000-8000-0000000000a2', 'Day 10E Beta', 'day-10e-beta');
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('a6500000-0000-4000-8000-000000000001', 'day10e-alpha@test.invalid', '{}'::jsonb),
  ('a6500000-0000-4000-8000-000000000002', 'day10e-beta@test.invalid', '{}'::jsonb);
INSERT INTO public.profiles (id, username, full_name, university_id) VALUES
  ('a6500000-0000-4000-8000-000000000001', 'day10ealpha', 'Day 10E Alpha', 'a6500000-0000-4000-8000-0000000000a1'),
  ('a6500000-0000-4000-8000-000000000002', 'day10ebeta', 'Day 10E Beta', 'a6500000-0000-4000-8000-0000000000a2')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a6500000-0000-4000-8000-000000000001')::text,
  false
);

DO $$
BEGIN
  IF NOT private.can_receive_access_sync('sync:access:a6500000-0000-4000-8000-000000000001')
     OR private.can_receive_access_sync('sync:access:a6500000-0000-4000-8000-000000000002')
     OR private.can_receive_access_sync('sync:access:not-a-uuid') THEN
    RAISE EXCEPTION 'account sync topic must be self-scoped and malformed topics denied';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT private.can_receive_university_sync('sync:university:a6500000-0000-4000-8000-0000000000a1')
     OR private.can_receive_university_sync('sync:university:a6500000-0000-4000-8000-0000000000a2') THEN
    RAISE EXCEPTION 'university sync topic must be limited to the caller campus';
  END IF;
END;
$$;

DO $$
BEGIN
  IF public.my_sync_university_id() <> 'a6500000-0000-4000-8000-0000000000a1'::uuid THEN
    RAISE EXCEPTION 'student university topic resolver must be self-scoped';
  END IF;
END;
$$;

SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a6500000-0000-4000-8000-000000000002')::text,
  false
);

DO $$
BEGIN
  IF private.can_receive_university_sync('sync:university:a6500000-0000-4000-8000-0000000000a1')
     OR NOT private.can_receive_university_sync('sync:university:a6500000-0000-4000-8000-0000000000a2') THEN
    RAISE EXCEPTION 'another student must not receive a different university topic';
  END IF;
END;
$$;

DO $$
BEGIN
  IF public.my_sync_university_id() <> 'a6500000-0000-4000-8000-0000000000a2'::uuid THEN
    RAISE EXCEPTION 'student university topic resolver must not return another campus';
  END IF;
END;
$$;
RESET ROLE;
ROLLBACK;

SELECT '066 synchronization parity schema/security harness passed' AS result;
