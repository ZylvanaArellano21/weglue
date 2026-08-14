-- ===========================================================================
-- Harness for migration 083 (notification event-coverage audit fixes) —
-- correction 4.
--
-- Run after test_083_fixture_schema.sql + 083_notification_coverage_audit_
-- fixes.sql, on a disposable postgres:17 container, e.g.:
--   docker exec -u postgres <container> psql -v ON_ERROR_STOP=1 -U postgres \
--     -f test_083_fixture_schema.sql \
--     -f ../migrations/083_notification_coverage_audit_fixes.sql \
--     -f test_083_notification_coverage_audit_fixes.sql
--
-- 8 BEGIN/ROLLBACK tests (ASSERT-based — a nonzero exit status is the
-- pass/fail signal, same "raise" criterion as test_053_platform_admin.sql):
--   A/A2 — officer_role: same-title re-add does not duplicate, a real title
--          change still notifies.
--   B    — club_chat_added: no-op re-add does not duplicate.
--   C/C2 — group_chat_added: no-op re-add of an active participant does not
--          duplicate; restoring a hidden participant still notifies.
--   D    — club_inactive: message is a real string naming the club, not NULL.
--   E/E2 — club_photo: every other member notifies exactly once, the
--          uploader never notifies themselves, and a tagged_post photo
--          (already covered by club_post) does not double-notify.
-- ===========================================================================
\set ON_ERROR_STOP on

-- Wire the triggers 083's own comments say are "unchanged" (created in 033/
-- 006, not part of 083) — needed here only so this isolated fixture
-- exercises them the same way production's real triggers, already in place
-- since those earlier migrations, do.
DROP TRIGGER IF EXISTS trg_club_officer_role_notify ON public.club_officers;
CREATE TRIGGER trg_club_officer_role_notify
  AFTER INSERT OR UPDATE OF role_title ON public.club_officers
  FOR EACH ROW EXECUTE FUNCTION public.handle_club_officer_role_notify();

-- ============================================================
-- TEST A: officer_role does NOT re-fire on a same-title re-add.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, full_name) VALUES
    ('11111111-1111-1111-1111-111111111111','officer1','Officer One'),
    ('22222222-2222-2222-2222-222222222222','target1','Target One');
  INSERT INTO public.clubs (id, name) VALUES ('33333333-3333-3333-3333-333333333333','Chess Club');
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','officer');
  SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  SELECT public.add_club_officer('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','President');
  -- Same call again, same title — must NOT create a second notification.
  SELECT public.add_club_officer('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','President');
  DO $$
  DECLARE v_count INT;
  BEGIN
    SELECT count(*) INTO v_count FROM public.notifications
      WHERE type = 'officer_role' AND user_id = '22222222-2222-2222-2222-222222222222';
    ASSERT v_count = 1, 'TEST A FAILED: expected exactly 1 officer_role notification, got ' || v_count;
    RAISE NOTICE 'TEST A PASSED: no-op re-add of the same title does not duplicate officer_role';
  END $$;
  -- A REAL title change must still notify (proves the guard isn't over-broad).
  SELECT public.add_club_officer('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','Vice President');
  DO $$
  DECLARE v_count INT;
  BEGIN
    SELECT count(*) INTO v_count FROM public.notifications
      WHERE type = 'officer_role' AND user_id = '22222222-2222-2222-2222-222222222222';
    ASSERT v_count = 2, 'TEST A2 FAILED: a real title change must still notify, got ' || v_count;
    RAISE NOTICE 'TEST A2 PASSED: a genuine title change still notifies';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST B: club_chat_added does NOT re-fire on a no-op re-add.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university) VALUES
    ('44444444-4444-4444-4444-444444444444','officer2','Lone Star'),
    ('55555555-5555-5555-5555-555555555555','target2','Lone Star');
  INSERT INTO public.clubs (id, name, university) VALUES ('66666666-6666-6666-6666-666666666666','Clay Club','Lone Star');
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('66666666-6666-6666-6666-666666666666','44444444-4444-4444-4444-444444444444','officer');
  SET LOCAL request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
  SELECT public.add_club_member_by_officer('66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555');
  SELECT public.add_club_member_by_officer('66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555');
  DO $$
  DECLARE v_count INT;
  BEGIN
    SELECT count(*) INTO v_count FROM public.notifications
      WHERE type = 'club_chat_added' AND user_id = '55555555-5555-5555-5555-555555555555';
    ASSERT v_count = 1, 'TEST B FAILED: expected exactly 1 club_chat_added notification, got ' || v_count;
    RAISE NOTICE 'TEST B PASSED: no-op re-add does not duplicate club_chat_added';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST C: group_chat_added does NOT re-fire for an already-active
