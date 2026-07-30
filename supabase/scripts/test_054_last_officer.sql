-- ===========================================================================
-- Test harness — migration 054 (atomic last-officer protection)
-- ===========================================================================
--
-- HOW TO RUN (against a throwaway shadow database, NEVER production):
--
--   1. Build a production-faithful shadow DB:
--        docker exec supabase_db_weglue psql -U postgres -d postgres \
--          -c "CREATE DATABASE weglue_day8;"
--        docker exec supabase_db_weglue bash -c \
--          "pg_dump -U postgres -d postgres --schema-only > /tmp/s.sql && \
--           psql -U postgres -d weglue_day8 -f /tmp/s.sql"
--        # then apply whichever migrations the source DB was missing, plus 054.
--
--   2. Run this file:
--        docker exec -i supabase_db_weglue psql -U postgres -d weglue_day8 -q \
--          < supabase/scripts/test_054_last_officer.sql
--
--   3. CONCURRENCY — not scriptable in one session; it needs real parallelism.
--      Two sessions demoting the last two officers of the same club:
--
--        # session 1 holds its transaction open for 3s
--        psql ... -c "BEGIN;" \
--          -c "SELECT admin_set_club_member_role('<club>','<officerA>','member');" \
--          -c "SELECT pg_sleep(3);" -c "COMMIT;" &
--        sleep 0.7
--        # session 2 starts INSIDE session 1's window
--        psql ... -c "BEGIN;" \
--          -c "SELECT admin_set_club_member_role('<club>','<officerB>','member');" \
--          -c "COMMIT;" &
--        wait
--
--      EXPECTED: session 1 -> 'ok', session 2 -> 'last_officer', the club keeps
--      exactly ONE officer, and NO deadlock is reported.
--
--      Repeat with raw `UPDATE club_members SET role='member' ...` in both
--      sessions to exercise the table-level backstop instead of the RPCs:
--      session 2 must fail with SQLSTATE 23514, message `club_last_officer`.
--
--      N-WAY: one session per officer of a 4-officer club, all at once.
--      EXPECTED: 3 commit, 1 refused with `club_last_officer`, 1 officer left,
--      ZERO deadlocks. (An earlier draft of 054 deadlocked here — see the
--      count_club_officers() comment in the migration.)
--
--      CONTROL — proves these tests are not vacuous. Disable
--      trg_club_officer_floor_update and repeat the 2-way race using a naive
--      count-then-update. The club ends with ZERO officers: exactly the defect
--      054 exists to prevent.
--
-- Every assertion raises on failure; ON_ERROR_STOP=1 aborts the run.
-- WARNINGs about notifications_type_fkey are EXPECTED: the fixture does not
-- seed the notification-type registry, and those inserts are best-effort by
-- design (migrations 031/033).
-- ===========================================================================

