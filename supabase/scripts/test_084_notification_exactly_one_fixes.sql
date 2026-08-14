-- ===========================================================================
-- Harness for migration 084 ("exactly one notification per add" fixes —
-- correction 4, part 2, requested in direct response to the founder's
-- follow-up questions on the original Fix 4 audit).
--
-- Run after test_084_fixture_schema.sql + 083_notification_coverage_audit_
-- fixes.sql + 084_notification_exactly_one_fixes.sql, on a disposable
-- postgres:17 container:
--   docker exec -u postgres <container> psql -v ON_ERROR_STOP=1 -U postgres \
--     -f test_084_fixture_schema.sql \
--     -f ../migrations/083_notification_coverage_audit_fixes.sql \
--     -f ../migrations/084_notification_exactly_one_fixes.sql \
--     -f test_084_notification_exactly_one_fixes.sql
--
-- 6 BEGIN/ROLLBACK ASSERT-based tests (nonzero exit = fail, same "raise"
-- criterion as test_053_platform_admin.sql):
--   F/F2 — an officer adding a new club member now sends exactly one
--          club-membership notification (club_chat_added), not also
--          club_joined; the member_joined broadcast to existing members is
--          unaffected.
--   G    — a self-driven join (self-serve, or the club invite-join path)
--          still gets exactly one club_joined — proves the auth.uid() guard
--          is not over-broad.
--   H/H2 — joining a custom group via invite link now notifies exactly once
--          (previously zero); re-opening the same invite while already
--          active does not duplicate it.
--   I    — joining a CLUB via invite link still gets exactly one
--          club_joined and never club_chat_added.
-- ===========================================================================
\set ON_ERROR_STOP on

-- Wire the trigger 084's comments say is "unchanged" (created in 004/010,
-- not part of 083/084).
DROP TRIGGER IF EXISTS trg_club_join_add_to_gc ON public.club_members;
CREATE TRIGGER trg_club_join_add_to_gc
  AFTER INSERT ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_club_join();

-- ============================================================
-- TEST F: officer-added NEW member gets exactly ONE club-membership
-- notification (club_chat_added), not also club_joined.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university) VALUES
    ('11111111-1111-1111-1111-111111111111','officer_f','Lone Star'),
    ('22222222-2222-2222-2222-222222222222','target_f','Lone Star');
  INSERT INTO public.clubs (id, name, university) VALUES ('33333333-3333-3333-3333-333333333333','Robotics','Lone Star');
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','officer');
  SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  SELECT public.add_club_member_by_officer('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222');
  DO $$
  DECLARE v_joined INT; v_chat_added INT;
  BEGIN
    SELECT count(*) INTO v_joined FROM public.notifications
      WHERE type = 'club_joined' AND user_id = '22222222-2222-2222-2222-222222222222';
    SELECT count(*) INTO v_chat_added FROM public.notifications
      WHERE type = 'club_chat_added' AND user_id = '22222222-2222-2222-2222-222222222222';
    ASSERT v_joined = 0, 'TEST F FAILED: officer-add must NOT also send club_joined, got ' || v_joined;
    ASSERT v_chat_added = 1, 'TEST F FAILED: officer-add must send exactly 1 club_chat_added, got ' || v_chat_added;
    RAISE NOTICE 'TEST F PASSED: officer-added member gets exactly one club-membership notification (club_chat_added, not club_joined)';
  END $$;
  -- Existing members must still learn about the new member regardless of path.
  DO $$
  DECLARE v_member_joined INT;
  BEGIN
    SELECT count(*) INTO v_member_joined FROM public.notifications
      WHERE type = 'member_joined' AND user_id = '11111111-1111-1111-1111-111111111111';
    ASSERT v_member_joined = 1, 'TEST F2 FAILED: existing officer should still get member_joined, got ' || v_member_joined;
    RAISE NOTICE 'TEST F2 PASSED: member_joined broadcast to existing members is unaffected';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST G: a SELF-driven join (self-serve upsert, same auth.uid() as the
-- joiner) still gets exactly one club_joined — the guard is not over-broad.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university) VALUES
    ('44444444-4444-4444-4444-444444444444','self_joiner','Lone Star');
  INSERT INTO public.clubs (id, name, university) VALUES ('55555555-5555-5555-5555-555555555555','Chess','Lone Star');
  SET LOCAL request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
  INSERT INTO public.club_members (club_id, user_id, role)
    VALUES ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','member')
    ON CONFLICT (club_id, user_id) DO NOTHING;
  DO $$
  DECLARE v_joined INT;
  BEGIN
    SELECT count(*) INTO v_joined FROM public.notifications
      WHERE type = 'club_joined' AND user_id = '44444444-4444-4444-4444-444444444444';
    ASSERT v_joined = 1, 'TEST G FAILED: self-driven join must still get exactly 1 club_joined, got ' || v_joined;
    RAISE NOTICE 'TEST G PASSED: self-driven join still gets club_joined (guard is not over-broad)';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST H: joining a custom group via invite link now notifies exactly once
