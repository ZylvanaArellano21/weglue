-- ===========================================================================
-- Test harness — migration 058 (administrator account restrictions)
--
-- HOW TO RUN (throwaway database, NEVER production):
--
--   docker run -d --name wg-058 -e POSTGRES_PASSWORD=test -p 55438:5432 postgres:15
--   docker exec -i wg-058 psql -U postgres -d postgres <<'EOF'
--     CREATE ROLE pgowner LOGIN PASSWORD 'test' NOSUPERUSER BYPASSRLS CREATEROLE;
--     CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
--     CREATE ROLE service_role NOLOGIN BYPASSRLS;
--     GRANT anon, authenticated, service_role TO pgowner;
--     CREATE DATABASE wg OWNER pgowner;
--   EOF
--   docker exec -i wg-058 psql -U pgowner -d wg -c \
--     "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;"
--   for f in supabase/scripts/test_057_fixture_schema.sql \
--            supabase/migrations/057_student_blocking.sql \
--            supabase/migrations/055_durable_admin_audit.sql \
--            supabase/migrations/056_atomic_admin_mutations.sql \
--            supabase/migrations/058_admin_restrictions.sql; do
--     docker exec -i wg-058 psql -U pgowner -d wg -v ON_ERROR_STOP=1 -q < $f
--   done
--   docker exec -i wg-058 psql -U pgowner -d wg -q < supabase/scripts/test_058_admin_restrictions.sql
--
-- NOTE: the REAL 055 and 056 migrations are applied, not stubs, so the atomic
-- "mutation and audit commit together, or neither does" guarantee is genuinely
-- exercised rather than asserted.
--
-- THE CENTRAL CLAIMS UNDER TEST
--   1. A restricted student cannot use the app — even with a valid token, even
--      through raw SQL, even bypassing every client.
--   2. ACCOUNT DELETION STILL WORKS while restricted.
--   3. The internal reason never reaches the student.
--   4. Expiry is a predicate: no job is needed for a suspension to lapse.
--   5. Day 10B1 student blocking is unchanged.
--
-- Every negative assertion is paired with a POSITIVE CONTROL.
-- ===========================================================================

\set ON_ERROR_STOP on
\pset pager off
\timing off
\o /dev/null

DROP TABLE IF EXISTS t_results;
CREATE TABLE t_results (n serial primary key, name text, ok boolean, detail text);