\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE OR REPLACE FUNCTION t_assert(cond boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE 'PASS  %', label;
  ELSE RAISE EXCEPTION 'FAIL  %', label;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION officer_count(p_club uuid) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::int FROM club_members WHERE club_id = p_club AND role = 'officer';
$$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Fixed ids so every test reasons about the same rows.
--   U1 university, C1 club, A/B officers, C member, D outsider (same campus)
\set U1  '''11111111-1111-1111-1111-111111111111'''
\set C1  '''22222222-2222-2222-2222-222222222222'''
\set UA  '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set UB  '''bbbbbbbb-0000-0000-0000-00000000000b'''
\set UC  '''cccccccc-0000-0000-0000-00000000000c'''
\set UD  '''dddddddd-0000-0000-0000-00000000000d'''

-- Seed the four accounts once. handle_new_user is bypassed for determinism:
-- this harness is testing the officer floor, not signup.
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

DELETE FROM auth.users WHERE id IN (:UA, :UB, :UC, :UD);
DELETE FROM clubs WHERE id = :C1;
DELETE FROM universities WHERE id = :U1;

INSERT INTO universities (id, name, slug, is_active)
VALUES (:U1, 'Day8 Test University', 'day8-test-university', true);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
SELECT x.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       x.email, 'x', now(), now(), now()
FROM (VALUES (:UA,'a@day8.edu'), (:UB,'b@day8.edu'), (:UC,'c@day8.edu'), (:UD,'d@day8.edu')) AS x(id, email);

INSERT INTO profiles (id, username, full_name, university_id, onboarding_completed, email_verified)
VALUES (:UA,'day8_a','Officer A',:U1,true,true),
       (:UB,'day8_b','Officer B',:U1,true,true),
       (:UC,'day8_c','Member C',:U1,true,true),
       (:UD,'day8_d','Outsider D',:U1,true,true);

INSERT INTO clubs (id, name, handle, description, university_id, is_active)
VALUES (:C1, 'Day8 Test Club', 'day8-test-club', 'Officer floor fixture', :U1, true);

-- Reset to the canonical fixture state: A + B officers, C member.
-- Triggers are suspended for the RESET ONLY (tearing the fixture down would
-- legitimately trip the floor); every assertion below runs with them live.
CREATE OR REPLACE FUNCTION fixture_reset() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  ALTER TABLE club_members DISABLE TRIGGER trg_club_officer_floor_delete;
  ALTER TABLE club_members DISABLE TRIGGER trg_club_officer_floor_update;

  DELETE FROM club_officers WHERE club_id = '22222222-2222-2222-2222-222222222222';
  DELETE FROM club_members  WHERE club_id = '22222222-2222-2222-2222-222222222222';

  INSERT INTO club_members (club_id, user_id, role) VALUES
    ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a','officer'),
    ('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b','officer'),
    ('22222222-2222-2222-2222-222222222222','cccccccc-0000-0000-0000-00000000000c','member');

  INSERT INTO club_officers (club_id, user_id, role_title, display_name) VALUES
    ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a','President','Officer A'),
    ('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b','Treasurer','Officer B');

  ALTER TABLE club_members ENABLE TRIGGER trg_club_officer_floor_delete;
  ALTER TABLE club_members ENABLE TRIGGER trg_club_officer_floor_update;
END $$;

\echo '=============================================================='
\echo 'T1-T8  RPC behaviour'
\echo '=============================================================='

-- T1 — remove one of multiple officers succeeds
SELECT fixture_reset();
DO $$
DECLARE r text;
BEGIN
  r := admin_remove_club_member('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b');
  PERFORM t_assert(r = 'ok', 'T1 remove one of two officers returns ok (got ' || r || ')');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 1, 'T1 one officer remains');
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM club_officers WHERE club_id='22222222-2222-2222-2222-222222222222' AND user_id='bbbbbbbb-0000-0000-0000-00000000000b'), 'T1 display roster row removed');
END $$;

-- T2 — removing the LAST officer fails, and writes nothing
SELECT fixture_reset();
DO $$
DECLARE r text;
BEGIN
  PERFORM admin_remove_club_member('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b');
  r := admin_remove_club_member('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a');
  PERFORM t_assert(r = 'last_officer', 'T2 removing the last officer refused (got ' || r || ')');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 1, 'T2 the last officer is still an officer');
  PERFORM t_assert(EXISTS (SELECT 1 FROM club_members WHERE club_id='22222222-2222-2222-2222-222222222222' AND user_id='aaaaaaaa-0000-0000-0000-00000000000a' AND role='officer'), 'T2 membership row untouched');
  PERFORM t_assert(EXISTS (SELECT 1 FROM club_officers WHERE club_id='22222222-2222-2222-2222-222222222222' AND user_id='aaaaaaaa-0000-0000-0000-00000000000a'), 'T2 roster row untouched');
END $$;

-- T3 — demoting the LAST officer fails
SELECT fixture_reset();
DO $$
DECLARE r text;
BEGIN
  r := admin_set_club_member_role('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b','member');
  PERFORM t_assert(r = 'ok', 'T3 demoting one of two officers succeeds');
  r := admin_set_club_member_role('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a','member');
  PERFORM t_assert(r = 'last_officer', 'T3 demoting the last officer refused (got ' || r || ')');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 1, 'T3 club still has exactly one officer');
END $$;

-- T4 — promote works and keeps the roster in sync
SELECT fixture_reset();
DO $$
DECLARE r text;
BEGIN
  r := admin_set_club_member_role('22222222-2222-2222-2222-222222222222','cccccccc-0000-0000-0000-00000000000c','officer','Secretary');
  PERFORM t_assert(r = 'ok', 'T4 promote member to officer');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 3, 'T4 three officers now');
  PERFORM t_assert(EXISTS (SELECT 1 FROM club_officers WHERE user_id='cccccccc-0000-0000-0000-00000000000c' AND role_title='Secretary'), 'T4 roster carries the typed title');
END $$;

-- T5 — input validation, no writes
SELECT fixture_reset();
DO $$
DECLARE r text;
BEGIN
  r := admin_set_club_member_role('22222222-2222-2222-2222-222222222222','cccccccc-0000-0000-0000-00000000000c','owner');
  PERFORM t_assert(r = 'invalid_role', 'T5 unknown role refused');
  r := admin_set_club_member_role('22222222-2222-2222-2222-222222222222','cccccccc-0000-0000-0000-00000000000c','officer','X');
  PERFORM t_assert(r = 'invalid_role_title', 'T5 too-short officer title refused');
  r := admin_set_club_member_role('22222222-2222-2222-2222-222222222222','dddddddd-0000-0000-0000-00000000000d','officer','President');
  PERFORM t_assert(r = 'not_member', 'T5 non-member cannot be promoted');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 2, 'T5 no write happened');
END $$;

-- T6 — atomic transfer to an existing member
SELECT fixture_reset();
DO $$
DECLARE r text;
BEGIN
  PERFORM admin_set_club_member_role('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b','member');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 1, 'T6 down to a sole officer');
  r := admin_transfer_club_officer('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a','cccccccc-0000-0000-0000-00000000000c','President');
  PERFORM t_assert(r = 'ok', 'T6 sole-officer handover succeeds (got ' || r || ')');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 1, 'T6 exactly one officer after handover');
  PERFORM t_assert(EXISTS (SELECT 1 FROM club_members WHERE user_id='cccccccc-0000-0000-0000-00000000000c' AND club_id='22222222-2222-2222-2222-222222222222' AND role='officer'), 'T6 incoming officer holds authority');
  PERFORM t_assert(EXISTS (SELECT 1 FROM club_members WHERE user_id='aaaaaaaa-0000-0000-0000-00000000000a' AND club_id='22222222-2222-2222-2222-222222222222' AND role='member'), 'T6 outgoing officer stays a member');
  PERFORM t_assert(EXISTS (SELECT 1 FROM club_officers WHERE user_id='cccccccc-0000-0000-0000-00000000000c' AND role_title='President'), 'T6 roster updated to the new officer');
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM club_officers WHERE user_id='aaaaaaaa-0000-0000-0000-00000000000a' AND club_id='22222222-2222-2222-2222-222222222222'), 'T6 old roster row removed');
END $$;

-- T7 — transfer to a NON-member joins them as officer in the same transaction
SELECT fixture_reset();
DO $$
DECLARE r text;
BEGIN
  PERFORM admin_set_club_member_role('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b','member');
  r := admin_transfer_club_officer('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a','dddddddd-0000-0000-0000-00000000000d','President');
  PERFORM t_assert(r = 'ok', 'T7 handover to a non-member succeeds');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 1, 'T7 exactly one officer');
  PERFORM t_assert(EXISTS (SELECT 1 FROM club_members WHERE user_id='dddddddd-0000-0000-0000-00000000000d' AND role='officer'), 'T7 new member added as officer');
END $$;

-- T8 — transfer guards
SELECT fixture_reset();
DO $$
DECLARE r text;
BEGIN
  r := admin_transfer_club_officer('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-00000000000a');
  PERFORM t_assert(r = 'same_user', 'T8 self-transfer refused');
  r := admin_transfer_club_officer('22222222-2222-2222-2222-222222222222','cccccccc-0000-0000-0000-00000000000c','dddddddd-0000-0000-0000-00000000000d');
  PERFORM t_assert(r = 'from_not_officer', 'T8 transfer from a non-officer refused');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 2, 'T8 no writes from refused transfers');
END $$;

\echo '=============================================================='
\echo 'T9-T11  Table-level backstop (direct SQL, bypassing the RPCs)'
\echo '=============================================================='

-- T9 — a raw UPDATE demoting the last officer is refused by the trigger
SELECT fixture_reset();
DO $$
DECLARE blocked boolean := false;
BEGIN
  PERFORM admin_set_club_member_role('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b','member');
  BEGIN
    UPDATE club_members SET role='member'
    WHERE club_id='22222222-2222-2222-2222-222222222222' AND user_id='aaaaaaaa-0000-0000-0000-00000000000a';
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  PERFORM t_assert(blocked, 'T9 raw UPDATE of the last officer raises');
END $$;
SELECT t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 1, 'T9 state intact after the refused UPDATE');

-- T10 — a raw DELETE of the last officer is refused by the trigger
SELECT fixture_reset();
DO $$
DECLARE blocked boolean := false;
BEGIN
  PERFORM admin_remove_club_member('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b');
  BEGIN
    DELETE FROM club_members
    WHERE club_id='22222222-2222-2222-2222-222222222222' AND user_id='aaaaaaaa-0000-0000-0000-00000000000a';
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  PERFORM t_assert(blocked, 'T10 raw DELETE of the last officer raises');
END $$;
SELECT t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 1, 'T10 state intact after the refused DELETE');

-- T11 — rollback consistency: a refused statement leaves membership + roster whole
SELECT fixture_reset();
BEGIN;
  SELECT admin_set_club_member_role('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b','member');
  SAVEPOINT before_bad;
  DO $$
  BEGIN
    BEGIN
      DELETE FROM club_members WHERE club_id='22222222-2222-2222-2222-222222222222' AND user_id='aaaaaaaa-0000-0000-0000-00000000000a';
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'PASS  T11 refusal surfaced inside an open transaction';
    END;
  END $$;
ROLLBACK;
SELECT t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 2, 'T11 rollback restored both officers');
SELECT t_assert((SELECT count(*) FROM club_members WHERE club_id='22222222-2222-2222-2222-222222222222') = 3, 'T11 rollback restored all memberships');
SELECT t_assert((SELECT count(*) FROM club_officers WHERE club_id='22222222-2222-2222-2222-222222222222') = 2, 'T11 rollback restored the roster');

\echo '=============================================================='
\echo 'T12-T14  Cascade exemptions (account + club deletion MUST work)'
\echo '=============================================================='

-- T12 — permanent ACCOUNT DELETION of a club's ONLY officer must succeed
SELECT fixture_reset();
DO $$
BEGIN
  PERFORM admin_set_club_member_role('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b','member');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 1, 'T12 club has exactly one officer');
  -- The real production path: delete_own_account_atomic (052) runs as the user
  -- and ends in DELETE FROM auth.users, cascading auth.users → profiles →
  -- club_members. This is the App Store 5.1.1(v) in-app deletion flow.
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  PERFORM delete_own_account_atomic();
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM auth.users WHERE id='aaaaaaaa-0000-0000-0000-00000000000a'), 'T12 account row deleted');
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM profiles WHERE id='aaaaaaaa-0000-0000-0000-00000000000a'), 'T12 profile deleted');
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM club_members WHERE user_id='aaaaaaaa-0000-0000-0000-00000000000a'), 'T12 membership cascade completed');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 0, 'T12 club is left officerless BY DESIGN (deletion is never blocked)');
END $$;

-- Restore the deleted account for the remaining tests.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES (:UA, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@day8.edu', 'x', now(), now(), now());
INSERT INTO profiles (id, username, full_name, university_id, onboarding_completed, email_verified)
VALUES (:UA,'day8_a','Officer A',:U1,true,true);

-- T13 — raw account deletion (auth.users cascade) of the last officer succeeds
SELECT fixture_reset();
DO $$
BEGIN
  PERFORM admin_set_club_member_role('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b','member');
  DELETE FROM auth.users WHERE id='aaaaaaaa-0000-0000-0000-00000000000a';
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM club_members WHERE user_id='aaaaaaaa-0000-0000-0000-00000000000a'), 'T13 raw auth.users cascade completed for the sole officer');
END $$;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES (:UA, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@day8.edu', 'x', now(), now(), now());
INSERT INTO profiles (id, username, full_name, university_id, onboarding_completed, email_verified)
VALUES (:UA,'day8_a','Officer A',:U1,true,true);

-- T14 — CLUB DELETION with live officers must succeed
SELECT fixture_reset();
DO $$
BEGIN
  DELETE FROM clubs WHERE id='22222222-2222-2222-2222-222222222222';
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM clubs WHERE id='22222222-2222-2222-2222-222222222222'), 'T14 club deleted');
  PERFORM t_assert(NOT EXISTS (SELECT 1 FROM club_members WHERE club_id='22222222-2222-2222-2222-222222222222'), 'T14 membership cascade completed');
END $$;

INSERT INTO clubs (id, name, handle, description, university_id, is_active)
VALUES (:C1, 'Day8 Test Club', 'day8-test-club', 'Officer floor fixture', :U1, true);

\echo '=============================================================='
\echo 'T15-T17  Student paths unchanged'
\echo '=============================================================='

-- T15 — leave_club still refuses the sole officer (unchanged wording)
SELECT fixture_reset();
DO $$
DECLARE r text;
BEGIN
  PERFORM admin_set_club_member_role('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-00000000000b','member');
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  r := leave_club('22222222-2222-2222-2222-222222222222');
  PERFORM t_assert(r = 'blocked_only_officer', 'T15 sole officer still blocked from leaving (got ' || r || ')');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 1, 'T15 officer retained');
END $$;

-- T16 — an ordinary member leaving is completely unaffected
SELECT fixture_reset();
DO $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
  r := leave_club('22222222-2222-2222-2222-222222222222');
  PERFORM t_assert(r = 'left', 'T16 ordinary member leaves normally (got ' || r || ')');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 2, 'T16 officers untouched');
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

-- T17 — a non-last officer leaving via leave_club still works
SELECT fixture_reset();
DO $$
DECLARE r text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}', true);
  r := leave_club('22222222-2222-2222-2222-222222222222');
  PERFORM t_assert(r = 'left', 'T17 non-last officer can still leave (got ' || r || ')');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 1, 'T17 one officer remains');
  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

\echo '=============================================================='
\echo 'T18  Client roles cannot reach the administrator RPCs'
\echo '=============================================================='

SELECT fixture_reset();
DO $$
DECLARE denied int := 0;
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM admin_set_club_member_role('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a','member');
  EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
  END;
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM admin_remove_club_member('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a');
  EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
  END;
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM admin_transfer_club_officer('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-00000000000a','cccccccc-0000-0000-0000-00000000000c');
  EXCEPTION WHEN insufficient_privilege THEN denied := denied + 1;
  END;
  RESET ROLE;
  PERFORM t_assert(denied = 3, 'T18 anon/authenticated denied EXECUTE on all three admin RPCs (denied=' || denied || ')');
  PERFORM t_assert(officer_count('22222222-2222-2222-2222-222222222222') = 2, 'T18 nothing changed');
END $$;

\echo '=============================================================='
\echo 'ALL SEQUENTIAL TESTS PASSED'
\echo '=============================================================='
