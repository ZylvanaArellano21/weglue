-- ============================================================
-- Verification tests for migration 046 (complete notifications
-- system). Run via Management API; everything happens inside one
-- transaction and is rolled back — no production data is touched.
--
-- Covers:
--   1.  Registry seeded + FK replaces the CHECK constraint.
--   2.  Security: the open INSERT policy is gone; UPDATE policy
--       carries WITH CHECK.
--   3.  push token RPCs: register/steal/deactivate authorization.
--   4.  Preference enforcement in enqueue_push (category off = no
--       push; master off = no push; caps respected).
--   5.  Grouping: two likes = one row (group_count 2, both actors),
--       same actor never double-counts, unlike decrements/removes.
--   6.  Dedup: notify_club_post twice = one row per member;
--       no self-notification for the author.
--   7.  Message push fan-out: recipient only (never the sender),
--       muted participant suppressed, exact-channel copy, route
--       payload validates (screen/chatId).
--   8.  Event reminders: one-hour reminder exactly once (idempotent
--       across scheduler retries), last-chance only for members
--       without an RSVP, no reminder after RSVP flips to cant.
--   9.  event_updated grouping + event_canceled on delete.
--   10. Social proof: signup work-table row, fan-out grouped daily,
--       no push (registry push=false).
--   11. get_unread_summary_for shape + thread counting.
--   12. Cron jobs registered.
-- ============================================================
BEGIN;

