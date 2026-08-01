-- ============================================================================
-- 059 — Restriction-enforcement hotfix
-- ============================================================================
--
-- Migration 058 shipped the account-restriction guard across 49 student RPCs
-- and 54 RLS policies. Two holes survived it. Both are closed here. 058 itself
-- is NOT edited — it is already applied to production, and rewriting an applied
-- migration would make the file disagree with the database it produced. 059
-- corrects the live database and, run in the normal 055 -> 056 -> 057 -> 058 ->
-- 059 order, brings a fresh environment to the same corrected state.
--
-- DEFECT 1 — create_poll was never wrapped
-- ---------------------------------------
-- 058's wrapper loop named its targets as handwritten signature strings, and
-- listed `create_poll(uuid,uuid,text,text[],boolean)`. The real function —
-- created in 040, replaced in 041 — takes EIGHT parameters:
--
--   create_poll(uuid, uuid, text, text[], boolean, timestamptz, timestamptz, uuid)
--
-- `('public.' || target)::regprocedure` therefore raised undefined_function, and
-- the loop's `EXCEPTION WHEN undefined_function ... CONTINUE` swallowed it. The
-- function stayed SECURITY DEFINER, student-callable, and unguarded, so a
-- suspended or platform-blocked student who was already a conversation
-- participant could still create a poll — which posts a visible message.
--
-- DEFECT 2 — check_club_inactivity() was executable by PUBLIC and anon
-- -------------------------------------------------------------------
-- Created in 006 as SECURITY DEFINER with no grant restriction, so it inherited
-- EXECUTE for PUBLIC, anon and authenticated. It warns clubs, notifies their
-- officers, and soft-deletes clubs (`is_active = false`). Any unauthenticated
-- caller could drive that. 006 also tried to schedule it under pg_cron inside
-- `EXCEPTION WHEN OTHERS THEN NULL`; that scheduling silently failed and the job
-- does not exist, so nothing legitimate calls this function today.
--
-- WHY NO SIGNATURE IS HANDWRITTEN BELOW
-- -------------------------------------
-- Every signature here is read out of pg_proc at run time. A handwritten
-- approximation is what caused defect 1, so this migration does not contain one.
-- Where a target cannot be resolved, it RAISES — silence is never an outcome.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. create_poll — rename-and-wrap, exactly as 058 does for the other 49
-- ---------------------------------------------------------------------------
DO $poll$
DECLARE
  v_oid       oid;
  v_count     int;
  v_ident     text;   -- args WITHOUT defaults  (for ALTER / REVOKE / GRANT)
  v_sig       text;   -- args WITH    defaults  (for the wrapper declaration)
  v_ret       text;
  v_nargs     int;
  v_callargs  text;
  v_names     int;
BEGIN
  -- Resolve by NAME and count overloads. 058 resolved by signature, which is
  -- precisely how it missed. A name lookup cannot silently match nothing.
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_poll';

  IF v_count = 0 AND NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'create_poll__inner') THEN
    RAISE EXCEPTION
      '059: public.create_poll not found. Expected from migration 040/041. '
      'Refusing to continue: a security wrapper that cannot find its target '
      'must fail loudly, never skip.';
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION
      '059: % overloads of public.create_poll exist. The intended target is '
      'ambiguous; refusing to guess which one to wrap.', v_count;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'create_poll__inner') THEN
    -- Already wrapped by a previous 059 run. Re-derive from the inner function
    -- and fall through, so grants and the wrapper body are re-asserted.
    SELECT p.oid INTO v_oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'create_poll__inner';
    RAISE NOTICE '059: create_poll already wrapped; re-asserting wrapper and grants.';
  ELSE
    SELECT p.oid INTO v_oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'create_poll';
  END IF;

  SELECT pg_get_function_identity_arguments(v_oid),
         pg_get_function_arguments(v_oid),
         pg_get_function_result(v_oid),
         p.pronargs
    INTO v_ident, v_sig, v_ret, v_nargs
    FROM pg_proc p WHERE p.oid = v_oid;

  -- Parameter NAMES for the pass-through call.
  SELECT string_agg(split_part(btrim(a), ' ', 1), ', '),
         count(*)
    INTO v_callargs, v_names
    FROM unnest(string_to_array(v_ident, ',')) a
   WHERE btrim(a) <> '';

  -- Splitting identity arguments on ',' is only correct while no parameter type
  -- contains a comma (none does here: uuid, text, text[], boolean, timestamptz).
  -- Assert it rather than assume it — a future numeric(10,2) parameter would
  -- otherwise silently produce a wrapper that calls the inner with wrong args.
  IF v_names <> v_nargs THEN
    RAISE EXCEPTION
      '059: derived % parameter names from identity arguments but pg_proc '
      'reports % parameters for create_poll. Refusing to build a wrapper from '
      'an argument list this migration cannot parse reliably.', v_names, v_nargs;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'create_poll__inner') THEN
    EXECUTE format('ALTER FUNCTION public.create_poll(%s) RENAME TO create_poll__inner;', v_ident);
  END IF;

  -- The inner implementation must be unreachable by any client role. This is
  -- what makes the guard non-bypassable: there is no second door.
  EXECUTE format(
    'REVOKE ALL ON FUNCTION public.create_poll__inner(%s) FROM PUBLIC, anon, authenticated;', v_ident);

  -- The wrapper is declared with pg_get_function_arguments (DEFAULTS KEPT). If
  -- the defaults were dropped, every client calling create_poll(a,b,c,d) — the
  -- four-argument form the mobile app uses — would start failing with
  -- "function does not exist". This is the bug that bit 058's first attempt at
  -- get_my_blocked_users(), so it is stated explicitly here.
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.create_poll(%s) RETURNS %s
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
    AS $body$
    BEGIN
      -- Authentication first: an unauthenticated caller must keep receiving the
      -- established 'not_authenticated' error from the inner implementation,
      -- NOT an account-restriction error. Only a signed-in, restricted student
      -- is turned away here.
      IF (SELECT auth.uid()) IS NOT NULL
         AND NOT public.current_student_can_access_app() THEN
        RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
      END IF;
      RETURN public.create_poll__inner(%s);
    END;
    $body$;$f$, v_sig, v_ret, v_callargs);

  EXECUTE format('REVOKE ALL ON FUNCTION public.create_poll(%s) FROM PUBLIC, anon;', v_ident);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.create_poll(%s) TO authenticated;', v_ident);

  RAISE NOTICE '059: create_poll wrapped (% params, returns %).', v_nargs, v_ret;