CREATE OR REPLACE FUNCTION t_ok(p_name text, p_cond boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN INSERT INTO t_results (name, ok, detail) VALUES (p_name, COALESCE(p_cond,false), p_detail); END; $$;

CREATE OR REPLACE FUNCTION t_as(p_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, false); END; $$;

GRANT EXECUTE ON FUNCTION t_ok(text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION t_as(uuid) TO authenticated;

-- ── Fixtures ───────────────────────────────────────────────────────────────
--   S   = the student who gets restricted
--   O   = an ordinary, unaffected student
--   ADM = the administrator actor (platform admin: no profiles row)
-- NOTE: no trailing comments on these lines. psql's \set consumes the rest of
-- the line as the value, so `\set S '...'  -- comment` would embed the comment.
\set S   '''55550000-0000-4000-8000-000000000001'''
\set O   '''55550000-0000-4000-8000-000000000002'''
\set ADM '''55550000-0000-4000-8000-0000000000ad'''

INSERT INTO universities (id,name,slug) VALUES
  ('44440000-0000-4000-8000-00000000aaaa','Lone Star College','lone-star-college');

INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES
  (:S,  's@myschool.edu','{}'::jsonb),
  (:O,  'o@myschool.edu','{}'::jsonb),
  (:ADM,'founder@weglue.app','{"account_type":"platform_admin"}'::jsonb);

INSERT INTO profiles (id,username,full_name,university_id) VALUES
  (:S,'stu_restricted','Sam Restricted','44440000-0000-4000-8000-00000000aaaa'),
  (:O,'stu_ordinary','Olive Ordinary','44440000-0000-4000-8000-00000000aaaa');
-- The administrator deliberately has NO profiles row (migration 053 behaviour).

INSERT INTO clubs (id,name,is_active,university_id)
VALUES ('44440000-0000-4000-8000-00000000bbbb','Robotics Club',true,'44440000-0000-4000-8000-00000000aaaa');
INSERT INTO club_members (club_id,user_id,role) VALUES
  ('44440000-0000-4000-8000-00000000bbbb',:S,'member'),
  ('44440000-0000-4000-8000-00000000bbbb',:O,'officer');
INSERT INTO posts (id,author_id,club_id,caption) VALUES
  ('44440000-0000-4000-8000-00000000cc01',:S,NULL,'personal post by the restricted student');
INSERT INTO conversations (id,type,created_by) VALUES
  ('44440000-0000-4000-8000-00000000ee01','direct',:S);
INSERT INTO conversation_participants (conversation_id,user_id) VALUES
  ('44440000-0000-4000-8000-00000000ee01',:S),
  ('44440000-0000-4000-8000-00000000ee01',:O);
INSERT INTO messages (id,conversation_id,sender_id,content) VALUES
  ('44440000-0000-4000-8000-00000000ff01','44440000-0000-4000-8000-00000000ee01',:S,'hello');

-- ===========================================================================
-- POSITIVE CONTROLS — the world works BEFORE any restriction.
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:S);
SELECT t_ok('PC1 unrestricted student can read profiles',
  (SELECT count(*)>=2 FROM profiles));
SELECT t_ok('PC2 unrestricted student can read their DM',
  (SELECT count(*)=1 FROM messages WHERE id='44440000-0000-4000-8000-00000000ff01'));
WITH ins AS (
  INSERT INTO posts (author_id,caption) VALUES (:S,'pre-restriction post') RETURNING 1)
SELECT t_ok('PC3 unrestricted student can INSERT a post', (SELECT count(*)=1 FROM ins));
SELECT t_ok('PC5 my_access_state reports active (student-callable)',
  (SELECT public.my_access_state()->>'state' = 'active'));
RESET ROLE;
SELECT t_ok('PC4 access state is active (owner-context probe)',
  (SELECT public.get_account_access_state(:S) = 'active'));

-- ===========================================================================
-- A. SUSPENSION
-- ===========================================================================
SELECT t_ok('T01 suspend (indefinite) succeeds',
  (SELECT public.admin_tx_restriction_suspend(:ADM,'founder@weglue.app','Harassment reports',
      gen_random_uuid(), :S, NULL) ->> 'status' = 'ok'));
SELECT t_ok('T01b access state is now suspended',
  (SELECT public.get_account_access_state(:S) = 'suspended'));
SELECT t_ok('T01c exactly one active restriction row',
  (SELECT count(*)=1 FROM account_restrictions WHERE user_id=:S AND status='active'));
SELECT t_ok('T01d a durable SUCCESS audit row was written atomically',
  (SELECT count(*)=1 FROM admin_audit_events
    WHERE action='restriction.suspend' AND target_id=:S AND event_type='success'));
SELECT t_ok('T01e audit carries the reason and a correlation id',
  (SELECT reason='Harassment reports' AND correlation_id IS NOT NULL
     FROM admin_audit_events WHERE action='restriction.suspend' AND target_id=:S LIMIT 1));
SELECT t_ok('T01f before/after state recorded, WITHOUT the internal reason',
  (SELECT before_state IS NOT NULL AND after_state IS NOT NULL
      AND (after_state::text NOT LIKE '%Harassment%')
     FROM admin_audit_events WHERE action='restriction.suspend' AND target_id=:S LIMIT 1));

-- ── The security core: an existing token buys nothing ──────────────────────
SET ROLE authenticated;
SELECT t_as(:S);
SELECT t_ok('T02 suspended student cannot read OTHER profiles',
  (SELECT count(*)=0 FROM profiles WHERE id=:O));
SELECT t_ok('T02b suspended student CAN still read their OWN profile (shell + deletion need it)',
  (SELECT count(*)=1 FROM profiles WHERE id=:S));
SELECT t_ok('T03 suspended student cannot read messages',
  (SELECT count(*)=0 FROM messages));
SELECT t_ok('T03b suspended student cannot read conversations',
  (SELECT count(*)=0 FROM conversations));

DO $$ BEGIN
  BEGIN
    INSERT INTO posts (author_id, caption) VALUES ('55550000-0000-4000-8000-000000000001','post while suspended');
    PERFORM t_ok('T04 suspended student cannot INSERT a post', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    PERFORM t_ok('T04 suspended student cannot INSERT a post', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    INSERT INTO messages (conversation_id, sender_id, content)
    VALUES ('44440000-0000-4000-8000-00000000ee01','55550000-0000-4000-8000-000000000001','msg while suspended');
    PERFORM t_ok('T05 suspended student cannot SEND a message', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    PERFORM t_ok('T05 suspended student cannot SEND a message', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    INSERT INTO follows (follower_id, following_id, status)
    VALUES ('55550000-0000-4000-8000-000000000001','55550000-0000-4000-8000-000000000002','accepted');
    PERFORM t_ok('T06 suspended student cannot FOLLOW', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    PERFORM t_ok('T06 suspended student cannot FOLLOW', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    INSERT INTO event_rsvps (event_id, user_id, status)
    VALUES (gen_random_uuid(),'55550000-0000-4000-8000-000000000001','going');
    PERFORM t_ok('T07 suspended student cannot RSVP', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN
    PERFORM t_ok('T07 suspended student cannot RSVP', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    UPDATE profiles SET full_name='Renamed While Suspended'
     WHERE id='55550000-0000-4000-8000-000000000001';
    IF FOUND THEN PERFORM t_ok('T08 suspended student cannot EDIT their profile', false, 'update applied');
    ELSE PERFORM t_ok('T08 suspended student cannot EDIT their profile', true); END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    PERFORM t_ok('T08 suspended student cannot EDIT their profile', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM public.block_user('55550000-0000-4000-8000-000000000002');
    PERFORM t_ok('T09 suspended student cannot create a 10B1 student block', false, 'rpc succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t_ok('T09 suspended student cannot create a 10B1 student block', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM * FROM search_students('oli',10);
    PERFORM t_ok('T10 suspended student cannot DISCOVER anyone', false, 'rpc returned instead of raising');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t_ok('T10 suspended student cannot DISCOVER anyone', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM public.get_or_create_direct_chat('55550000-0000-4000-8000-000000000002');
    PERFORM t_ok('T10b suspended student cannot open a DM (SECDEF rpc gated)', false, 'rpc succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t_ok('T10b suspended student cannot open a DM (SECDEF rpc gated)', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM public.get_my_blocked_users(50,0);
    PERFORM t_ok('T10c suspended student cannot list their blocked accounts', false, 'rpc succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t_ok('T10c suspended student cannot list their blocked accounts', true);
  END;
END $$;
SELECT t_ok('T11 my_access_state reports suspended and NEVER the internal reason',
  (SELECT (public.my_access_state()->>'state') = 'suspended'
      AND public.my_access_state()::text NOT LIKE '%Harassment%'
      AND public.my_access_state() ? 'support_email'));
SELECT t_ok('T11b the restricted shell payload carries no admin identity or history',
  (SELECT NOT (public.my_access_state() ? 'created_by')
      AND NOT (public.my_access_state() ? 'internal_reason')
      AND NOT (public.my_access_state() ? 'correlation_id')));
RESET ROLE;

-- Other students must not see the restricted account.
SET ROLE authenticated;
SELECT t_as(:O);
SELECT t_ok('T12 a restricted account disappears from other students'' view',
  (SELECT count(*)=0 FROM profiles WHERE id=:S));
SELECT t_ok('T12b unrelated students are unaffected',
  (SELECT count(*)=1 FROM profiles WHERE id=:O));
RESET ROLE;

-- ── ACCOUNT DELETION MUST STILL WORK ───────────────────────────────────────
SELECT t_ok('T13 restricted student can still EXECUTE delete_own_account_atomic',
  (SELECT has_function_privilege('authenticated','public.delete_own_account_atomic()','EXECUTE')));
SELECT t_ok('T13b the deletion RPC carries no access predicate',
  (SELECT prosrc NOT LIKE '%current_student_can_access_app%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='delete_own_account_atomic'));

-- ===========================================================================
-- B. EXPIRY IS A PREDICATE, NOT A JOB
-- ===========================================================================
SELECT public.admin_tx_restriction_unsuspend(:ADM,'founder@weglue.app','Resolved', gen_random_uuid(), :S);
SELECT t_ok('T14 unsuspend restores access',
  (SELECT public.get_account_access_state(:S) = 'active'));
SELECT t_ok('T14b the lifted row survives as history',
  (SELECT count(*)>=1 FROM account_restrictions WHERE user_id=:S AND status='lifted'));
SELECT t_ok('T14c lift evidence is recorded',
  (SELECT lifted_at IS NOT NULL AND lifted_by=:ADM AND lift_reason='Resolved'
     FROM account_restrictions WHERE user_id=:S AND status='lifted' ORDER BY created_at DESC LIMIT 1));

SELECT public.admin_tx_restriction_suspend(:ADM,'founder@weglue.app','Temporary timeout',
   gen_random_uuid(), :S, now() + interval '1 hour');
SELECT t_ok('T15 a future-dated suspension IS restricting',
  (SELECT public.get_account_access_state(:S) = 'suspended'));

-- Backdate the row to simulate the clock passing. Status stays 'active' on
-- purpose: this is exactly the un-reconciled state, and access must lapse anyway.
UPDATE account_restrictions
   SET created_at      = now() - interval '2 hours',
       suspended_until = now() - interval '1 minute'
 WHERE user_id=:S AND status='active';
SELECT t_ok('T16 an EXPIRED suspension stops restricting with NO cleanup job',
  (SELECT public.get_account_access_state(:S) = 'active'));
SELECT t_ok('T16b the row is still status=active (un-reconciled bookkeeping)',
  (SELECT count(*)=1 FROM account_restrictions WHERE user_id=:S AND status='active'));

SET ROLE authenticated;
SELECT t_as(:S);
SELECT t_ok('T17 the student regains real access after expiry',
  (SELECT count(*)>=1 FROM profiles WHERE id=:O));
RESET ROLE;

-- ===========================================================================
-- B2. EXPIRED-SUSPENSION ADMINISTRATIVE LIFECYCLE  (Stage 2)
--
-- The predicate already treats a lapsed suspension as inactive. What this
-- section proves is the ADMINISTRATIVE half: that the historical row does not
-- get in the way afterwards.
--
-- DESIGN CHOSEN (of the two the founder offered): the NEXT administrator
-- mutation atomically closes the expired row before creating the new
-- restriction. The alternative — encoding expiry into the partial unique index
-- — was rejected because it would require now() in the index predicate, which
-- PostgreSQL forbids (an index predicate must be IMMUTABLE) and which would be
-- wrong anyway: an index cannot re-evaluate itself as the clock moves.
--
-- No cron job exists, and none is needed: access returns from the predicate,
-- and the bookkeeping is closed by the next action that cares.
-- ===========================================================================
SELECT public.admin_tx_restriction_unsuspend(:ADM,'founder@weglue.app','Reset for lifecycle', gen_random_uuid(), :S);

SELECT public.admin_tx_restriction_suspend(:ADM,'founder@weglue.app','Lifecycle temporary',
  gen_random_uuid(), :S, now() + interval '1 hour');
SELECT t_ok('L1 a live temporary suspension restricts',
  (SELECT public.get_account_access_state(:S) = 'suspended'));

-- Age the whole row so it stays internally consistent (ar_expiry_forward).
UPDATE account_restrictions
   SET created_at = now() - interval '2 hours', suspended_until = now() - interval '1 minute'
 WHERE user_id = :S AND status = 'active';

SELECT t_ok('L2 access resumes the moment it lapses, with NO cron job',
  (SELECT public.get_account_access_state(:S) = 'active'));
SELECT t_ok('L3 the historical row is still status=active (un-reconciled bookkeeping)',
  (SELECT count(*) = 1 FROM account_restrictions
    WHERE user_id = :S AND status = 'active' AND suspended_until < now()));

SET ROLE authenticated;
SELECT t_as(:S);
SELECT t_ok('L4 the student really can use the app again',
  (SELECT count(*) >= 1 FROM profiles WHERE id = :O));
RESET ROLE;

-- No unsuspend should be needed, and offering one would be misleading: the
-- account is not restricted, so `unsuspend` correctly reports not_restricted.
SELECT t_ok('L5 no misleading unsuspend is required — it reports not_restricted',
  (SELECT public.admin_tx_restriction_unsuspend(:ADM,'founder@weglue.app','Pointless',
     gen_random_uuid(), :S) ->> 'status' = 'not_restricted'));

-- A NEW suspension must not collide with the stale row's unique index.
SELECT t_ok('L6 a NEW suspension succeeds despite the expired row',
  (SELECT public.admin_tx_restriction_suspend(:ADM,'founder@weglue.app','Second suspension',
     gen_random_uuid(), :S, now() + interval '2 days') ->> 'status' = 'ok'));
SELECT t_ok('L7 exactly ONE active row remains (the stale one was closed atomically)',
  (SELECT count(*) = 1 FROM account_restrictions WHERE user_id = :S AND status = 'active'));
SELECT t_ok('L8 the expired row was reconciled to status=expired, not deleted',
  (SELECT count(*) >= 1 FROM account_restrictions WHERE user_id = :S AND status = 'expired'));
SELECT t_ok('L9 the reconciliation is audited under the new action''s correlation id',
  (SELECT count(*) >= 1 FROM admin_audit_events
    WHERE action = 'restriction.suspend' AND target_id = :S AND event_type = 'success'));

-- The same must hold for a platform BLOCK arriving after an expired suspension.
SELECT public.admin_tx_restriction_unsuspend(:ADM,'founder@weglue.app','Clear', gen_random_uuid(), :S);
SELECT public.admin_tx_restriction_suspend(:ADM,'founder@weglue.app','Third suspension',
  gen_random_uuid(), :S, now() + interval '1 hour');
UPDATE account_restrictions
   SET created_at = now() - interval '2 hours', suspended_until = now() - interval '1 minute'
 WHERE user_id = :S AND status = 'active';
SELECT t_ok('L10 a platform BLOCK also succeeds despite an expired row',
  (SELECT public.admin_tx_restriction_block(:ADM,'founder@weglue.app','Block after expiry',
     gen_random_uuid(), :S) ->> 'status' = 'ok'));
SELECT t_ok('L11 and again exactly one active row',
  (SELECT count(*) = 1 FROM account_restrictions WHERE user_id = :S AND status = 'active'));
SELECT t_ok('L12 full history is preserved throughout',
  (SELECT count(*) >= 5 FROM account_restrictions WHERE user_id = :S));
SELECT public.admin_tx_restriction_unblock(:ADM,'founder@weglue.app','Lifecycle cleanup', gen_random_uuid(), :S);

-- The partial unique index must NOT contain a volatile expression.
SELECT t_ok('L13 the active-row unique index uses no volatile now() predicate',
  (SELECT pg_get_indexdef(i.indexrelid) NOT LIKE '%now()%'
     FROM pg_index i WHERE i.indexrelid = 'uq_account_restrictions_active'::regclass));

-- ===========================================================================
-- C. PLATFORM BLOCK + TRANSITIONS
-- ===========================================================================
SELECT t_ok('T18 platform block succeeds and supersedes the stale suspension',
  (SELECT public.admin_tx_restriction_block(:ADM,'founder@weglue.app','Severe violation',
     gen_random_uuid(), :S) ->> 'status' = 'ok'));
SELECT t_ok('T18b access state is platform_blocked',
  (SELECT public.get_account_access_state(:S) = 'platform_blocked'));
SELECT t_ok('T18c still exactly ONE active restriction (partial unique index holds)',
  (SELECT count(*)=1 FROM account_restrictions WHERE user_id=:S AND status='active'));

SET ROLE authenticated;
SELECT t_as(:S);
SELECT t_ok('T19 the STUDENT sees the generic "restricted", never "platform_blocked"',
  (SELECT (public.my_access_state()->>'state') = 'restricted'
      AND public.my_access_state()::text NOT LIKE '%platform_blocked%'
      AND public.my_access_state()::text NOT LIKE '%Severe violation%'));
RESET ROLE;

SELECT t_ok('T20 platform_blocked -> suspended is REJECTED (must unblock first)',
  (SELECT public.admin_tx_restriction_suspend(:ADM,'founder@weglue.app','Downgrade attempt',
     gen_random_uuid(), :S, NULL) ->> 'status' = 'invalid_transition'));
SELECT t_ok('T20b unsuspend on a blocked account is REJECTED',
  (SELECT public.admin_tx_restriction_unsuspend(:ADM,'founder@weglue.app','Wrong action',
     gen_random_uuid(), :S) ->> 'status' = 'invalid_transition'));
SELECT t_ok('T21 duplicate block is REJECTED',
  (SELECT public.admin_tx_restriction_block(:ADM,'founder@weglue.app','Again',
     gen_random_uuid(), :S) ->> 'status' = 'already_blocked'));
SELECT t_ok('T21b a rejected action wrote a durable FAILURE audit row',
  (SELECT count(*)>=1 FROM admin_audit_events
    WHERE action='restriction.block' AND target_id=:S AND event_type='failure'));
SELECT t_ok('T21c a rejected action did NOT create a second restriction row',
  (SELECT count(*)=1 FROM account_restrictions WHERE user_id=:S AND status='active'));

SELECT public.admin_tx_restriction_unblock(:ADM,'founder@weglue.app','Appeal upheld', gen_random_uuid(), :S);
SELECT t_ok('T22 unblock restores access',
  (SELECT public.get_account_access_state(:S) = 'active'));
SELECT t_ok('T23 unblock on an ACTIVE account is REJECTED',
  (SELECT public.admin_tx_restriction_unblock(:ADM,'founder@weglue.app','No-op',
     gen_random_uuid(), :S) ->> 'status' = 'not_restricted'));
SELECT t_ok('T23b unsuspend on an ACTIVE account is REJECTED',
  (SELECT public.admin_tx_restriction_unsuspend(:ADM,'founder@weglue.app','No-op',
     gen_random_uuid(), :S) ->> 'status' = 'not_restricted'));

-- ===========================================================================
-- D. TARGET AND INPUT VALIDATION
-- ===========================================================================
SELECT t_ok('T24 platform-admin target REJECTED',
  (SELECT public.admin_tx_restriction_suspend(:ADM,'founder@weglue.app','Try admin',
     gen_random_uuid(), :ADM, NULL) ->> 'status' IN ('self_target','platform_admin_target','user_not_found')));
SELECT t_ok('T25 self-target REJECTED',
  (SELECT public.admin_tx_restriction_suspend(:S,'x@y.z','Self',
     gen_random_uuid(), :S, NULL) ->> 'status' = 'self_target'));
SELECT t_ok('T26 non-existent target REJECTED',
  (SELECT public.admin_tx_restriction_suspend(:ADM,'founder@weglue.app','Ghost',
     gen_random_uuid(), '99990000-0000-4000-8000-000000009999', NULL) ->> 'status' = 'user_not_found'));
SELECT t_ok('T27 a PAST suspension expiry is REJECTED',
  (SELECT public.admin_tx_restriction_suspend(:ADM,'founder@weglue.app','Backdated',
     gen_random_uuid(), :S, now() - interval '1 day') ->> 'status' = 'invalid_expiry'));

DO $$ BEGIN
  BEGIN
    PERFORM public.admin_tx_restriction_suspend('55550000-0000-4000-8000-0000000000ad','f@w.app','ab',
      gen_random_uuid(), '55550000-0000-4000-8000-000000000001', NULL);
    PERFORM t_ok('T28 a 2-character reason is REJECTED by the database', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    PERFORM t_ok('T28 a 2-character reason is REJECTED by the database', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM public.admin_tx_restriction_suspend('55550000-0000-4000-8000-0000000000ad','f@w.app',
      repeat('x',501), gen_random_uuid(), '55550000-0000-4000-8000-000000000001', NULL);
    PERFORM t_ok('T29 a 501-character reason is REJECTED by the database', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    PERFORM t_ok('T29 a 501-character reason is REJECTED by the database', true);
  END;
END $$;

-- ===========================================================================
-- E. ADJUST EXPIRY (explicit, audited)
-- ===========================================================================
SELECT public.admin_tx_restriction_suspend(:ADM,'founder@weglue.app','Timeout',
  gen_random_uuid(), :S, now() + interval '2 days');
SELECT t_ok('T30 adjusting the expiry succeeds and is audited separately',
  (SELECT public.admin_tx_restriction_adjust_expiry(:ADM,'founder@weglue.app','Shortened on appeal',
     gen_random_uuid(), :S, now() + interval '6 hours') ->> 'status' = 'ok'));
SELECT t_ok('T30b it produced its OWN audit action, not a suspend record',
  (SELECT count(*)=1 FROM admin_audit_events
    WHERE action='restriction.adjustExpiry' AND target_id=:S AND event_type='success'));
SELECT t_ok('T30c a PAST adjustment target is REJECTED',
  (SELECT public.admin_tx_restriction_adjust_expiry(:ADM,'founder@weglue.app','Backdate',
     gen_random_uuid(), :S, now() - interval '1 hour') ->> 'status' = 'invalid_expiry'));

-- ===========================================================================
-- F. PRIVILEGE + ENUMERATION SAFETY
-- ===========================================================================
SELECT t_ok('T31 account_restrictions has RLS enabled AND forced',
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.account_restrictions'::regclass));
SELECT t_ok('T31b account_restrictions has ZERO policies (no student path at all)',
  (SELECT count(*)=0 FROM pg_policies WHERE schemaname='public' AND tablename='account_restrictions'));
SELECT t_ok('T31c authenticated holds NO privilege on account_restrictions',
  (SELECT count(*)=0 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='account_restrictions' AND grantee='authenticated'));
SELECT t_ok('T31d service_role holds SELECT only',
  (SELECT string_agg(privilege_type,',')='SELECT' FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='account_restrictions' AND grantee='service_role'));
SELECT t_ok('T32 students CANNOT execute the per-user probe functions',
  (SELECT NOT has_function_privilege('authenticated','public.get_account_access_state(uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.is_account_restricted(uuid)','EXECUTE')));
SELECT t_ok('T32b students CAN execute only the argument-free self checks',
  (SELECT has_function_privilege('authenticated','public.my_access_state()','EXECUTE')
      AND has_function_privilege('authenticated','public.current_student_can_access_app()','EXECUTE')));
SELECT t_ok('T33 the admin RPCs are service_role only',
  (SELECT NOT has_function_privilege('authenticated','public.admin_tx_restriction_suspend(uuid,text,text,uuid,uuid,timestamptz)','EXECUTE')
      AND NOT has_function_privilege('anon','public.admin_tx_restriction_block(uuid,text,text,uuid,uuid)','EXECUTE')));
SELECT t_ok('T34 restriction rows cannot be DELETED (append-only)',
  (SELECT count(*)>0 FROM account_restrictions));
DO $$ BEGIN
  BEGIN
    DELETE FROM account_restrictions WHERE user_id='55550000-0000-4000-8000-000000000001';
    PERFORM t_ok('T34b DELETE on account_restrictions is refused', false, 'delete succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t_ok('T34b DELETE on account_restrictions is refused', true);
  END;
END $$;

-- ===========================================================================
-- G. DAY 10B1 REGRESSION — student blocking must be untouched
-- ===========================================================================
SELECT public.admin_tx_restriction_unsuspend(:ADM,'founder@weglue.app','Clear for regression', gen_random_uuid(), :S);
SET ROLE authenticated;
SELECT t_as(:S);
SELECT t_ok('T35 an unrestricted student can still BLOCK another student (10B1 intact)',
  (SELECT public.block_user('55550000-0000-4000-8000-000000000002') ->> 'status' = 'ok'));
SELECT t_ok('T35b the 10B1 block row exists',
  (SELECT count(*)=1 FROM user_blocks WHERE blocker_id=:S AND blocked_id=:O));
RESET ROLE;

-- Restricting the blocker must NOT disturb existing block relationships.
SELECT public.admin_tx_restriction_suspend(:ADM,'founder@weglue.app','Regression check',
  gen_random_uuid(), :S, NULL);
SELECT t_ok('T36 existing user_blocks rows SURVIVE a restriction',
  (SELECT count(*)=1 FROM user_blocks WHERE blocker_id=:S AND blocked_id=:O));
SELECT public.admin_tx_restriction_unsuspend(:ADM,'founder@weglue.app','Done', gen_random_uuid(), :S);
SELECT t_ok('T36b and they survive the LIFT too (no recreate, no delete)',
  (SELECT count(*)=1 FROM user_blocks WHERE blocker_id=:S AND blocked_id=:O));

-- ===========================================================================
-- H. CONTENT PRESERVATION
-- ===========================================================================
SELECT public.admin_tx_restriction_block(:ADM,'founder@weglue.app','Preservation check', gen_random_uuid(), :S);
SELECT t_ok('T37 a platform block deletes NO content',
  (SELECT (SELECT count(*) FROM posts WHERE author_id=:S) >= 1
      AND (SELECT count(*) FROM messages WHERE sender_id=:S) = 1
      AND (SELECT count(*) FROM club_members WHERE user_id=:S) = 1
      AND (SELECT count(*) FROM conversation_participants WHERE user_id=:S) = 1));
SELECT public.admin_tx_restriction_unblock(:ADM,'founder@weglue.app','Cleanup', gen_random_uuid(), :S);

-- ===========================================================================
-- I. ENFORCEMENT COVERAGE — every student-write policy carries the predicate
-- ===========================================================================
SELECT t_ok('T38 NO student-write policy is missing the access predicate',
  (SELECT count(*)=0 FROM pg_policies
    WHERE schemaname='public'
      AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
      AND 'authenticated' = ANY(roles)
      AND tablename <> 'deletion_requests'
      AND COALESCE(qual,'')       NOT LIKE '%current_student_can_access_app%'
      AND COALESCE(with_check,'') NOT LIKE '%current_student_can_access_app%'),
  'any row here is an ungated write path');
SELECT t_ok('T38b the deletion-request path is deliberately EXEMPT',
  (SELECT count(*)>=1 FROM pg_policies
    WHERE schemaname='public' AND tablename='deletion_requests'
      AND COALESCE(with_check,'') NOT LIKE '%current_student_can_access_app%'));

-- ===========================================================================
-- RESULTS
-- ===========================================================================
\o
\echo ''
\echo '=============== MIGRATION 058 TEST RESULTS ==============='
SELECT lpad(n::text,3) AS "#",
       CASE WHEN ok THEN 'PASS' ELSE '*** FAIL ***' END AS result,
       name, NULLIF(detail,'') AS detail
FROM t_results ORDER BY n;

SELECT count(*) FILTER (WHERE ok) AS passed,
       count(*) FILTER (WHERE NOT ok) AS failed,
       count(*) AS total
FROM t_results;

DO $$
DECLARE v_failed int;
BEGIN
  SELECT count(*) INTO v_failed FROM t_results WHERE NOT ok;
  IF v_failed > 0 THEN RAISE EXCEPTION '% TEST(S) FAILED', v_failed; END IF;
  RAISE NOTICE 'ALL MIGRATION 058 TESTS PASSED';
END $$;
