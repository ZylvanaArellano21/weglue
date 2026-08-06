-- =============================================================================
-- FULL-CHAIN HARNESS BRIDGE — production-shaped table privileges
--
-- THIS IS A TEST-ENVIRONMENT BRIDGE. It is never applied to production and adds
-- no product behaviour. Run it immediately after `supabase db reset` and before
-- any harness that acts as the `authenticated` role on the full 001->073 chain.
--
-- WHY IT EXISTS
--
-- Every migration in this repository was authored against a Supabase project
-- whose `ALTER DEFAULT PRIVILEGES IN SCHEMA public` grants anon/authenticated/
-- service_role full DML on each newly created table. Migrations 055, 057, 058,
-- 061 and 063 say so explicitly in their comments and REVOKE those defaults
-- back off the tables that must stay locked.
--
-- The Supabase CLI image used locally (postgres 17.6.1.139, CLI 2.108.0) ships
-- narrower defaults: `anon=Dxtm/postgres`, i.e. DELETE/TRUNCATE/REFERENCES/
-- TRIGGER/MAINTAIN but NOT SELECT/INSERT/UPDATE. On a fresh local reset,
-- `authenticated` therefore cannot SELECT `posts`, `profiles`, `clubs` or
-- anything else, and every RLS assertion fails with `permission denied` before
-- a policy is ever consulted.
--
-- The compact 057 fixture hid this by issuing a blanket
-- `GRANT ... ON ALL TABLES IN SCHEMA public`, which is why earlier harness runs
-- on the compact chain never surfaced it.
--
-- This bridge reproduces the production privilege shape: the historical blanket
-- default, followed by the canonical REVOKE/GRANT pairs copied verbatim from
-- the migrations that own each protected table. It therefore makes the full
-- chain testable WITHOUT loosening any table the product deliberately locks.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 1. The historical Supabase default that every migration assumed.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;

-- 2. Canonical protected-table posture, verbatim from the owning migrations.

-- 055_durable_admin_audit.sql
REVOKE ALL ON TABLE public.admin_audit_events  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_audit_actions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_audit_events  TO service_role;
GRANT SELECT ON TABLE public.admin_audit_actions TO service_role;

-- 057_student_blocking.sql — mutation is RPC-only, in both directions.
REVOKE ALL     ON public.user_blocks FROM anon;
REVOKE ALL     ON public.user_blocks FROM authenticated;
REVOKE ALL     ON public.user_blocks FROM service_role;
GRANT  SELECT  ON public.user_blocks TO authenticated;
GRANT  SELECT  ON public.user_blocks TO service_role;

-- 058_admin_restrictions.sql
REVOKE ALL    ON public.account_restrictions FROM anon;
REVOKE ALL    ON public.account_restrictions FROM authenticated;
REVOKE ALL    ON public.account_restrictions FROM service_role;
GRANT  SELECT ON public.account_restrictions TO service_role;

-- 061_restriction_reasons_account_deletion.sql
REVOKE ALL ON public.account_deletion_cases       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.account_deletion_jobs        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.transactional_email_outbox   FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.account_deletion_cases, public.account_deletion_jobs,
                public.transactional_email_outbox TO service_role;

-- 063_content_lifecycle_dashboard.sql
REVOKE ALL ON public.content_lifecycle FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.content_lifecycle TO service_role;
REVOKE ALL ON public.admin_content_lifecycle_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.admin_content_lifecycle_records TO service_role;

COMMIT;

-- 3. Assert the bridge did not silently unlock a protected table. A harness
--    that runs on an over-granted database proves nothing.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'admin_audit_events', 'admin_audit_actions', 'account_restrictions',
    'account_deletion_cases', 'account_deletion_jobs',
    'transactional_email_outbox', 'content_lifecycle',
    'admin_content_lifecycle_records'
  ] LOOP
    IF has_table_privilege('authenticated', 'public.' || quote_ident(v_table), 'SELECT') THEN
      RAISE EXCEPTION 'bridge: % must stay unreadable by authenticated', v_table;
    END IF;
  END LOOP;

  -- user_blocks is readable but never writable by a client.
  IF NOT has_table_privilege('authenticated', 'public.user_blocks', 'SELECT')
     OR has_table_privilege('authenticated', 'public.user_blocks', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_blocks', 'DELETE') THEN
    RAISE EXCEPTION 'bridge: user_blocks privilege shape is wrong';
  END IF;

  -- Positive control: the ordinary content tables must now be reachable, or
  -- every RLS assertion downstream would pass vacuously.
  IF NOT has_table_privilege('authenticated', 'public.posts', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.clubs', 'SELECT') THEN
    RAISE EXCEPTION 'bridge: ordinary content tables are still unreachable';
  END IF;
END;
$$;

SELECT 'full-chain grants bridge applied' AS result;