END
$poll$;

-- ---------------------------------------------------------------------------
-- 2. check_club_inactivity — internal-only execution
-- ---------------------------------------------------------------------------
-- Caller analysis (production, 2026-08-01) found NO legitimate caller:
--   pg_cron            : installed, 2 jobs (process_event_reminders,
--                        invoke_push_dispatch). Neither calls this function.
--                        006's own cron.schedule() failed silently.
--   other DB functions : none reference it (pg_proc.prosrc scan).
--   triggers           : none.
--   Edge Functions     : none.
--   application code   : none — the only repository hit is a generated type in
--                        packages/database/src/types.ts, not a call site.
--   student clients    : none.
-- Revoking client access therefore removes attack surface without removing any
-- behaviour that anything currently depends on. service_role keeps EXECUTE so a
-- server-side job or a future pg_cron entry can run it; postgres owns it and is
-- unaffected by these grants.
DO $cci$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'check_club_inactivity' AND p.pronargs = 0)
  THEN
    RAISE EXCEPTION
      '059: public.check_club_inactivity() not found. Expected from migration '
      '006. Refusing to continue rather than silently skipping a grant fix.';
  END IF;
END
$cci$;

-- Three separate REVOKEs, deliberately. `REVOKE ... FROM PUBLIC` removes only
-- the PUBLIC (`=X/owner`) entry; it does NOT remove the explicit `anon=X/owner`
-- and `authenticated=X/owner` entries that Supabase's ALTER DEFAULT PRIVILEGES
-- grants to every new function. Revoking from PUBLIC alone would have left this
-- function fully student-callable while appearing fixed.
REVOKE ALL ON FUNCTION public.check_club_inactivity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_club_inactivity() FROM anon;
REVOKE ALL ON FUNCTION public.check_club_inactivity() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_club_inactivity() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Fail-closed post-conditions
-- ---------------------------------------------------------------------------
-- 058 could report success while having silently protected nothing. This block
-- makes that impossible for 059: the migration verifies its own outcome from the
-- catalog and aborts the transaction if any invariant does not hold.
--
-- proacl IS NULL is treated as PUBLIC-EXECUTABLE, because that is what
-- PostgreSQL means by it — the default ACL for a function grants EXECUTE to
-- PUBLIC. An earlier audit that read NULL as "no grants" is exactly how the
-- check_club_inactivity exposure stayed hidden.
DO $verify$
DECLARE
  v_oid      oid;
  v_ident    text;
  v_acl      aclitem[];
  v_nargs    int;
  v_ndefs    int;
  v_ret      text;
  v_prosrc   text;
  v_public   boolean;
