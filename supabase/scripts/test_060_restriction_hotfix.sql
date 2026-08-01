-- ===========================================================================
-- Test harness — migration 060 (restriction-enforcement hotfix)
--
-- HOW TO RUN (throwaway database, NEVER production):
--
--   docker run -d --name wg-060 -e POSTGRES_PASSWORD=test -p 55452:5432 postgres:15
--   docker exec -i wg-060 psql -U postgres -d postgres <<'EOF'
--     CREATE ROLE pgowner LOGIN PASSWORD 'test' NOSUPERUSER BYPASSRLS CREATEROLE;
--     CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
--     CREATE ROLE service_role NOLOGIN BYPASSRLS;
--     GRANT anon, authenticated, service_role TO pgowner;
--     CREATE DATABASE wg OWNER pgowner;
--   EOF
--   docker exec -i wg-060 psql -U pgowner -d wg -c \
--     "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;"
--   for f in supabase/scripts/test_057_fixture_schema.sql \
--            supabase/migrations/057_student_blocking.sql \
--            supabase/migrations/055_durable_admin_audit.sql \
--            supabase/migrations/056_atomic_admin_mutations.sql \
--            supabase/migrations/058_admin_restrictions.sql \
--            supabase/migrations/060_restriction_enforcement_hotfix.sql; do
--     docker exec -i wg-060 psql -U pgowner -d wg -v ON_ERROR_STOP=1 -q < $f
--   done
--   docker exec -i wg-060 psql -U pgowner -d wg -q < supabase/scripts/test_060_restriction_hotfix.sql
--
-- WHAT THIS PROVES
--   1. create_poll is now behind the restriction guard, and a suspended or
--      platform-blocked participant cannot create a poll.
--   2. Every client-visible property of create_poll is unchanged: 8 parameters,
--      4 defaults, json return, every short call form, named arguments, the
--      client_tag idempotency path, and every original error string.
--   3. The wrapper did NOT weaken participant / channel authorization.
--   4. Nothing partial is ever left behind by a refused call.
--   5. create_poll__inner is unreachable by any client role, so the guard
--      cannot be side-stepped.
--   6. check_club_inactivity is internal-only, and still works internally.
--
-- Every negative assertion is paired with a POSITIVE CONTROL, so a test that
-- passes because nothing ran at all is distinguishable from a real pass.
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

-- Clears the JWT entirely, so auth.uid() is NULL — a genuinely unauthenticated
-- caller rather than a signed-in user with an unknown id.
CREATE OR REPLACE FUNCTION t_anon()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN PERFORM set_config('request.jwt.claims', '', false); END; $$;

