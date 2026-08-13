-- ===========================================================================
-- Harness for migrations 081 (first-login push permission) and 082
-- (conversation-read realtime sync) — corrections 1 and 5.
--
-- Run after test_081_082_fixture_schema.sql + 081_first_login_push_permission.sql
-- + 082_conversation_read_realtime_sync.sql, on a disposable postgres:17
-- container (docker run --rm -d -e POSTGRES_PASSWORD=postgres postgres:17),
-- e.g.:
--   docker exec -u postgres <container> psql -v ON_ERROR_STOP=1 -U postgres \
--     -f test_081_082_fixture_schema.sql \
--     -f ../migrations/081_first_login_push_permission.sql \
--     -f ../migrations/082_conversation_read_realtime_sync.sql \
--     -f test_081_082_notifications_permission_readsync.sql
--
-- Every test uses BEGIN/ROLLBACK + ASSERT (which RAISEs on failure), so a
-- nonzero psql exit status is the pass/fail signal — same "raise" criterion
-- as test_053_platform_admin.sql.
-- ===========================================================================
\set ON_ERROR_STOP on
\pset format aligned

-- Wire the trigger 081's own header says is "unchanged" (created in 043,
-- not part of 081/082) — needed here only so this fixture can exercise
-- handle_new_user() the same way production's real trigger does.
DROP TRIGGER IF EXISTS trg_test_handle_new_user ON auth.users;
CREATE TRIGGER trg_test_handle_new_user
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- TEST 1: brand-new signup -> push_permission_prompt_pending = true
-- ============================================================
BEGIN;
  INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111', 'new1@school.edu');
  DO $$
  DECLARE v BOOLEAN;
  BEGIN
    SELECT push_permission_prompt_pending INTO v FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111';
    ASSERT v = true, 'TEST 1 FAILED: new signup should have push_permission_prompt_pending = true, got ' || v;
    RAISE NOTICE 'TEST 1 PASSED: new signup flag is true';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST 2: an existing row (inserted directly, not via handle_new_user/
-- ensure_profile — simulating a pre-081 account) must be UNTOUCHED: the
-- column DEFAULT applies with zero migration-side UPDATE, proving no
-- retroactive targeting of existing accounts.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES ('22222222-2222-2222-2222-222222222222', 'existing_user');
  DO $$
  DECLARE v BOOLEAN;
  BEGIN
    SELECT push_permission_prompt_pending INTO v FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222';
    ASSERT v = false, 'TEST 2 FAILED: pre-existing row must default to false, got ' || v;
    RAISE NOTICE 'TEST 2 PASSED: existing-shaped row defaults to false (column DEFAULT, no backfill)';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST 3: consume_push_permission_prompt() flips the CALLER's own row,
-- and only the caller's own row (ownership / auth.uid() scoping).
-- ============================================================
BEGIN;
  INSERT INTO auth.users (id, email) VALUES ('33333333-3333-3333-3333-333333333333', 'a@school.edu');
  INSERT INTO auth.users (id, email) VALUES ('44444444-4444-4444-4444-444444444444', 'b@school.edu');
  -- both now have push_permission_prompt_pending = true via the trigger.
  SET LOCAL request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  SELECT public.consume_push_permission_prompt();
  DO $$
  DECLARE v_a BOOLEAN; v_b BOOLEAN;
  BEGIN
    SELECT push_permission_prompt_pending INTO v_a FROM public.profiles WHERE id = '33333333-3333-3333-3333-333333333333';
    SELECT push_permission_prompt_pending INTO v_b FROM public.profiles WHERE id = '44444444-4444-4444-4444-444444444444';
    ASSERT v_a = false, 'TEST 3a FAILED: caller''s own flag should now be false, got ' || v_a;
    ASSERT v_b = true, 'TEST 3b FAILED: consume must NOT touch another user''s row, got ' || v_b;
    RAISE NOTICE 'TEST 3 PASSED: consume flips only the caller''s own row';
  END $$;
  -- idempotent second call: no error, stays false.
  SELECT public.consume_push_permission_prompt();
  DO $$
  DECLARE v_a BOOLEAN;
  BEGIN
    SELECT push_permission_prompt_pending INTO v_a FROM public.profiles WHERE id = '33333333-3333-3333-3333-333333333333';
    ASSERT v_a = false, 'TEST 3c FAILED: second call should be a harmless no-op';
    RAISE NOTICE 'TEST 3c PASSED: second consume call is idempotent';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST 4: ensure_profile() repair path also sets the flag true for a