BEGIN
  -- 3a. create_poll wrapper: client-visible signature preserved
  SELECT p.oid, pg_get_function_identity_arguments(p.oid), p.pronargs,
         p.pronargdefaults, pg_get_function_result(p.oid), p.prosrc, p.proacl
    INTO v_oid, v_ident, v_nargs, v_ndefs, v_ret, v_prosrc, v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_poll';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION '059 VERIFY: public.create_poll is missing after wrapping.';
  END IF;
  IF v_nargs <> 8 OR v_ndefs <> 4 THEN
    RAISE EXCEPTION
      '059 VERIFY: create_poll wrapper has %/% params/defaults, expected 8/4. '
      'Clients calling the short form would break.', v_nargs, v_ndefs;
  END IF;
  IF v_ret <> 'json' THEN
    RAISE EXCEPTION '059 VERIFY: create_poll returns %, expected json.', v_ret;
  END IF;
  IF v_prosrc NOT LIKE '%current_student_can_access_app%' THEN
    RAISE EXCEPTION '059 VERIFY: create_poll wrapper does not invoke the restriction guard.';
  END IF;
  IF v_prosrc NOT LIKE '%create_poll__inner%' THEN
    RAISE EXCEPTION '059 VERIFY: create_poll wrapper does not delegate to its inner implementation.';
  END IF;

  -- 3b. create_poll wrapper reachable by students, not by anon or PUBLIC
  v_public := v_acl IS NULL OR EXISTS (SELECT 1 FROM unnest(v_acl) a WHERE a::text LIKE '=%');
  IF v_public THEN
    RAISE EXCEPTION '059 VERIFY: create_poll is still executable by PUBLIC.';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '059 VERIFY: create_poll is still executable by anon.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '059 VERIFY: create_poll is NOT executable by authenticated — students could no longer create polls.';
  END IF;

  -- 3c. inner implementation unreachable by every client role
  SELECT p.oid, p.proacl INTO v_oid, v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_poll__inner';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '059 VERIFY: create_poll__inner is missing.';
  END IF;
  v_public := v_acl IS NULL OR EXISTS (SELECT 1 FROM unnest(v_acl) a WHERE a::text LIKE '=%');
  IF v_public
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      '059 VERIFY: create_poll__inner is still reachable by a client role. The '
      'guard would be bypassable by calling the inner function directly.';
  END IF;

  -- 3d. check_club_inactivity internal-only
  SELECT p.oid, p.proacl INTO v_oid, v_acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'check_club_inactivity';
  v_public := v_acl IS NULL OR EXISTS (SELECT 1 FROM unnest(v_acl) a WHERE a::text LIKE '=%');
  IF v_public THEN
    RAISE EXCEPTION '059 VERIFY: check_club_inactivity is still executable by PUBLIC.';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '059 VERIFY: check_club_inactivity is still executable by anon.';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '059 VERIFY: check_club_inactivity is still executable by authenticated.';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '059 VERIFY: check_club_inactivity lost service_role EXECUTE — internal processing could not run.';
  END IF;

  RAISE NOTICE '059: all post-conditions verified.';
END
$verify$;

-- ---------------------------------------------------------------------------
-- 4. Guard-coverage invariant — the replacement for 058's silent CONTINUE
-- ---------------------------------------------------------------------------
-- The permanent, catalog-driven version of this check lives in
-- supabase/scripts/test_058_secdef_coverage.sql and runs in CI. This block is
-- its migration-time counterpart, narrowed to the one property that must never
-- regress unnoticed: a SECURITY DEFINER function that WRITES and is reachable by
-- a student must either invoke the restriction guard or be an explicitly
-- recognised exception. Anything else aborts this migration.
DO $coverage$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', E'\n  ')
    INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND p.proname NOT LIKE '%\_\_inner'
     -- Trigger functions are fired by the database, never invoked by a client,
     -- and cannot be reached through PostgREST regardless of their grants.
     AND p.prorettype <> 'pg_catalog.trigger'::regtype
     -- writes
     AND (p.prosrc ~* '\m(insert|update|delete|truncate)\M')
     -- reachable by a student (explicit grant, or NULL acl = PUBLIC default)
     AND (p.proacl IS NULL
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
          OR EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=%'))
     -- not guarded, directly or by delegating to a guarded inner twin
     AND p.prosrc NOT LIKE '%current_student_can_access_app%'
     AND NOT EXISTS (
           SELECT 1 FROM pg_proc q JOIN pg_namespace m ON m.oid = q.pronamespace
            WHERE m.nspname = 'public' AND q.proname = p.proname || '__inner')
     -- Recognised exceptions, each justified:
     --   auth_signup_status / ensure_profile / replace_pending_signup run
     --     BEFORE a session exists; guarding them would break sign-up itself.
     --   admin_* / private helpers are service-role only and audited.
     --   delete_own_account_atomic MUST stay reachable while restricted. A
     --     suspended or blocked student is still entitled to delete their own
     --     account, and Apple 5.1.1(v) requires that path to work. 058 documents
     --     this exemption at its line 843; guarding it would be a store defect.
     --   handle_new_user is a trigger function, never called by a client.
     -- check_club_inactivity is deliberately ABSENT from this list: after
     -- section 2 it is no longer student-reachable, so it cannot match. Listing
     -- it would mask a future re-grant, which is the whole failure mode 059 exists
     -- to prevent.
     AND p.proname NOT IN (
       'auth_signup_status', 'ensure_profile', 'replace_pending_signup',
       'handle_new_user', 'delete_own_account_atomic'
     )
     AND p.proname NOT LIKE 'admin\_%'
     AND p.proname NOT LIKE 'admin\_tx\_%';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      E'059 COVERAGE: unguarded student-callable SECURITY DEFINER writer(s):\n  %\n'
      'Each must be wrapped with the restriction guard or added to the '
      'recognised-exception list with a written justification.', v_bad;
  END IF;

  RAISE NOTICE '059: guard-coverage invariant holds.';
END
$coverage$;

COMMIT;