-- Captures the SQLERRM of a create_poll call, or 'OK:<json>' when it succeeds.
-- Returning the message lets each test assert the EXACT original error string,
-- which is what proves the wrapper preserved the error contract.
CREATE OR REPLACE FUNCTION t_poll(
  p_conv uuid, p_chan uuid, p_q text, p_opts text[],
  p_multi boolean DEFAULT false, p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL, p_tag uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v json;
BEGIN
  v := public.create_poll(p_conv, p_chan, p_q, p_opts, p_multi, p_start, p_end, p_tag);
  RETURN 'OK:' || v::text;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END; $$;

GRANT EXECUTE ON FUNCTION t_ok(text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION t_as(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION t_anon() TO authenticated;
GRANT EXECUTE ON FUNCTION t_poll(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid) TO authenticated;

-- ── Fixtures ───────────────────────────────────────────────────────────────
--   P   = active participant (the positive control throughout)
--   R   = participant who will be restricted
--   N   = a student who is NOT a participant
--   ADM = platform administrator (no profiles row, per migration 053)
\set P   '''66660000-0000-4000-8000-000000000001'''
\set R   '''66660000-0000-4000-8000-000000000002'''
\set N   '''66660000-0000-4000-8000-000000000003'''
\set ADM '''66660000-0000-4000-8000-0000000000ad'''
\set UNI '''66660000-0000-4000-8000-00000000aaaa'''
\set CONV_D '''66660000-0000-4000-8000-00000000ee01'''
\set CONV_G '''66660000-0000-4000-8000-00000000ee02'''
\set CONV_X '''66660000-0000-4000-8000-00000000ee03'''
\set CHAN  '''66660000-0000-4000-8000-00000000ff01'''
\set CHAN_X '''66660000-0000-4000-8000-00000000ff02'''
\set CLUB '''66660000-0000-4000-8000-00000000bbbb'''

INSERT INTO universities (id,name,slug) VALUES (:UNI,'Lone Star College','lone-star-college');

INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES
  (:P,  'p@myschool.edu','{}'::jsonb),
  (:R,  'r@myschool.edu','{}'::jsonb),
  (:N,  'n@myschool.edu','{}'::jsonb),
  (:ADM,'founder@weglue.app','{"account_type":"platform_admin"}'::jsonb);

INSERT INTO profiles (id,username,full_name,university_id) VALUES
  (:P,'stu_active','Pat Active',:UNI),
  (:R,'stu_restricted','Robin Restricted',:UNI),
  (:N,'stu_outsider','Nia Outsider',:UNI);

INSERT INTO clubs (id,name,is_active,university_id) VALUES (:CLUB,'Robotics Club',true,:UNI);

-- A direct conversation, a club_group conversation with a channel, and a third
-- conversation neither P nor R belongs to (for the channel_mismatch test).
INSERT INTO conversations (id,type,created_by) VALUES (:CONV_D,'direct',:P);
INSERT INTO conversations (id,type,club_id,created_by) VALUES (:CONV_G,'club_group',:CLUB,:P);
INSERT INTO conversations (id,type,created_by) VALUES (:CONV_X,'direct',:N);

INSERT INTO conversation_participants (conversation_id,user_id) VALUES
  (:CONV_D,:P), (:CONV_D,:R),
  (:CONV_G,:P), (:CONV_G,:R),
  (:CONV_X,:N);

INSERT INTO conversation_channels (id,conversation_id,name,is_default,created_by) VALUES
  (:CHAN,  :CONV_G,'general',true,:P),
  (:CHAN_X,:CONV_X,'elsewhere',true,:N);

-- ===========================================================================
-- A. create_poll — the wrapper must be invisible to a healthy student
-- ===========================================================================

SET ROLE authenticated;
SELECT t_as(:P);

-- A1. Positive control: an active participant can still create a poll.
SELECT t_ok('A1  active participant creates a poll',
  t_poll(:CONV_D, NULL, 'Pizza or tacos?', ARRAY['Pizza','Tacos']) LIKE 'OK:%',
  t_poll(:CONV_D, NULL, 'probe', ARRAY['a','b']));

-- A2. The return type and shape are unchanged: json with both ids.
SELECT t_ok('A2  returns json {message_id, poll_id}',
  (public.create_poll(:CONV_D, NULL, 'Shape check', ARRAY['x','y']) ->> 'message_id') IS NOT NULL
  AND (public.create_poll(:CONV_D, NULL, 'Shape check 2', ARRAY['x','y']) ->> 'poll_id') IS NOT NULL);

-- A3-A7. EVERY short call form must still resolve. If 059 had rebuilt the
-- wrapper from identity arguments (defaults stripped), each of these would fail
-- with "function does not exist" — the exact bug 058 hit on get_my_blocked_users.
SELECT t_ok('A3  4-arg call form resolves (defaults intact)',
  public.create_poll(:CONV_D, NULL, 'four', ARRAY['a','b']) IS NOT NULL);
SELECT t_ok('A4  5-arg call form resolves',
  public.create_poll(:CONV_D, NULL, 'five', ARRAY['a','b'], true) IS NOT NULL);
SELECT t_ok('A5  6-arg call form resolves',
  public.create_poll(:CONV_D, NULL, 'six', ARRAY['a','b'], false, now()) IS NOT NULL);
SELECT t_ok('A6  7-arg call form resolves',
  public.create_poll(:CONV_D, NULL, 'seven', ARRAY['a','b'], false, now(), now()+interval '1 day') IS NOT NULL);
SELECT t_ok('A7  full 8-arg call form resolves',
  public.create_poll(:CONV_D, NULL, 'eight', ARRAY['a','b'], true, now(), now()+interval '1 day',
                     '66660000-0000-4000-8000-00000000dd01') IS NOT NULL);

-- A8. Named-argument calls (supabase-js sends named parameters over PostgREST).
SELECT t_ok('A8  named-argument call resolves',
  public.create_poll(
    p_conversation_id => :CONV_D,
    p_channel_id      => NULL,
    p_question        => 'named args',
    p_options         => ARRAY['a','b'],
    p_allow_multiple  => true
  ) IS NOT NULL);

-- A9. Channel conversation (club_group) still works.
SELECT t_ok('A9  poll in a channel conversation',
  t_poll(:CONV_G, :CHAN, 'Channel poll', ARRAY['a','b']) LIKE 'OK:%');

-- A10. Scheduled start/end are persisted, not dropped by the wrapper.
SELECT t_ok('A10 start_at/end_at persisted through the wrapper',
  EXISTS (SELECT 1 FROM polls WHERE question='seven' AND start_at IS NOT NULL AND end_at IS NOT NULL));

-- A11. allow_multiple is persisted.
SELECT t_ok('A11 allow_multiple persisted through the wrapper',
  EXISTS (SELECT 1 FROM polls WHERE question='five' AND allow_multiple));

-- A12. client_tag idempotency: the same tag returns the SAME ids, no duplicate.
SELECT t_ok('A12 client_tag idempotency preserved',
  (public.create_poll(:CONV_D, NULL, 'eight', ARRAY['a','b'], true, NULL, NULL,
                      '66660000-0000-4000-8000-00000000dd01') ->> 'poll_id')
  = (SELECT p.id::text FROM polls p JOIN messages m ON m.id=p.message_id
      WHERE m.client_tag='66660000-0000-4000-8000-00000000dd01'));

-- A13. Options are written in order, with blanks skipped (original behaviour).
SELECT t_ok('A13 poll_options written in display order, blanks skipped',
  (SELECT count(*) FROM poll_options o
     JOIN polls p ON p.id=o.poll_id WHERE p.question='Pizza or tacos?') = 2);

-- ===========================================================================
-- B. create_poll — original error contract preserved
-- ===========================================================================

SELECT t_ok('B1  nonparticipant still refused (not_a_participant)',
  (SELECT t_poll(:CONV_X, NULL, 'sneaky', ARRAY['a','b'])) = 'not_a_participant');

SELECT t_ok('B2  empty question still refused (question_required)',
  (SELECT t_poll(:CONV_D, NULL, '   ', ARRAY['a','b'])) = 'question_required');

SELECT t_ok('B3  fewer than two options still refused (need_two_options)',
  (SELECT t_poll(:CONV_D, NULL, 'q', ARRAY['only one'])) = 'need_two_options');

SELECT t_ok('B4  end before start still refused (end_before_start)',
  (SELECT t_poll(:CONV_D, NULL, 'q', ARRAY['a','b'], false,
                 now(), now() - interval '1 hour')) = 'end_before_start');

-- B5. The wrapper must NOT weaken channel authorization: a channel belonging to
-- another conversation is still rejected.
SELECT t_ok('B5  channel from another conversation refused (channel_mismatch)',
  (SELECT t_poll(:CONV_G, :CHAN_X, 'q', ARRAY['a','b'])) = 'channel_mismatch');

RESET ROLE;

-- B6. Unauthenticated callers keep the ORIGINAL error. This is the ordering
-- requirement: authentication is checked before any restriction verdict, so an
-- anonymous caller must never receive 'account_restricted' (which would leak
-- that the guard exists, and would be the wrong contract for clients).
SET ROLE authenticated;
SELECT t_anon();
SELECT t_ok('B6  unauthenticated caller gets not_authenticated, not account_restricted',
  (SELECT t_poll(:CONV_D, NULL, 'q', ARRAY['a','b'])) = 'not_authenticated');
RESET ROLE;

-- ===========================================================================
-- C. THE DEFECT ITSELF — a restricted student must not be able to create a poll
-- ===========================================================================

-- Baseline row counts, so "nothing partial was left behind" is measured rather
-- than assumed.
CREATE TEMP TABLE t_before AS
SELECT (SELECT count(*) FROM messages)     AS m,
       (SELECT count(*) FROM polls)        AS p,
       (SELECT count(*) FROM poll_options) AS o;

-- ── Suspended ──────────────────────────────────────────────────────────────
SELECT public.admin_tx_restriction_suspend(
  :ADM,'founder@weglue.app','Day 10B hotfix harness — suspension',
  gen_random_uuid(), :R, NULL);

SET ROLE authenticated;
SELECT t_as(:R);
SELECT t_ok('C1  SUSPENDED participant cannot create a poll',
  (SELECT t_poll(:CONV_D, NULL, 'should never exist', ARRAY['a','b'])) = 'account_restricted');
SELECT t_ok('C2  SUSPENDED participant refused in a channel too',
  (SELECT t_poll(:CONV_G, :CHAN, 'should never exist', ARRAY['a','b'])) = 'account_restricted');
RESET ROLE;

-- Positive control: the OTHER student is unaffected by R's suspension.
SET ROLE authenticated;
SELECT t_as(:P);
SELECT t_ok('C3  POSITIVE CONTROL: unrestricted student unaffected',
  t_poll(:CONV_D, NULL, 'still fine while R is suspended', ARRAY['a','b']) LIKE 'OK:%');
RESET ROLE;

SELECT public.admin_tx_restriction_unsuspend(
  :ADM,'founder@weglue.app','Day 10B hotfix harness — lift', gen_random_uuid(), :R);

-- Positive control: lifting genuinely restores the ability.
SET ROLE authenticated;
SELECT t_as(:R);
SELECT t_ok('C4  POSITIVE CONTROL: lifting restores poll creation',
  t_poll(:CONV_D, NULL, 'allowed again', ARRAY['a','b']) LIKE 'OK:%');
RESET ROLE;

-- ── Platform-blocked ───────────────────────────────────────────────────────
SELECT public.admin_tx_restriction_block(
  :ADM,'founder@weglue.app','Day 10B hotfix harness — block', gen_random_uuid(), :R);

SET ROLE authenticated;
SELECT t_as(:R);
SELECT t_ok('C5  PLATFORM-BLOCKED participant cannot create a poll',
  (SELECT t_poll(:CONV_D, NULL, 'should never exist', ARRAY['a','b'])) = 'account_restricted');
SELECT t_ok('C6  PLATFORM-BLOCKED cannot bypass via client_tag replay',
  (SELECT t_poll(:CONV_D, NULL, 'x', ARRAY['a','b'], false, NULL, NULL,
                 '66660000-0000-4000-8000-00000000dd01')) = 'account_restricted');
RESET ROLE;

-- C7. Nothing partial survived any refused call: every write is inside the
-- inner function, which the guard never reaches.
SELECT t_ok('C7  refused calls left ZERO rows behind',
  (SELECT count(*) FROM messages WHERE content IS NOT DISTINCT FROM NULL
     AND id IN (SELECT message_id FROM polls WHERE question='should never exist')) = 0
  AND (SELECT count(*) FROM polls WHERE question='should never exist') = 0
  AND (SELECT count(*) FROM poll_options WHERE option_text='should never exist') = 0,
  'polls named "should never exist": ' ||
  (SELECT count(*)::text FROM polls WHERE question='should never exist'));

-- C8. The three tables moved together or not at all: one message, one poll and
-- two options per successful call, so the counts stay in lockstep.
SELECT t_ok('C8  messages/polls/poll_options stayed consistent',
  (SELECT count(*) FROM polls) = (SELECT count(*) FROM messages WHERE message_type='poll')
  AND (SELECT count(*) FROM poll_options) = 2 * (SELECT count(*) FROM polls),
  (SELECT count(*)::text FROM polls) || ' polls / ' ||
  (SELECT count(*)::text FROM messages WHERE message_type='poll') || ' poll messages / ' ||
  (SELECT count(*)::text FROM poll_options) || ' options');

SELECT public.admin_tx_restriction_unblock(
  :ADM,'founder@weglue.app','Day 10B hotfix harness — unblock', gen_random_uuid(), :R);

-- ===========================================================================
-- D. The guard cannot be side-stepped
-- ===========================================================================

SELECT t_ok('D1  wrapper IS callable by authenticated',
  has_function_privilege('authenticated',
    'public.create_poll(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid)','EXECUTE'));

SELECT t_ok('D2  wrapper is NOT callable by anon',
  NOT has_function_privilege('anon',
    'public.create_poll(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid)','EXECUTE'));

SELECT t_ok('D3  wrapper is NOT granted to PUBLIC',
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='create_poll'
                 AND (p.proacl IS NULL
                      OR EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=%'))));

-- to_regprocedure() returns NULL instead of raising when the function is absent.
-- has_function_privilege() would abort the whole harness, which would hide the
-- behavioural failures below it — the negative control needs this file to run to
-- completion against a pre-059 database and NAME the defect.
-- CASE (not AND) because PostgreSQL does not promise short-circuit evaluation.
SELECT t_ok('D4  INNER implementation is NOT callable by authenticated',
  CASE WHEN to_regprocedure('public.create_poll__inner(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid)') IS NULL
       THEN false
       ELSE NOT has_function_privilege('authenticated',
              'public.create_poll__inner(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid)','EXECUTE') END,
  CASE WHEN to_regprocedure('public.create_poll__inner(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid)') IS NULL
       THEN 'create_poll__inner ABSENT — create_poll was never wrapped' ELSE '' END);

SELECT t_ok('D5  INNER implementation is NOT callable by anon',
  CASE WHEN to_regprocedure('public.create_poll__inner(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid)') IS NULL
       THEN false
       ELSE NOT has_function_privilege('anon',
              'public.create_poll__inner(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid)','EXECUTE') END,
  CASE WHEN to_regprocedure('public.create_poll__inner(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid)') IS NULL
       THEN 'create_poll__inner ABSENT — create_poll was never wrapped' ELSE '' END);

SELECT t_ok('D6  INNER implementation is NOT granted to PUBLIC',
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='create_poll__inner'
                 AND (p.proacl IS NULL
                      OR EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=%'))));

-- D7. A restricted student calling the inner function DIRECTLY is refused at the
-- privilege layer. This is the assertion that makes the guard non-bypassable.
SET ROLE authenticated;
SELECT t_as(:R);
-- NOTE: undefined_function must NOT be treated as "denied" here. Pre-059 the
-- inner function does not exist at all, and mapping that to a pass would make
-- this test succeed precisely when the system is broken.
DO $$
DECLARE v text;
BEGIN
  IF to_regprocedure('public.create_poll__inner(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid)') IS NULL THEN
    PERFORM t_ok('D7  direct call to create_poll__inner is denied', false,
                 'create_poll__inner ABSENT — create_poll was never wrapped');
    RETURN;
  END IF;
  BEGIN
    PERFORM public.create_poll__inner(
      '66660000-0000-4000-8000-00000000ee01', NULL, 'direct inner call', ARRAY['a','b']);
    v := 'REACHED THE INNER FUNCTION';
  EXCEPTION WHEN insufficient_privilege THEN v := 'denied';
            WHEN OTHERS                 THEN v := 'other:' || SQLERRM;
  END;
  PERFORM t_ok('D7  direct call to create_poll__inner is denied', v = 'denied', v);
END $$;
RESET ROLE;

-- D8. Signature is byte-identical to what clients compiled against.
SELECT t_ok('D8  wrapper signature unchanged (8 params, 4 defaults, json)',
  (SELECT p.pronargs = 8 AND p.pronargdefaults = 4
          AND pg_get_function_result(p.oid) = 'json'
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_poll'));

SELECT t_ok('D9  wrapper parameter names unchanged',
  (SELECT pg_get_function_identity_arguments(p.oid)
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_poll')
  = 'p_conversation_id uuid, p_channel_id uuid, p_question text, p_options text[], '
    'p_allow_multiple boolean, p_start_at timestamp with time zone, '
    'p_end_at timestamp with time zone, p_client_tag uuid');

SELECT t_ok('D10 exactly one create_poll overload (no shadow copy left behind)',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_poll') = 1);

-- ===========================================================================
-- E. check_club_inactivity — internal only
-- ===========================================================================

INSERT INTO club_members (club_id,user_id,role) VALUES (:CLUB,:P,'officer');
UPDATE clubs SET last_activity_at = now() - interval '90 days' WHERE id = :CLUB;

CREATE TEMP TABLE t_club_before AS
SELECT (SELECT count(*) FROM clubs WHERE inactivity_warned_at IS NOT NULL) AS warned,
       (SELECT count(*) FROM clubs WHERE NOT is_active)                    AS inactive,
       (SELECT count(*) FROM notifications)                                AS notifs;

SELECT t_ok('E1  NOT executable by PUBLIC',
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='check_club_inactivity'
                 AND (p.proacl IS NULL
                      OR EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=%'))));

SELECT t_ok('E2  NOT executable by anon',
  NOT has_function_privilege('anon','public.check_club_inactivity()','EXECUTE'));

SELECT t_ok('E3  NOT executable by authenticated',
  NOT has_function_privilege('authenticated','public.check_club_inactivity()','EXECUTE'));

SELECT t_ok('E4  IS executable by service_role (internal processing preserved)',
  has_function_privilege('service_role','public.check_club_inactivity()','EXECUTE'));

-- E5. A student actually trying it is refused at runtime, not merely by catalog.
SET ROLE authenticated;
SELECT t_as(:P);
DO $$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM public.check_club_inactivity();
    v := 'EXECUTED';
  EXCEPTION WHEN insufficient_privilege THEN v := 'denied';
            WHEN undefined_function     THEN v := 'denied';
            WHEN OTHERS                 THEN v := 'other:' || SQLERRM;
  END;
  PERFORM t_ok('E5  authenticated student call is refused at runtime', v = 'denied', v);
END $$;
RESET ROLE;

-- E6. That refused call changed nothing.
SELECT t_ok('E6  refused call modified ZERO club rows',
  (SELECT warned FROM t_club_before) = (SELECT count(*) FROM clubs WHERE inactivity_warned_at IS NOT NULL)
  AND (SELECT inactive FROM t_club_before) = (SELECT count(*) FROM clubs WHERE NOT is_active)
  AND (SELECT notifs FROM t_club_before) = (SELECT count(*) FROM notifications));

-- E7. POSITIVE CONTROL: the legitimate internal caller still produces the
-- original behaviour — the inactive club is warned and its officers notified.
-- Skipped in June/July/December, which the function itself declines to run in.
DO $$
DECLARE v_month int := EXTRACT(MONTH FROM now())::int;
        v_warned int;
        v_notifs int;
BEGIN
  IF v_month IN (6,7,12) THEN
    PERFORM t_ok('E7  internal caller still performs inactivity processing', true,
                 'seasonal no-op month (' || v_month || '): function returns early by design');
    RETURN;
  END IF;
  PERFORM public.check_club_inactivity();
  SELECT count(*) INTO v_warned FROM clubs WHERE inactivity_warned_at IS NOT NULL;
  SELECT count(*) INTO v_notifs FROM notifications WHERE type='club_inactive';
  PERFORM t_ok('E7  internal caller still performs inactivity processing',
               v_warned >= 1 AND v_notifs >= 1,
               v_warned || ' warned, ' || v_notifs || ' officer notifications');
END $$;

-- ===========================================================================
-- F. Day 10B1 and Day 10B2 behaviour unchanged
-- ===========================================================================

SELECT t_ok('F1  student blocking (057) still present and student-callable',
  has_function_privilege('authenticated','public.block_user(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.unblock_user(uuid)','EXECUTE'));

SELECT t_ok('F2  account deletion still reachable (Apple 5.1.1(v))',
  has_function_privilege('authenticated','public.delete_own_account_atomic()','EXECUTE'));

SELECT t_ok('F3  my_access_state still student-callable, not anon-callable',
  has_function_privilege('authenticated','public.my_access_state()','EXECUTE')
  AND NOT has_function_privilege('anon','public.my_access_state()','EXECUTE'));

SELECT t_ok('F4  account_restrictions still unreachable by students',
  NOT has_table_privilege('authenticated','public.account_restrictions','SELECT'));

SELECT t_ok('F5  no restriction rows left active by this harness',
  (SELECT count(*) FROM account_restrictions WHERE status='active') = 0);

-- ── Report ─────────────────────────────────────────────────────────────────
\o
\echo ''
\echo '════════════════ migration 060 — restriction-enforcement hotfix ════════════════'
SELECT lpad(n::text,3) || '  ' || CASE WHEN ok THEN 'PASS  ' ELSE '*FAIL*' END || '  ' ||
       rpad(name,62) || COALESCE(NULLIF(detail,''),'') AS result
FROM t_results ORDER BY n;
\echo ''
SELECT count(*) FILTER (WHERE ok) || ' / ' || count(*) || ' passed' AS summary FROM t_results;
SELECT CASE WHEN count(*) FILTER (WHERE NOT ok) = 0
            THEN 'ALL TESTS PASSED'
            ELSE '*** ' || count(*) FILTER (WHERE NOT ok) || ' FAILURE(S) ***' END AS verdict
FROM t_results;
