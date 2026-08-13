-- ===========================================================================
-- Harness for migration 085 (student_joined named copy + destination fix —
-- correction 4, part 3: founder decisions on the Fix 4 follow-up).
--
-- Run after test_085_fixture_schema.sql + 085_student_joined_named_copy.sql,
-- on a disposable postgres:17 container:
--   docker exec -u postgres <container> psql -v ON_ERROR_STOP=1 -U postgres \
--     -f test_085_fixture_schema.sql \
--     -f ../migrations/085_student_joined_named_copy.sql \
--     -f test_085_student_joined_named_copy.sql
--
-- 4 BEGIN/ROLLBACK ASSERT-based tests (nonzero exit = fail, same "raise"
-- criterion as test_053_platform_admin.sql):
--   J — chat_invite_joined's notification_types.description documents it as
--       intentionally deferred (founder decision, not built or removed).
--   K — a single student_joined notification matches the exact founder
--       template "[Name] joined We Glue 🎉" and its route opens that
--       student's profile.
--   L — a second student joining within the group window merges into
--       "[Newest Name] and [N] other students joined We Glue 🎉", AND the
--       route advances to the NEWEST joiner (not the stale first one) — the
--       actual destination-staleness bug this migration fixes.
--   M — member_joined (a different grouped type whose route depends on a
--       stable entity_id, not an actor) is unaffected by the generic
--       route-recompute change — still opens the same club.
-- ===========================================================================
\set ON_ERROR_STOP on

DROP TRIGGER IF EXISTS trg_notifications_prepare ON public.notifications;
CREATE TRIGGER trg_notifications_prepare
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_prepare();

-- ============================================================
-- TEST J: chat_invite_joined is documented as intentionally deferred.
-- ============================================================
BEGIN;
  DO $$
  DECLARE v_desc TEXT;
  BEGIN
    SELECT description INTO v_desc FROM public.notification_types WHERE type = 'chat_invite_joined';
    ASSERT v_desc LIKE '%DEFERRED%', 'TEST J FAILED: chat_invite_joined should be documented as deferred, got: ' || COALESCE(v_desc,'NULL');
    RAISE NOTICE 'TEST J PASSED: chat_invite_joined is documented as intentionally deferred';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST K: a single student_joined notification uses "[Name] joined We Glue
-- 🎉" — no "just", exact founder template.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, full_name, is_seed) VALUES
    ('11111111-1111-1111-1111-111111111111','recipient1',NULL,false),
    ('22222222-2222-2222-2222-222222222222','camila','Camila Ruiz',false);
  INSERT INTO public.social_proof_events (kind, actor_id) VALUES ('student_joined','22222222-2222-2222-2222-222222222222');
  SELECT public.process_social_proof_events();
  DO $$
  DECLARE v_msg TEXT; v_route JSONB;
  BEGIN
    SELECT message, route INTO v_msg, v_route FROM public.notifications
      WHERE type = 'student_joined' AND user_id = '11111111-1111-1111-1111-111111111111';
    ASSERT v_msg = 'Camila Ruiz joined We Glue 🎉', 'TEST K FAILED: expected exact single-student template, got: ' || COALESCE(v_msg,'NULL');
    ASSERT v_route->>'screen' = 'profile' AND v_route->>'userId' = '22222222-2222-2222-2222-222222222222',
      'TEST K FAILED: route should open the named student''s profile, got: ' || v_route;
    RAISE NOTICE 'TEST K PASSED: single student uses exact template and opens their profile: %', v_msg;
  END $$;
ROLLBACK;