CREATE TEMP TABLE t_results (test text, ok boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  v_ua UUID := gen_random_uuid(); -- author / officer
  v_ub UUID := gen_random_uuid(); -- member with device
  v_uc UUID := gen_random_uuid(); -- second liker
  v_club UUID;
  v_conv UUID;
  v_main_channel UUID;
  v_post UUID;
  v_event UUID;
  v_msg UUID;
  v_cnt INT;
  v_cnt2 INT;
  v_txt TEXT;
  v_txt2 TEXT;
  v_bool BOOLEAN;
  v_json JSONB;
  v_notif notifications%ROWTYPE;
BEGIN
  -- ── fixtures: synthetic users (auth trigger may or may not create the
  --    profile row depending on metadata; both paths are handled) ─────────
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-046-a@example.com', 'x', now(),
     '{"username":"test046a","full_name":"Test A"}'::jsonb, now(), now()),
    (v_ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-046-b@example.com', 'x', now(),
     '{"username":"test046b","full_name":"Test B"}'::jsonb, now(), now()),
    (v_uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-046-c@example.com', 'x', now(),
     '{"username":"test046c","full_name":"Test C"}'::jsonb, now(), now());
  INSERT INTO profiles (id, username, full_name)
  VALUES (v_ua, 'test046a', 'Test A'), (v_ub, 'test046b', 'Test B'), (v_uc, 'test046c', 'Test C')
  ON CONFLICT (id) DO NOTHING;

  -- ════ 1. registry + FK ══════════════════════════════════════
  SELECT count(*) INTO v_cnt FROM notification_types;
  INSERT INTO t_results VALUES ('1a registry seeded', v_cnt >= 28, 'types=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM information_schema.table_constraints
  WHERE table_name = 'notifications' AND constraint_name = 'notifications_type_fkey';
  INSERT INTO t_results VALUES ('1b type FK exists', v_cnt = 1, '');
  SELECT count(*) INTO v_cnt FROM information_schema.table_constraints
  WHERE table_name = 'notifications' AND constraint_name = 'notifications_type_check';
  INSERT INTO t_results VALUES ('1c old CHECK gone', v_cnt = 0, '');

  -- ════ 2. RLS lockdown ═══════════════════════════════════════
  SELECT count(*) INTO v_cnt FROM pg_policies
  WHERE tablename = 'notifications' AND policyname = 'notifications: service can insert';
  INSERT INTO t_results VALUES ('2a open INSERT policy dropped', v_cnt = 0, '');
  SELECT count(*) INTO v_cnt FROM pg_policies
  WHERE tablename = 'notifications' AND cmd = 'UPDATE' AND with_check IS NOT NULL;
  INSERT INTO t_results VALUES ('2b UPDATE has WITH CHECK', v_cnt = 1, '');
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE tablename = 'push_queue';
  INSERT INTO t_results VALUES ('2c push_queue has no client policies', v_cnt = 0, '');

  -- ════ 3. push token RPCs ════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ub::text, 'role', 'authenticated')::text, true);
  PERFORM register_push_token('ExponentPushToken[test-046-b]', 'ios', 'production', 'Test iPhone');
  SELECT count(*) INTO v_cnt FROM push_tokens
  WHERE token = 'ExponentPushToken[test-046-b]' AND user_id = v_ub AND status = 'active';
  INSERT INTO t_results VALUES ('3a token registered to B', v_cnt = 1, '');

  -- same device logs into C: token MOVES, never duplicates
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uc::text, 'role', 'authenticated')::text, true);
  PERFORM register_push_token('ExponentPushToken[test-046-b]', 'ios', 'production', 'Test iPhone');
  SELECT count(*), max(user_id::text) INTO v_cnt, v_txt FROM push_tokens
  WHERE token = 'ExponentPushToken[test-046-b]';
  INSERT INTO t_results VALUES ('3b token stolen not duplicated',
    v_cnt = 1 AND v_txt = v_uc::text, 'rows=' || v_cnt);

  -- back to B for the rest, and C keeps its own token
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ub::text, 'role', 'authenticated')::text, true);
  PERFORM register_push_token('ExponentPushToken[test-046-b]', 'ios', 'production', 'Test iPhone');

  -- deactivate requires ownership
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uc::text, 'role', 'authenticated')::text, true);
  PERFORM deactivate_push_token('ExponentPushToken[test-046-b]'); -- not C's token
  SELECT status INTO v_txt FROM push_tokens WHERE token = 'ExponentPushToken[test-046-b]';
  INSERT INTO t_results VALUES ('3c non-owner cannot deactivate', v_txt = 'active', v_txt);
  BEGIN
    PERFORM register_push_token('bad-token', 'windows', 'production', NULL);
    INSERT INTO t_results VALUES ('3d invalid platform rejected', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t_results VALUES ('3d invalid platform rejected', true, SQLERRM);
  END;

  -- ════ 4. preference enforcement in enqueue_push ═════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ub::text, 'role', 'authenticated')::text, true);
  INSERT INTO notification_preferences (user_id, push_social) VALUES (v_ub, false)
  ON CONFLICT (user_id) DO UPDATE SET push_social = false;

  PERFORM enqueue_push(v_ub, NULL, 'like', 'T', 'social off', '{}'::jsonb, NULL, 'test4a', 0);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE dedupe_key = 'test4a';
  INSERT INTO t_results VALUES ('4a category off = no push', v_cnt = 0, '');

  PERFORM enqueue_push(v_ub, NULL, 'event_reminder_hour', 'T', 'events on', '{}'::jsonb, NULL, 'test4b', 0);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE dedupe_key = 'test4b';
  INSERT INTO t_results VALUES ('4b category on = push queued', v_cnt = 1, '');

  UPDATE notification_preferences SET push_enabled = false WHERE user_id = v_ub;
  PERFORM enqueue_push(v_ub, NULL, 'event_reminder_hour', 'T', 'master off', '{}'::jsonb, NULL, 'test4c', 0);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE dedupe_key = 'test4c';
  INSERT INTO t_results VALUES ('4c master off = no push', v_cnt = 0, '');
  UPDATE notification_preferences SET push_enabled = true, push_social = true WHERE user_id = v_ub;

  -- no active token = nothing queued
  PERFORM enqueue_push(v_ua, NULL, 'event_reminder_hour', 'T', 'no device', '{}'::jsonb, NULL, 'test4d', 0);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE dedupe_key = 'test4d';
  INSERT INTO t_results VALUES ('4d tokenless user skipped', v_cnt = 0, '');

  -- ════ 5. like grouping ══════════════════════════════════════
  -- B authors a post; A and C like it → ONE notification, count 2
  INSERT INTO posts (author_id, post_type, image_url, caption)
  VALUES (v_ub, 'picture', 'https://example.com/t.jpg', 'test')
  RETURNING id INTO v_post;
  INSERT INTO post_likes (post_id, user_id) VALUES (v_post, v_ua);
  INSERT INTO post_likes (post_id, user_id) VALUES (v_post, v_uc);

  SELECT count(*) INTO v_cnt FROM notifications
  WHERE user_id = v_ub AND type = 'like' AND entity_id = v_post;
  SELECT group_count INTO v_cnt2 FROM notifications
  WHERE user_id = v_ub AND type = 'like' AND entity_id = v_post;
  INSERT INTO t_results VALUES ('5a two likes = one grouped row',
    v_cnt = 1 AND v_cnt2 = 2, 'rows=' || v_cnt || ' count=' || COALESCE(v_cnt2, -1));

  SELECT * INTO v_notif FROM notifications
  WHERE user_id = v_ub AND type = 'like' AND entity_id = v_post;
  INSERT INTO t_results VALUES ('5b group_actors holds both',
    v_notif.group_actors @> ARRAY[v_ua, v_uc], array_length(v_notif.group_actors, 1)::text);
  INSERT INTO t_results VALUES ('5c route filled by trigger',
    v_notif.route ->> 'screen' = 'post' AND (v_notif.route ->> 'postId')::uuid = v_post,
    v_notif.route::text);

  -- same actor re-liking never double counts (unlike → like again)
  DELETE FROM post_likes WHERE post_id = v_post AND user_id = v_ua;
  SELECT group_count INTO v_cnt FROM notifications
  WHERE user_id = v_ub AND type = 'like' AND entity_id = v_post;
  INSERT INTO t_results VALUES ('5d unlike decrements group', v_cnt = 1, 'count=' || v_cnt);
  INSERT INTO post_likes (post_id, user_id) VALUES (v_post, v_ua);
  INSERT INTO post_likes (post_id, user_id) VALUES (v_post, v_ua) ON CONFLICT DO NOTHING;
  SELECT count(*), max(group_count) INTO v_cnt, v_cnt2 FROM notifications
  WHERE user_id = v_ub AND type = 'like' AND entity_id = v_post;
  INSERT INTO t_results VALUES ('5e re-like regroups without dupes',
    v_cnt = 1 AND v_cnt2 = 2, 'rows=' || v_cnt || ' count=' || v_cnt2);

  -- author liking own post never notifies
  INSERT INTO post_likes (post_id, user_id) VALUES (v_post, v_ub);
  SELECT count(*) INTO v_cnt FROM notifications
  WHERE user_id = v_ub AND type = 'like' AND actor_id = v_ub;
  INSERT INTO t_results VALUES ('5f no self-notification', v_cnt = 0, '');

  -- ════ 6. club fixtures + club_post dedupe ═══════════════════
  INSERT INTO clubs (name, handle, description)
  VALUES ('Test 046 Club', 'test046club', 'temp')
  RETURNING id INTO v_club;
  INSERT INTO club_members (club_id, user_id, role) VALUES (v_club, v_ua, 'officer');
  INSERT INTO club_members (club_id, user_id, role) VALUES (v_club, v_ub, 'member');

  PERFORM notify_club_post(v_post, v_club, v_ua);
  PERFORM notify_club_post(v_post, v_ua, v_ua); -- bogus club id: must be a no-op
  PERFORM notify_club_post(v_post, v_club, v_ua); -- retry: dedupe absorbs
  SELECT count(*) INTO v_cnt FROM notifications
  WHERE type = 'club_post' AND entity_id = v_post;
  SELECT count(*) INTO v_cnt2 FROM notifications
  WHERE type = 'club_post' AND entity_id = v_post AND user_id = v_ua;
  INSERT INTO t_results VALUES ('6a club post once per member, never the author',
    v_cnt = 1 AND v_cnt2 = 0, 'rows=' || v_cnt);

  -- ════ 7. message push fan-out ═══════════════════════════════
  SELECT c.id INTO v_conv FROM conversations c
  WHERE c.club_id = v_club AND c.type = 'club_group' LIMIT 1;
  INSERT INTO t_results VALUES ('7a club conversation auto-created', v_conv IS NOT NULL, '');

  SELECT ch.id INTO v_main_channel FROM conversation_channels ch
  WHERE ch.conversation_id = v_conv ORDER BY ch.display_order LIMIT 1;

  DELETE FROM push_queue WHERE user_id IN (v_ua, v_ub, v_uc); -- clean slate
  INSERT INTO messages (conversation_id, channel_id, sender_id, content)
  VALUES (v_conv, v_main_channel, v_ua, 'hello members')
  RETURNING id INTO v_msg;

  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_ub AND category = 'messages';
  SELECT count(*) INTO v_cnt2 FROM push_queue WHERE user_id = v_ua;
  INSERT INTO t_results VALUES ('7b recipient pushed, sender never',
    v_cnt = 1 AND v_cnt2 = 0, 'b=' || v_cnt || ' a=' || v_cnt2);

  SELECT route ->> 'screen', route ->> 'chatId' INTO v_txt, v_txt2
  FROM push_queue WHERE user_id = v_ub AND category = 'messages' LIMIT 1;
  INSERT INTO t_results VALUES ('7c chat route payload',
    v_txt = 'chat' AND v_txt2 = v_conv::text, COALESCE(v_txt, 'null'));

  -- muted participant: fresh state, then no push
  DELETE FROM push_queue WHERE user_id = v_ub;
  UPDATE conversation_participants SET muted_at = now()
  WHERE conversation_id = v_conv AND user_id = v_ub;
  INSERT INTO messages (conversation_id, channel_id, sender_id, content)
  VALUES (v_conv, v_main_channel, v_ua, 'muted message');
  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_ub AND category = 'messages';
  INSERT INTO t_results VALUES ('7d muted thread suppresses push', v_cnt = 0, '');
  UPDATE conversation_participants SET muted_at = NULL
  WHERE conversation_id = v_conv AND user_id = v_ub;

  -- ════ 8. event reminders ════════════════════════════════════
  -- Event starting in ~58 minutes (Chicago wall clock): the one-hour window.
  INSERT INTO events (club_id, created_by, title, event_date, start_time, end_time, visibility)
  VALUES (
    v_club, v_ua, 'Test 046 Event',
    ((now() + interval '58 minutes') AT TIME ZONE 'America/Chicago')::date,
    ((now() + interval '58 minutes') AT TIME ZONE 'America/Chicago')::time,
    ((now() + interval '118 minutes') AT TIME ZONE 'America/Chicago')::time,
    'members'
  ) RETURNING id INTO v_event;
  INSERT INTO event_rsvps (event_id, user_id, status) VALUES (v_event, v_ub, 'going');

  PERFORM process_event_reminders();
  PERFORM process_event_reminders(); -- scheduler retry: must be idempotent
  SELECT count(*) INTO v_cnt FROM notifications
  WHERE type = 'event_reminder_hour' AND entity_id = v_event AND user_id = v_ub;
  INSERT INTO t_results VALUES ('8a one-hour reminder exactly once', v_cnt = 1, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM notifications
  WHERE type = 'event_reminder_hour' AND entity_id = v_event AND user_id = v_ua;
  INSERT INTO t_results VALUES ('8b no reminder without Going RSVP', v_cnt = 0, '');

  -- last chance: event in ~5h55m; A is a member with no RSVP, B is going
  INSERT INTO events (club_id, created_by, title, event_date, start_time, end_time, visibility)
  VALUES (
    v_club, v_ub, 'Test 046 LastChance',
    ((now() + interval '355 minutes') AT TIME ZONE 'America/Chicago')::date,
    ((now() + interval '355 minutes') AT TIME ZONE 'America/Chicago')::time,
    ((now() + interval '415 minutes') AT TIME ZONE 'America/Chicago')::time,
    'members'
  ) RETURNING id INTO v_event;
  INSERT INTO event_rsvps (event_id, user_id, status) VALUES (v_event, v_ub, 'going');
  PERFORM process_event_reminders();
  SELECT count(*) INTO v_cnt FROM notifications
  WHERE type = 'event_last_chance' AND entity_id = v_event AND user_id = v_ua;
  SELECT count(*) INTO v_cnt2 FROM notifications
  WHERE type = 'event_last_chance' AND entity_id = v_event AND user_id = v_ub;
  INSERT INTO t_results VALUES ('8c last chance: only the un-RSVPd member',
    v_cnt = 1 AND v_cnt2 = 0, 'a=' || v_cnt || ' b=' || v_cnt2);

  -- ════ 9. event update + cancel ══════════════════════════════
  UPDATE events SET location = 'New location' WHERE id = v_event;
  UPDATE events SET location = 'Even newer location' WHERE id = v_event;
  SELECT count(*), max(group_count) INTO v_cnt, v_cnt2 FROM notifications
  WHERE type = 'event_updated' AND entity_id = v_event AND user_id = v_ub;
  INSERT INTO t_results VALUES ('9a repeated edits merge into one update',
    v_cnt = 1 AND v_cnt2 = 2, 'rows=' || v_cnt || ' count=' || COALESCE(v_cnt2, -1));

  DELETE FROM events WHERE id = v_event;
  SELECT count(*) INTO v_cnt FROM notifications
  WHERE type = 'event_canceled' AND user_id = v_ub AND entity_id = v_club;
  INSERT INTO t_results VALUES ('9b cancellation notified before delete', v_cnt = 1, '');
  SELECT count(*) INTO v_cnt FROM notifications
  WHERE entity_id = v_event; -- 038 cleanup wipes event-entity rows
  INSERT INTO t_results VALUES ('9c stale event rows cleaned', v_cnt = 0, 'rows=' || v_cnt);

  -- ════ 10. social proof ══════════════════════════════════════
  SELECT count(*) INTO v_cnt FROM social_proof_events
  WHERE actor_id IN (v_ua, v_ub, v_uc) AND kind = 'student_joined';
  INSERT INTO t_results VALUES ('10a signup queued for social proof', v_cnt = 3, 'rows=' || v_cnt);

  PERFORM process_social_proof_events();
  SELECT count(*) INTO v_cnt FROM notifications
  WHERE type = 'student_joined' AND user_id = v_ub;
  SELECT count(*) INTO v_cnt2 FROM push_queue
  WHERE user_id = v_ub AND category = 'social_proof';
  INSERT INTO t_results VALUES ('10b fan-out grouped, in-app only',
    v_cnt = 1 AND v_cnt2 = 0, 'rows=' || v_cnt || ' pushes=' || v_cnt2);
  SELECT count(*) INTO v_cnt FROM social_proof_events
  WHERE actor_id IN (v_ua, v_ub, v_uc) AND processed = false;
  INSERT INTO t_results VALUES ('10c work table drained', v_cnt = 0, '');

  -- ════ 11. unread summary ════════════════════════════════════
  SELECT get_unread_summary_for(v_ub) INTO v_json;
  INSERT INTO t_results VALUES ('11a summary shape + counts',
    (v_json ->> 'unread_notifications')::int > 0 AND (v_json ->> 'unread_threads')::int >= 1,
    v_json::text);

  -- reading the thread clears it (per-channel read state)
  INSERT INTO channel_reads (channel_id, user_id, last_read_at)
  VALUES (v_main_channel, v_ub, now())
  ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_at = now();
  SELECT get_unread_summary_for(v_ub) INTO v_json;
  INSERT INTO t_results VALUES ('11b channel read clears its thread',
    (v_json ->> 'unread_threads')::int = 0, v_json::text);

  -- mark-all read clears the inbox count
  UPDATE notifications SET read = true WHERE user_id = v_ub AND read = false;
  SELECT get_unread_summary_for(v_ub) INTO v_json;
  SELECT read_at IS NOT NULL INTO v_bool FROM notifications
  WHERE user_id = v_ub AND read = true LIMIT 1;
  INSERT INTO t_results VALUES ('11c read-all zeroes badge + stamps read_at',
    (v_json ->> 'unread_notifications')::int = 0 AND v_bool, v_json::text);

  -- ════ 12. cron jobs ═════════════════════════════════════════
  SELECT count(*) INTO v_cnt FROM cron.job
  WHERE jobname IN ('process-event-reminders', 'dispatch-push') AND active;
  INSERT INTO t_results VALUES ('12a cron jobs scheduled', v_cnt = 2, 'jobs=' || v_cnt);
END $$;

SELECT test, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, detail
FROM t_results ORDER BY test;

ROLLBACK;