-- (previously zero); re-opening the same invite while already active does
-- not duplicate it.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES
    ('66666666-6666-6666-6666-666666666666','group_creator'),
    ('77777777-7777-7777-7777-777777777777','invited_joiner');
  INSERT INTO public.conversations (id, type, created_by) VALUES
    ('88888888-8888-8888-8888-888888888888','group','66666666-6666-6666-6666-666666666666');
  INSERT INTO public.chat_invitations (token, conversation_id, created_by) VALUES
    ('tok-group-1','88888888-8888-8888-8888-888888888888','66666666-6666-6666-6666-666666666666');
  SET LOCAL request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
  SELECT public.join_chat_invitation('tok-group-1');
  DO $$
  DECLARE v_count INT;
  BEGIN
    SELECT count(*) INTO v_count FROM public.notifications
      WHERE type = 'group_chat_added' AND user_id = '77777777-7777-7777-7777-777777777777';
    ASSERT v_count = 1, 'TEST H FAILED: joining a group via invite must notify exactly once, got ' || v_count;
    RAISE NOTICE 'TEST H PASSED: group invite-join notifies exactly once (was zero before 084)';
  END $$;
  -- Re-opening the same invite link while already active: must not duplicate.
  SELECT public.join_chat_invitation('tok-group-1');
  DO $$
  DECLARE v_count INT;
  BEGIN
    SELECT count(*) INTO v_count FROM public.notifications
      WHERE type = 'group_chat_added' AND user_id = '77777777-7777-7777-7777-777777777777';
    ASSERT v_count = 1, 'TEST H2 FAILED: re-opening the same invite while already active must not duplicate, got ' || v_count;
    RAISE NOTICE 'TEST H2 PASSED: re-opening the invite while already active does not duplicate';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST I: joining a CLUB via invite link (club_group case) still gets
-- exactly one club_joined (auth.uid() = the joiner here too).
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university) VALUES
    ('99999999-9999-9999-9999-999999999999','club_invite_joiner','Lone Star');
  INSERT INTO public.clubs (id, name, university) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Debate','Lone Star');
  INSERT INTO public.conversations (id, type, club_id) VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','club_group','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  INSERT INTO public.chat_invitations (token, conversation_id, created_by) VALUES
    ('tok-club-1','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  SET LOCAL request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
  SELECT public.join_chat_invitation('tok-club-1');
  DO $$
  DECLARE v_joined INT; v_chat_added INT;
  BEGIN
    SELECT count(*) INTO v_joined FROM public.notifications
      WHERE type = 'club_joined' AND user_id = '99999999-9999-9999-9999-999999999999';
    SELECT count(*) INTO v_chat_added FROM public.notifications
      WHERE type = 'club_chat_added' AND user_id = '99999999-9999-9999-9999-999999999999';
    ASSERT v_joined = 1, 'TEST I FAILED: club invite-join must get exactly 1 club_joined, got ' || v_joined;
    ASSERT v_chat_added = 0, 'TEST I FAILED: club invite-join must NOT also get club_chat_added, got ' || v_chat_added;
    RAISE NOTICE 'TEST I PASSED: club invite-join gets exactly one notification (club_joined)';
  END $$;
ROLLBACK;

\echo '=== ALL 084 TESTS COMPLETED ==='
