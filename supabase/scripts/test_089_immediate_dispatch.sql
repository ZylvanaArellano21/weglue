-- ============================================================
-- Verification for migration 089 (immediate push dispatch, and
-- the photo-post double-push fix found while validating it).
-- Everything happens inside one transaction and is rolled back.
--
-- Proves two things, against a real disposable clone of the
-- production-shaped stack (not a mock, not code review):
--
--  1. invoke_push_dispatch() now fires SYNCHRONOUSLY in the same
--     transaction as the triggering insert/update, for all three
--     paths that got a new call (notifications_after_insert_push,
--     notifications_after_group_merge_push, handle_message_push).
--     pg_cron is not even installed as an extension in this
--     throwaway clone (asserted below), so any dispatch signal
--     seen can only have come from the new PERFORM call — never
--     a cron tick.
--
--  2. A photo post now enqueues exactly ONE push per same-
--     university recipient, not two (the pre-existing 088 bug:
--     notify_photo_post_university's own direct enqueue_push call
--     duplicated the one notifications_after_insert_push already
--     made, under a different dedupe_key, so both survived
--     ON CONFLICT DO NOTHING).
--
-- Signal for (1): invoke_push_dispatch() RAISE WARNINGs
-- 'invoke_push_dispatch: missing push.dispatch_url config or
-- push_dispatch_secret vault secret' whenever it actually runs
-- and finds no vault secret (true here — deliberately not
-- configuring a real one, so this test can never attempt a real
-- network call). Each RAISE NOTICE checkpoint below brackets
-- exactly one statement, so warnings between two checkpoints are
-- attributed unambiguously to that one statement.
-- ============================================================
BEGIN;

CREATE TEMP TABLE t_results (test text, ok boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  v_ua UUID := gen_random_uuid(); -- post author / club officer / message sender
  v_ub UUID := gen_random_uuid(); -- liker A / message recipient / photo-post recipient
  v_uc UUID := gen_random_uuid(); -- liker B
  v_univ UUID;
  v_club UUID;
  v_conv UUID;
  v_main_channel UUID;
  v_post UUID;
  v_cnt INT;
  v_cnt2 INT;
BEGIN
  SELECT id INTO v_univ FROM universities LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-089-a@example.com', 'x', now(), '{"username":"test089a","full_name":"Test A"}'::jsonb, now(), now()),
    (v_ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-089-b@example.com', 'x', now(), '{"username":"test089b","full_name":"Test B"}'::jsonb, now(), now()),
    (v_uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-089-c@example.com', 'x', now(), '{"username":"test089c","full_name":"Test C"}'::jsonb, now(), now());
  INSERT INTO profiles (id, username, full_name, university_id)
  VALUES (v_ua, 'test089a', 'Test A', v_univ), (v_ub, 'test089b', 'Test B', v_univ), (v_uc, 'test089c', 'Test C', v_univ)
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ub::text, 'role', 'authenticated')::text, true);
  PERFORM register_push_token('ExponentPushToken[test-089-b]', 'ios', 'production', 'Test iPhone');

  -- A also needs a token: A is a recipient of the photo-post fan-out
  -- (author is B), so this is what lets that check see a real push_queue
  -- row instead of a no-op (enqueue_push bails silently with no token).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ua::text, 'role', 'authenticated')::text, true);
  PERFORM register_push_token('ExponentPushToken[test-089-a]', 'ios', 'production', 'Test iPhone A');

  SELECT count(*) INTO v_cnt FROM pg_extension WHERE extname = 'pg_cron';
  INSERT INTO t_results VALUES ('0 pg_cron not installed in this clone (no cron confound possible)',
    v_cnt = 0, 'installed=' || v_cnt);

  RAISE NOTICE '>>> CHECKPOINT: image post by B -> notify_photo_post_university (fn #4) fires once';
  INSERT INTO posts (author_id, post_type, image_url, caption)
  VALUES (v_ub, 'picture', 'https://example.com/t.jpg', 'test')
  RETURNING id INTO v_post;

  DELETE FROM push_queue WHERE user_id = v_ub;

  RAISE NOTICE '>>> CHECKPOINT: A likes the post -> notifications_after_insert_push (fn #1) fires once';
  INSERT INTO post_likes (post_id, user_id) VALUES (v_post, v_ua);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_ub AND category = 'social';
  INSERT INTO t_results VALUES ('1a first like enqueues a push for the author',
    v_cnt = 1, 'rows=' || v_cnt);

  RAISE NOTICE '>>> CHECKPOINT: C also likes it -> notifications_after_group_merge_push (fn #2) fires once';
  INSERT INTO post_likes (post_id, user_id) VALUES (v_post, v_uc);
  SELECT group_count INTO v_cnt2 FROM notifications
  WHERE user_id = v_ub AND type = 'like' AND entity_id = v_post;
  INSERT INTO t_results VALUES ('2a second like (different actor) merges into the same row',
    v_cnt2 = 2, 'group_count=' || COALESCE(v_cnt2, -1));

  RAISE NOTICE '>>> CHECKPOINT: club + main channel setup (no push path)';
  INSERT INTO clubs (name, handle, description)
  VALUES ('Test 089 Club', 'test089club', 'temp')
  RETURNING id INTO v_club;
  INSERT INTO club_members (club_id, user_id, role) VALUES (v_club, v_ua, 'officer');
  INSERT INTO club_members (club_id, user_id, role) VALUES (v_club, v_ub, 'member');
  SELECT c.id INTO v_conv FROM conversations c WHERE c.club_id = v_club AND c.type = 'club_group' LIMIT 1;
  SELECT ch.id INTO v_main_channel FROM conversation_channels ch WHERE ch.conversation_id = v_conv ORDER BY ch.display_order LIMIT 1;

  -- A is the club officer and needs to actually be authenticated as
  -- themself for can_post_in_channel()/is_conversation_participant() to
  -- authorize the send (both read auth.uid()).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ua::text, 'role', 'authenticated')::text, true);

  DELETE FROM push_queue WHERE user_id = v_ub;
  RAISE NOTICE '>>> CHECKPOINT: A messages the club chat -> handle_message_push (fn #3) fires once, after its loop';
  INSERT INTO messages (conversation_id, channel_id, sender_id, content)
  VALUES (v_conv, v_main_channel, v_ua, 'hello members');
  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_ub AND category = 'messages';
  INSERT INTO t_results VALUES ('3a message fan-out enqueues exactly one push for the (only) recipient',
    v_cnt = 1, 'rows=' || v_cnt);

  RESET request.jwt.claims;

  -- Before this migration, this recipient had exactly TWO rows here (one
  -- from notify_photo_post_university's own direct enqueue_push call, one
  -- from the cascading notifications_after_insert_push trigger) — a real
  -- double-push. Exactly 1 proves that bug is fixed.
  SELECT count(*) INTO v_cnt FROM push_queue
  WHERE user_id = v_ua AND category = 'clubs' AND route ->> 'postId' = v_post::text;
  INSERT INTO t_results VALUES ('4a photo post fans out exactly one push per recipient (not two)',
    v_cnt = 1, 'rows=' || v_cnt);

  RAISE NOTICE '=== END OF CHECKPOINTS ===';
END $$;

SELECT test, ok, detail FROM t_results ORDER BY test;

ROLLBACK;