-- genuinely missing row (mirrors handle_new_user's behavior exactly).
-- ============================================================
BEGIN;
  -- Insert straight into auth.users WITHOUT firing the trigger (simulates the
  -- PGRST116 repair scenario: an auth identity exists, no profiles row yet).
  ALTER TABLE auth.users DISABLE TRIGGER trg_test_handle_new_user;
  INSERT INTO auth.users (id, email) VALUES ('55555555-5555-5555-5555-555555555555', 'c@school.edu');
  ALTER TABLE auth.users ENABLE TRIGGER trg_test_handle_new_user;
  SET LOCAL request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
  SELECT public.ensure_profile();
  DO $$
  DECLARE v BOOLEAN;
  BEGIN
    SELECT push_permission_prompt_pending INTO v FROM public.profiles WHERE id = '55555555-5555-5555-5555-555555555555';
    ASSERT v = true, 'TEST 4 FAILED: ensure_profile repair of a genuinely missing row should set true, got ' || v;
    RAISE NOTICE 'TEST 4 PASSED: ensure_profile sets the flag for a freshly-inserted row';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST 5: ensure_profile() must NOT touch an EXISTING row (ON CONFLICT DO
-- NOTHING) — ensures the repair path can never retroactively flip an
-- existing account's already-consumed flag back to true.
-- ============================================================
BEGIN;
  ALTER TABLE auth.users DISABLE TRIGGER trg_test_handle_new_user;
  INSERT INTO auth.users (id, email) VALUES ('66666666-6666-6666-6666-666666666666', 'd@school.edu');
  ALTER TABLE auth.users ENABLE TRIGGER trg_test_handle_new_user;
  INSERT INTO public.profiles (id, username, push_permission_prompt_pending)
    VALUES ('66666666-6666-6666-6666-666666666666', 'already_had_profile', false);
  SET LOCAL request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
  SELECT public.ensure_profile();
  DO $$
  DECLARE v BOOLEAN;
  BEGIN
    SELECT push_permission_prompt_pending INTO v FROM public.profiles WHERE id = '66666666-6666-6666-6666-666666666666';
    ASSERT v = false, 'TEST 5 FAILED: ensure_profile must not touch an existing row, got ' || v;
    RAISE NOTICE 'TEST 5 PASSED: ensure_profile never retroactively flips an existing row';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST 6 (082): mark_conversation_read() sends the sync:message-inbox
-- broadcast for the CALLING user only, and only when a row actually matched.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES ('77777777-7777-7777-7777-777777777777', 'reader');
  INSERT INTO public.conversations (id, type) VALUES ('88888888-8888-8888-8888-888888888888', 'direct');
  INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
    ('88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777');
  SET LOCAL request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
  SELECT public.mark_conversation_read('88888888-8888-8888-8888-888888888888');
  DO $$
  DECLARE v_read TIMESTAMPTZ; v_topic TEXT;
  BEGIN
    SELECT last_read_at INTO v_read FROM public.conversation_participants
      WHERE conversation_id = '88888888-8888-8888-8888-888888888888' AND user_id = '77777777-7777-7777-7777-777777777777';
    ASSERT v_read IS NOT NULL, 'TEST 6a FAILED: last_read_at should be set';
    SELECT topic INTO v_topic FROM public.realtime_send_log WHERE topic = 'sync:message-inbox:77777777-7777-7777-7777-777777777777' ORDER BY id DESC LIMIT 1;
    ASSERT v_topic IS NOT NULL, 'TEST 6b FAILED: expected a sync:message-inbox broadcast for the reader — this is THE fix';
    RAISE NOTICE 'TEST 6 PASSED: mark_conversation_read persists AND broadcasts';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST 7 (082): mark_conversation_read() for a conversation the caller is
-- NOT a participant in touches nothing and broadcasts nothing (no FOUND).
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES ('99999999-9999-9999-9999-999999999999', 'not_a_participant');
  INSERT INTO public.conversations (id, type) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'direct');
  SET LOCAL request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
  SELECT public.mark_conversation_read('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  DO $$
  DECLARE v_topic TEXT;
  BEGIN
    SELECT topic INTO v_topic FROM public.realtime_send_log WHERE topic = 'sync:message-inbox:99999999-9999-9999-9999-999999999999';
    ASSERT v_topic IS NULL, 'TEST 7 FAILED: must not broadcast when nothing was actually updated';
    RAISE NOTICE 'TEST 7 PASSED: no-op for a non-participant produces no broadcast';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST 8 (082): mark_channel_read() persists AND broadcasts.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'channel_reader');
  INSERT INTO public.conversations (id, type) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'club_group');
  INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  INSERT INTO public.conversation_channels (id, conversation_id) VALUES
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
  SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  SELECT public.mark_channel_read('dddddddd-dddd-dddd-dddd-dddddddddddd');
  DO $$
  DECLARE v_read TIMESTAMPTZ; v_topic TEXT;
  BEGIN
    SELECT last_read_at INTO v_read FROM public.channel_reads
      WHERE channel_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' AND user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    ASSERT v_read IS NOT NULL, 'TEST 8a FAILED: channel_reads row should exist';
    SELECT topic INTO v_topic FROM public.realtime_send_log WHERE topic = 'sync:message-inbox:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' ORDER BY id DESC LIMIT 1;
    ASSERT v_topic IS NOT NULL, 'TEST 8b FAILED: expected a sync:message-inbox broadcast for the channel reader';
    RAISE NOTICE 'TEST 8 PASSED: mark_channel_read persists AND broadcasts';
  END $$;
ROLLBACK;

DROP TRIGGER trg_test_handle_new_user ON auth.users;

\echo '=== ALL TESTS COMPLETED (see NOTICEs above; any ASSERT failure aborts its own transaction with an ERROR) ==='