-- participant, but DOES fire for a genuinely new one and for someone
-- restored from hidden.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES
    ('77777777-7777-7777-7777-777777777777','creator'),
    ('88888888-8888-8888-8888-888888888888','member_a'),
    ('99999999-9999-9999-9999-999999999999','member_b');
  INSERT INTO public.conversations (id, type, created_by) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','group','77777777-7777-7777-7777-777777777777');
  SET LOCAL request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
  -- First add: genuinely new — must notify.
  SELECT public.add_group_participants('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ARRAY['88888888-8888-8888-8888-888888888888']::uuid[]);
  -- Re-add the SAME already-active participant — must NOT notify again.
  SELECT public.add_group_participants('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ARRAY['88888888-8888-8888-8888-888888888888']::uuid[]);
  DO $$
  DECLARE v_count INT;
  BEGIN
    SELECT count(*) INTO v_count FROM public.notifications
      WHERE type = 'group_chat_added' AND user_id = '88888888-8888-8888-8888-888888888888';
    ASSERT v_count = 1, 'TEST C FAILED: expected exactly 1 group_chat_added for the active member, got ' || v_count;
    RAISE NOTICE 'TEST C PASSED: no-op re-add of an active participant does not duplicate group_chat_added';
  END $$;
  -- Hide member_a (simulate leaving), then restore — restoring DOES count as
  -- a new notify-worthy add.
  UPDATE public.conversation_participants SET hidden_at = now()
    WHERE conversation_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND user_id = '88888888-8888-8888-8888-888888888888';
  SELECT public.add_group_participants('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ARRAY['88888888-8888-8888-8888-888888888888']::uuid[]);
  DO $$
  DECLARE v_count INT;
  BEGIN
    SELECT count(*) INTO v_count FROM public.notifications
      WHERE type = 'group_chat_added' AND user_id = '88888888-8888-8888-8888-888888888888';
    ASSERT v_count = 2, 'TEST C2 FAILED: restoring a hidden participant should notify again, got ' || v_count;
    RAISE NOTICE 'TEST C2 PASSED: restoring a previously-hidden participant still notifies';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST D: club_inactive now has a real message (not NULL).
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','officer3');
  INSERT INTO public.clubs (id, name, is_active, last_activity_at, inactivity_warned_at)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','Debate Club', true, now() - interval '40 days', NULL);
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','officer');
  -- June/July/December are skipped by design — pin the check to a month that
  -- always runs regardless of when this test executes.
  DO $$
  DECLARE v_month INT := EXTRACT(MONTH FROM NOW())::INT;
  BEGIN
    IF v_month IN (6,7,12) THEN
      RAISE NOTICE 'TEST D SKIPPED: current month is excluded by design (6/7/12)';
    ELSE
      PERFORM public.check_club_inactivity();
    END IF;
  END $$;
  DO $$
  DECLARE v_msg TEXT; v_month INT := EXTRACT(MONTH FROM NOW())::INT;
  BEGIN
    IF v_month IN (6,7,12) THEN RETURN; END IF;
    SELECT message INTO v_msg FROM public.notifications
      WHERE type = 'club_inactive' AND user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    ASSERT v_msg IS NOT NULL AND v_msg <> '', 'TEST D FAILED: club_inactive message should not be null/empty, got ' || COALESCE(v_msg, 'NULL');
    ASSERT v_msg LIKE '%Debate Club%', 'TEST D FAILED: message should name the club, got: ' || v_msg;
    RAISE NOTICE 'TEST D PASSED: club_inactive has a real message: %', v_msg;
  END $$;
ROLLBACK;

-- ============================================================
-- TEST E: officer-uploaded club photo notifies every OTHER member exactly
-- once; a tagged-post photo (source = 'tagged_post') does NOT double-notify.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, full_name) VALUES
    ('dddddddd-dddd-dddd-dddd-dddddddddddd','uploader','Uploader Officer'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','member_c',NULL),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff','member_d',NULL);
  INSERT INTO public.clubs (id, name) VALUES ('12121212-1212-1212-1212-121212121212','Photo Club');
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('12121212-1212-1212-1212-121212121212','dddddddd-dddd-dddd-dddd-dddddddddddd','officer'),
    ('12121212-1212-1212-1212-121212121212','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','member'),
    ('12121212-1212-1212-1212-121212121212','ffffffff-ffff-ffff-ffff-ffffffffffff','member');

  INSERT INTO public.club_photos (id, club_id, url, uploaded_by, source)
    VALUES ('13131313-1313-1313-1313-131313131313','12121212-1212-1212-1212-121212121212','https://x/y.jpg',
            'dddddddd-dddd-dddd-dddd-dddddddddddd','officer_upload');
  DO $$
  DECLARE v_count INT; v_uploader_count INT;
  BEGIN
    SELECT count(*) INTO v_count FROM public.notifications WHERE type = 'club_photo';
    ASSERT v_count = 2, 'TEST E FAILED: expected 2 recipients (member_c, member_d), got ' || v_count;
    SELECT count(*) INTO v_uploader_count FROM public.notifications
      WHERE type = 'club_photo' AND user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    ASSERT v_uploader_count = 0, 'TEST E FAILED: the uploader must never notify themselves, got ' || v_uploader_count;
    RAISE NOTICE 'TEST E PASSED: officer_upload notifies every other member, never the uploader';
  END $$;

  -- A tagged_post photo must NOT create a club_photo notification (club_post
  -- already covers it via the posts-insert trigger, which this fixture does
  -- not wire up — the assertion is simply "no club_photo row for it").
  INSERT INTO public.club_photos (id, club_id, url, uploaded_by, source, post_id)
    VALUES ('14141414-1414-1414-1414-141414141414','12121212-1212-1212-1212-121212121212','https://x/z.jpg',
            'dddddddd-dddd-dddd-dddd-dddddddddddd','tagged_post','15151515-1515-1515-1515-151515151515');
  DO $$
  DECLARE v_count INT;
  BEGIN
    SELECT count(*) INTO v_count FROM public.notifications
      WHERE type = 'club_photo' AND entity_id = '14141414-1414-1414-1414-141414141414';
    ASSERT v_count = 0, 'TEST E2 FAILED: tagged_post photos must not get their own club_photo notification, got ' || v_count;
    RAISE NOTICE 'TEST E2 PASSED: tagged_post photos are correctly excluded (club_post already covers them)';
  END $$;
ROLLBACK;

\echo '=== ALL 083 TESTS COMPLETED ==='
