-- ============================================================================
-- 092 — app_releases privilege lockdown (fixes a real gap in 090)
-- ============================================================================
--
-- Migration 075 documents that this Production database's
-- ALTER DEFAULT PRIVILEGES rule grants anon/authenticated/service_role ALL
-- EIGHT privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
-- TRIGGER, MAINTAIN) on every NEWLY CREATED table, and that the underlying
-- default-privilege rule itself was never disabled — only retroactively
-- revoked on the tables that existed at the time 075 ran. 090's
-- `CREATE TABLE public.app_releases` therefore silently inherited that same
-- blanket, because I did not know about this convention when I wrote that
-- migration. Confirmed directly on Production after 090 applied:
-- `anon` AND `authenticated` both held INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES and TRIGGER on app_releases — none of which were ever intended.
--
-- RLS (ENABLE ROW LEVEL SECURITY, only a FOR SELECT policy) means an actual
-- INSERT from anon/authenticated would be rejected and an UPDATE/DELETE would
-- affect zero rows regardless of the extra grants — but TRUNCATE is NOT
-- subject to row-level security at all in Postgres, and 075's own comment
-- says this plainly. This closes that gap immediately, following the exact
-- established pattern from 075 section 3: REVOKE ALL, then GRANT back only
-- what the existing policy already authorizes.
--
-- anon gets nothing: app_releases is only ever read from inside the
-- authenticated app (Home tab), never from the pre-authentication surface
-- 075 section 2 documents (campus list, club browsing, deletion requests).
-- ============================================================================

BEGIN;

REVOKE ALL ON public.app_releases FROM anon, authenticated;
GRANT SELECT ON public.app_releases TO authenticated;

-- Fail-closed self-check, INSIDE the transaction, before COMMIT — 075's own
-- documented lesson: a check that runs after COMMIT can find a real problem
-- too late to roll anything back.
DO $$
DECLARE
  v_bad_count int;
BEGIN
  SELECT count(*) INTO v_bad_count
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'app_releases'
     AND grantee IN ('anon', 'authenticated')
     AND NOT (grantee = 'authenticated' AND privilege_type = 'SELECT');
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION '092: app_releases still has % unexpected grant(s) after lockdown', v_bad_count;
  END IF;
END $$;

COMMIT;