-- ============================================================
-- TEST L: a SECOND student joining within the group window merges into
-- "[Newest Name] and [N] other students joined We Glue 🎉" — and the route
-- advances to the NEWEST joiner too (the actual destination-staleness fix).
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, full_name, is_seed) VALUES
    ('33333333-3333-3333-3333-333333333333','recipient2',NULL,false),
    ('44444444-4444-4444-4444-444444444444','aisha','Aisha Thompson',false),
    ('55555555-5555-5555-5555-555555555555','jordan','Jordan Williams',false);

  INSERT INTO public.social_proof_events (kind, actor_id) VALUES ('student_joined','44444444-4444-4444-4444-444444444444');
  SELECT public.process_social_proof_events();
  DO $$
  DECLARE v_msg TEXT;
  BEGIN
    SELECT message INTO v_msg FROM public.notifications
      WHERE type = 'student_joined' AND user_id = '33333333-3333-3333-3333-333333333333';
    ASSERT v_msg = 'Aisha Thompson joined We Glue 🎉', 'TEST L FAILED (pre-merge): got: ' || COALESCE(v_msg,'NULL');
  END $$;

  -- A second student joins — must MERGE into the same row (group_key is
  -- type-only for entity_id IS NULL, so this is a true merge, not a second row).
  INSERT INTO public.social_proof_events (kind, actor_id) VALUES ('student_joined','55555555-5555-5555-5555-555555555555');
  SELECT public.process_social_proof_events();

  DO $$
  DECLARE v_msg TEXT; v_route JSONB; v_count INT; v_rowcount INT;
  BEGIN
    SELECT count(*) INTO v_rowcount FROM public.notifications
      WHERE type = 'student_joined' AND user_id = '33333333-3333-3333-3333-333333333333';
    ASSERT v_rowcount = 1, 'TEST L FAILED: expected one merged row, not two, got ' || v_rowcount;

    SELECT message, route, group_count INTO v_msg, v_route, v_count FROM public.notifications
      WHERE type = 'student_joined' AND user_id = '33333333-3333-3333-3333-333333333333';
    ASSERT v_msg = 'Jordan Williams and 1 other students joined We Glue 🎉',
      'TEST L FAILED: expected exact multi-student template naming the NEWEST joiner, got: ' || COALESCE(v_msg,'NULL');
    ASSERT v_route->>'userId' = '55555555-5555-5555-5555-555555555555',
      'TEST L FAILED: route must advance to the newest joiner (Jordan), got: ' || v_route;
    ASSERT v_count = 2, 'TEST L FAILED: group_count should be 2, got ' || v_count;
    RAISE NOTICE 'TEST L PASSED: merged copy names the newest joiner AND the route opens that same person: %', v_msg;
  END $$;
ROLLBACK;

-- ============================================================
-- TEST M: member_joined (a DIFFERENT grouped type whose route depends on a
-- stable entity_id, not an actor) is unaffected by the route-recompute
-- change — still opens the same club regardless of which member is named.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, full_name) VALUES
    ('66666666-6666-6666-6666-666666666666','recipient3','Recipient Three'),
    ('77777777-7777-7777-7777-777777777777','new_member_a','New Member A'),
    ('88888888-8888-8888-8888-888888888888','new_member_b','New Member B');
  INSERT INTO public.clubs (id, name) VALUES ('99999999-9999-9999-9999-999999999999','Chess Club');

  INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
    VALUES ('66666666-6666-6666-6666-666666666666','77777777-7777-7777-7777-777777777777','member_joined',
            '99999999-9999-9999-9999-999999999999','club', false, 'New Member A joined Chess Club.');
  INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
    VALUES ('66666666-6666-6666-6666-666666666666','88888888-8888-8888-8888-888888888888','member_joined',
            '99999999-9999-9999-9999-999999999999','club', false, 'New Member B joined Chess Club.');
  DO $$
  DECLARE v_route JSONB; v_rowcount INT;
  BEGIN
    SELECT count(*) INTO v_rowcount FROM public.notifications
      WHERE type = 'member_joined' AND user_id = '66666666-6666-6666-6666-666666666666';
    ASSERT v_rowcount = 1, 'TEST M FAILED: expected one merged row, got ' || v_rowcount;
    SELECT route INTO v_route FROM public.notifications
      WHERE type = 'member_joined' AND user_id = '66666666-6666-6666-6666-666666666666';
    ASSERT v_route->>'screen' = 'club' AND v_route->>'clubId' = '99999999-9999-9999-9999-999999999999',
      'TEST M FAILED: member_joined route must still open the club, got: ' || v_route;
    RAISE NOTICE 'TEST M PASSED: member_joined route unaffected by the recompute (still the stable club destination)';
  END $$;
ROLLBACK;

\echo '=== ALL 085 TESTS COMPLETED ==='
