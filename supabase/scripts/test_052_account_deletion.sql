-- ============================================================
-- Verification tests for migration 052 (complete, permanent
-- account deletion — App Store Guideline 5.1.1(v)).
--
-- Run via the Management API: everything happens inside ONE
-- transaction and is rolled back, so no production data is
-- touched and no real account is ever deleted.
--
-- Fixture: user A is the subject (fully onboarded, with one of
-- everything). User B is a bystander who shares a club, a group
-- conversation and an event with A. User C reports A.
--
-- Covers:
--   1.  Auth + profile are really gone (no ghost account).
--   2.  Every CASCADE-owned table is empty for A.
--   3.  Storage paths returned, per bucket, for the objects the
--       caller must sweep — including the two buckets the old
--       Edge Function could not see.
--   4.  Shared conversation history survives, anonymized;
--       solo-thread messages and their attachments are gone.
--   5.  The seven no-FK / SET-NULL residues 052 closes.
--   6.  Moderation evidence retained, reporter identity removed.
--   7.  Other users and shared club data are untouched.
--   8.  Security: caller can only ever delete themself;
--       unauthenticated call rejected; second call is a no-op
--       error, never a partial delete.
--   9.  Legacy delete_own_user_data() hard-fails and is ungranted.
--   10. complete_oauth_onboarding() is ungranted (Microsoft gone).
-- ============================================================
BEGIN;

CREATE TEMP TABLE t_results (test text, ok boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  v_a    UUID := gen_random_uuid();  -- subject
  v_b    UUID := gen_random_uuid();  -- bystander
  v_c    UUID := gen_random_uuid();  -- reporter of A
  v_club UUID;
  v_uni  UUID;
  v_event      UUID;
  v_post       UUID;
  v_post2      UUID;
  v_shared_cnv UUID;
  v_solo_cnv   UUID;
  v_chan       UUID;
  v_msg_shared UUID;
  v_msg_solo   UUID;
  v_poll       UUID;
  v_poll_opt   UUID;
  v_notif_b    UUID;
  v_photo_up   UUID;
  v_photo_post UUID;
  v_report_by_a UUID;
  v_report_on_a UUID;
  v_paths JSONB;
  v_cnt   INT;
  v_txt   TEXT;
  v_uuid  UUID;
  v_arr   UUID[];
  v_bool  BOOLEAN;
BEGIN
  -- ══ fixtures ═══════════════════════════════════════════════
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-052-a@example.edu', 'x', now(), '{"username":"test052a"}'::jsonb, now(), now()),
    (v_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-052-b@example.edu', 'x', now(), '{"username":"test052b"}'::jsonb, now(), now()),
    (v_c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-052-c@example.edu', 'x', now(), '{"username":"test052c"}'::jsonb, now(), now());

  INSERT INTO profiles (id, username, full_name, avatar_url, avatar_type)
  VALUES
    (v_a, 'test052a', 'Test A',
     'https://x.supabase.co/storage/v1/object/public/avatars/' || v_a || '/av.jpg', 'photo'),
    (v_b, 'test052b', 'Test B', NULL, 'text'),
    (v_c, 'test052c', 'Test C', NULL, 'text')
  ON CONFLICT (id) DO UPDATE
    SET avatar_url = EXCLUDED.avatar_url, avatar_type = EXCLUDED.avatar_type;

  SELECT id INTO v_uni FROM universities LIMIT 1;
  IF v_uni IS NULL THEN
    INSERT INTO universities (name, slug) VALUES ('Test U 052', 'test-u-052') RETURNING id INTO v_uni;
  END IF;

  INSERT INTO clubs (name, handle, description, university_id)
  VALUES ('Test 052 Club', 'test-052-club', 'fixture', v_uni) RETURNING id INTO v_club;

  INSERT INTO club_members (club_id, user_id, role) VALUES (v_club, v_a, 'officer'), (v_club, v_b, 'member');
  INSERT INTO club_officers (club_id, user_id, display_name, role_title)
  VALUES (v_club, v_a, 'Test A', 'President');

  -- Event created by B whose audience explicitly names A (no FK on the array).
  INSERT INTO events (club_id, created_by, title, event_date, start_time, end_time,
                      visibility, specific_user_ids)
  VALUES (v_club, v_b, 'Test 052 Event', current_date + 7, '10:00', '11:00',
          'specific', ARRAY[v_a, v_c])
  RETURNING id INTO v_event;

  INSERT INTO event_rsvps (event_id, user_id, status) VALUES (v_event, v_a, 'going');
  INSERT INTO saved_events (user_id, event_id) VALUES (v_a, v_event);

  -- A's post (with an image) + B's post that A likes and comments on.
  INSERT INTO posts (author_id, club_id, post_type, image_url, caption)
  VALUES (v_a, v_club, 'picture',
          'https://x.supabase.co/storage/v1/object/public/posts/' || v_a || '/p1.jpg', 'A post')
  RETURNING id INTO v_post;
  INSERT INTO posts (author_id, club_id, post_type, caption)
  VALUES (v_b, v_club, 'picture', 'B post') RETURNING id INTO v_post2;
  INSERT INTO post_likes (post_id, user_id) VALUES (v_post2, v_a);
  INSERT INTO post_comments (post_id, user_id, content) VALUES (v_post2, v_a, 'A comment');

  -- Club gallery: one photo derived from A's post (dies with the post) and one
  -- A uploaded straight into the gallery (the residue 052 closes).
  -- The club-photo row for a club post is materialized by an existing trigger,
  -- so read it rather than inserting a duplicate.
  SELECT id INTO v_photo_post FROM club_photos WHERE post_id = v_post;
  IF v_photo_post IS NULL THEN
    INSERT INTO club_photos (club_id, url, uploaded_by, source, post_id)
    VALUES (v_club,
            'https://x.supabase.co/storage/v1/object/public/posts/' || v_a || '/p1.jpg',
            v_a, 'tagged_post', v_post)
    RETURNING id INTO v_photo_post;
  ELSE
    UPDATE club_photos SET uploaded_by = v_a WHERE id = v_photo_post;
  END IF;
  INSERT INTO club_photos (club_id, url, uploaded_by, source, post_id)
  VALUES (v_club,
          'https://x.supabase.co/storage/v1/object/public/club-photos/' || v_club || '/g1.jpg',
          v_a, 'officer_upload', NULL)
  RETURNING id INTO v_photo_up;

  -- Shared conversation (A + B) and a solo conversation (A only).
  INSERT INTO conversations (type, created_by) VALUES ('group', v_a) RETURNING id INTO v_shared_cnv;
  INSERT INTO conversation_channels (conversation_id, name, created_by, is_default)
  VALUES (v_shared_cnv, 'general', v_a, true) RETURNING id INTO v_chan;
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_shared_cnv, v_a), (v_shared_cnv, v_b);
  INSERT INTO messages (conversation_id, channel_id, sender_id, content, attachment_url)
  VALUES (v_shared_cnv, v_chan, v_a, 'survives anonymized', 'shared/keep.pdf')
  RETURNING id INTO v_msg_shared;

  INSERT INTO conversations (type, created_by) VALUES ('direct', v_a) RETURNING id INTO v_solo_cnv;
  INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_solo_cnv, v_a);
  INSERT INTO messages (conversation_id, sender_id, content, attachment_url)
  VALUES (v_solo_cnv, v_a, 'hard-deleted', 'solo/gone.pdf')
  RETURNING id INTO v_msg_solo;

  -- A voted in a poll attached to B's message in the shared thread.
  INSERT INTO messages (conversation_id, channel_id, sender_id, content, message_type)
  VALUES (v_shared_cnv, v_chan, v_b, 'poll?', 'poll') RETURNING id INTO v_uuid;
  INSERT INTO polls (message_id, question) VALUES (v_uuid, 'Q?') RETURNING id INTO v_poll;
  INSERT INTO poll_options (poll_id, option_text, display_order)
  VALUES (v_poll, 'yes', 0) RETURNING id INTO v_poll_opt;
  INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (v_poll, v_poll_opt, v_a);

  -- A live invite token A created.
  INSERT INTO chat_invitations (token, conversation_id, club_id, created_by)
  VALUES ('test-052-token', v_shared_cnv, v_club, v_a);

  -- Social graph, prefs, device, personalization.
  INSERT INTO follows (follower_id, following_id, status) VALUES (v_a, v_b, 'accepted'), (v_c, v_a, 'accepted');
  INSERT INTO user_interests (user_id, interest) VALUES (v_a, 'Music');
  INSERT INTO user_activities (user_id, activity) VALUES (v_a, 'Trips');
  INSERT INTO user_privacy (user_id, is_private) VALUES (v_a, true);
  INSERT INTO push_tokens (user_id, token, platform)
  VALUES (v_a, 'ExponentPushToken[test-052-a]', 'ios');
  INSERT INTO notification_preferences (user_id) VALUES (v_a) ON CONFLICT DO NOTHING;
  -- handle_new_user already generates an onboarding batch; only insert when it
  -- did not (one active batch per user is enforced by a partial unique index).
  INSERT INTO club_recommendation_batches (user_id, club_ids, match_count, source)
  VALUES (v_a, ARRAY[v_club], 1, 'onboarding')
  ON CONFLICT DO NOTHING;

  -- B has a grouped notification whose actor array names A (no FK on the array).
  INSERT INTO notifications (user_id, type, actor_id, group_actors, group_count, message)
  VALUES (v_b, 'like', v_c, ARRAY[v_a, v_c], 2, 'A and C liked your post')
  RETURNING id INTO v_notif_b;

  -- A filed a report (evidence kept, identity removed) and C reported A.
  INSERT INTO reports (reporter_id, reporter_username, reporter_email, entity_type,
                       entity_id, reason, details, content_snapshot, message_sender_id)
  VALUES (v_a, 'test052a', 'test-052-a@example.edu', 'post', v_post2,
          'spam', 'A reported this', 'snapshot text', v_b)
  RETURNING id INTO v_report_by_a;
  INSERT INTO reports (reporter_id, reporter_username, reporter_email, entity_type,
                       entity_id, reason, content_snapshot, message_sender_id)
  VALUES (v_c, 'test052c', 'test-052-c@example.edu', 'user', v_a,
          'harassment', 'evidence about A', v_a)
  RETURNING id INTO v_report_on_a;

  -- A also used the public web form at some point.
  INSERT INTO deletion_requests (email, reason)
  VALUES ('test-052-a@example.edu', 'from the public form');
  INSERT INTO deletion_requests (email, reason)
  VALUES ('test-052-b@example.edu', 'someone else, must survive');

  -- ══ 8a. security: unauthenticated call is rejected ═════════
  PERFORM set_config('request.jwt.claims', NULL, true);
  BEGIN
    PERFORM delete_own_account_atomic();
    INSERT INTO t_results VALUES ('8a unauthenticated rejected', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t_results VALUES ('8a unauthenticated rejected', true, SQLERRM);
  END;

  -- ══ 8b. security: no argument exists to target another user ═
  SELECT count(*) INTO v_cnt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'delete_own_account_atomic'
    AND p.pronargs = 0;
  INSERT INTO t_results VALUES ('8b takes no user-id argument', v_cnt = 1,
    'zero-arg overloads=' || v_cnt);

  SELECT count(*) INTO v_cnt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'delete_own_account_atomic';
  INSERT INTO t_results VALUES ('8c no overload accepts a target', v_cnt = 1,
    'total overloads=' || v_cnt);

  -- ══ run the deletion AS A ═══════════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  SELECT delete_own_account_atomic() INTO v_paths;

  -- ══ 0. the regression this migration exists to fix ═════════
  -- Reaching this line at all means the deletion did not abort. Before 052 it
  -- always did, for any user with a club post: club_photos.uploaded_by SET NULL
  -- re-validated club_photos.post_id against a post the cascade had already
  -- removed (23503), the transaction rolled back, and the in-app Delete Account
  -- button could only ever show "Could not delete your account".
  INSERT INTO t_results VALUES ('0a deletion completes for a user with a club post',
    true, 'no 23503 from club_photos_post_id_fkey');

  -- ══ 1. no ghost account ════════════════════════════════════
  SELECT count(*) INTO v_cnt FROM auth.users WHERE id = v_a;
  INSERT INTO t_results VALUES ('1a auth.users row gone', v_cnt = 0, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM profiles WHERE id = v_a;
  INSERT INTO t_results VALUES ('1b profile gone', v_cnt = 0, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM auth.identities WHERE user_id = v_a;
  INSERT INTO t_results VALUES ('1c auth identities gone', v_cnt = 0, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM auth.sessions WHERE user_id = v_a;
  INSERT INTO t_results VALUES ('1d auth sessions gone', v_cnt = 0, 'rows=' || v_cnt);

  -- ══ 2. every owned table empty for A ═══════════════════════
  SELECT
    (SELECT count(*) FROM posts           WHERE author_id  = v_a)
  + (SELECT count(*) FROM post_likes      WHERE user_id    = v_a)
  + (SELECT count(*) FROM post_comments   WHERE user_id    = v_a)
  + (SELECT count(*) FROM poll_votes      WHERE user_id    = v_a)
  + (SELECT count(*) FROM event_rsvps     WHERE user_id    = v_a)
  + (SELECT count(*) FROM saved_events    WHERE user_id    = v_a)
  + (SELECT count(*) FROM follows         WHERE follower_id = v_a OR following_id = v_a)
  + (SELECT count(*) FROM club_members    WHERE user_id    = v_a)
  + (SELECT count(*) FROM user_interests  WHERE user_id    = v_a)
  + (SELECT count(*) FROM user_activities WHERE user_id    = v_a)
  + (SELECT count(*) FROM user_privacy    WHERE user_id    = v_a)
  + (SELECT count(*) FROM push_tokens     WHERE user_id    = v_a)
  + (SELECT count(*) FROM notification_preferences WHERE user_id = v_a)
  + (SELECT count(*) FROM club_recommendation_batches WHERE user_id = v_a)
  + (SELECT count(*) FROM conversation_participants   WHERE user_id = v_a)
  + (SELECT count(*) FROM notifications   WHERE user_id = v_a OR actor_id = v_a)
    INTO v_cnt;
  INSERT INTO t_results VALUES ('2a all cascade-owned rows gone', v_cnt = 0,
    'residual rows=' || v_cnt);

  -- ══ 3. storage paths returned, per bucket ══════════════════
  INSERT INTO t_results VALUES ('3a avatar path returned',
    v_paths -> 'avatars' ? (v_a::text || '/av.jpg'),
    (v_paths -> 'avatars')::text);
  INSERT INTO t_results VALUES ('3b post image path returned',
    v_paths -> 'posts' ? (v_a::text || '/p1.jpg'),
    (v_paths -> 'posts')::text);
  INSERT INTO t_results VALUES ('3c club-photo upload path returned',
    v_paths -> 'club-photos' ? (v_club::text || '/g1.jpg'),
    (v_paths -> 'club-photos')::text);
  INSERT INTO t_results VALUES ('3d solo-thread attachment returned',
    v_paths -> 'chat-attachments' ? 'solo/gone.pdf',
    (v_paths -> 'chat-attachments')::text);
  INSERT INTO t_results VALUES ('3e shared-thread attachment NOT returned',
    NOT (v_paths -> 'chat-attachments' ? 'shared/keep.pdf'),
    (v_paths -> 'chat-attachments')::text);

  -- ══ 4. message semantics ═══════════════════════════════════
  SELECT sender_id, content INTO v_uuid, v_txt FROM messages WHERE id = v_msg_shared;
  INSERT INTO t_results VALUES ('4a shared message kept, anonymized',
    v_txt = 'survives anonymized' AND v_uuid IS NULL,
    'sender=' || COALESCE(v_uuid::text, 'NULL'));
  SELECT count(*) INTO v_cnt FROM messages WHERE id = v_msg_solo;
  INSERT INTO t_results VALUES ('4b solo message hard-deleted', v_cnt = 0, 'rows=' || v_cnt);

  -- ══ 5. the seven residues ══════════════════════════════════
  SELECT specific_user_ids INTO v_arr FROM events WHERE id = v_event;
  INSERT INTO t_results VALUES ('5a events.specific_user_ids scrubbed',
    NOT (v_a = ANY (v_arr)) AND v_c = ANY (v_arr), v_arr::text);

  SELECT group_actors, group_count INTO v_arr, v_cnt FROM notifications WHERE id = v_notif_b;
  INSERT INTO t_results VALUES ('5b notifications.group_actors scrubbed + recounted',
    NOT (v_a = ANY (v_arr)) AND v_c = ANY (v_arr) AND v_cnt = 1,
    v_arr::text || ' count=' || v_cnt);

  SELECT count(*) INTO v_cnt FROM deletion_requests WHERE lower(email) = 'test-052-a@example.edu';
  INSERT INTO t_results VALUES ('5c own deletion_request removed', v_cnt = 0, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM deletion_requests WHERE lower(email) = 'test-052-b@example.edu';
  INSERT INTO t_results VALUES ('5d other deletion_request untouched', v_cnt = 1, 'rows=' || v_cnt);

  SELECT count(*) INTO v_cnt FROM club_officers WHERE club_id = v_club AND user_id IS NULL;
  INSERT INTO t_results VALUES ('5e no NULL-user officer orphan', v_cnt = 0, 'orphans=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM club_officers WHERE club_id = v_club;
  INSERT INTO t_results VALUES ('5f officer grant removed entirely', v_cnt = 0, 'rows=' || v_cnt);

  SELECT count(*) INTO v_cnt FROM chat_invitations WHERE token = 'test-052-token';
  INSERT INTO t_results VALUES ('5g live invite token removed', v_cnt = 0, 'rows=' || v_cnt);

  SELECT count(*) INTO v_cnt FROM club_photos WHERE id = v_photo_up;
  INSERT INTO t_results VALUES ('5h direct gallery upload removed', v_cnt = 0, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM club_photos WHERE id = v_photo_post;
  INSERT INTO t_results VALUES ('5i post-derived photo removed by cascade', v_cnt = 0, 'rows=' || v_cnt);

  -- ══ 6. moderation evidence ═════════════════════════════════
  SELECT reporter_id, reporter_email, reporter_username, content_snapshot
    INTO v_uuid, v_txt, v_txt, v_txt FROM reports WHERE id = v_report_by_a;
  SELECT count(*) INTO v_cnt FROM reports
  WHERE id = v_report_by_a
    AND reporter_id IS NULL AND reporter_email IS NULL AND reporter_username IS NULL
    AND content_snapshot = 'snapshot text' AND reason = 'spam';
  INSERT INTO t_results VALUES ('6a report by A kept, reporter de-identified', v_cnt = 1,
    'matching rows=' || v_cnt);

  SELECT count(*) INTO v_cnt FROM reports
  WHERE id = v_report_on_a AND reporter_id = v_c AND reporter_email = 'test-052-c@example.edu'
    AND content_snapshot = 'evidence about A';
  INSERT INTO t_results VALUES ('6b report ABOUT A kept intact for moderation', v_cnt = 1,
    'matching rows=' || v_cnt);

  -- ══ 7. bystanders and shared data intact ═══════════════════
  SELECT count(*) INTO v_cnt FROM auth.users WHERE id IN (v_b, v_c);
  INSERT INTO t_results VALUES ('7a other users untouched', v_cnt = 2, 'users=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM clubs WHERE id = v_club;
  INSERT INTO t_results VALUES ('7b club survives', v_cnt = 1, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM club_members WHERE club_id = v_club AND user_id = v_b;
  INSERT INTO t_results VALUES ('7c B still a member', v_cnt = 1, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM events WHERE id = v_event;
  INSERT INTO t_results VALUES ('7d B''s event survives', v_cnt = 1, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM posts WHERE id = v_post2;
  INSERT INTO t_results VALUES ('7e B''s post survives', v_cnt = 1, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM conversations WHERE id = v_shared_cnv AND created_by IS NULL;
  INSERT INTO t_results VALUES ('7f shared conversation survives, creator anonymized',
    v_cnt = 1, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM conversation_participants
  WHERE conversation_id = v_shared_cnv AND user_id = v_b;
  INSERT INTO t_results VALUES ('7g B still in the conversation', v_cnt = 1, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM polls WHERE id = v_poll;
  INSERT INTO t_results VALUES ('7h B''s poll survives A''s vote removal', v_cnt = 1, 'rows=' || v_cnt);

  -- ══ 8d. idempotency: a retry is a clean no-op, never a partial ═
  -- The stale claim still resolves to A's uuid, but every statement now
  -- matches zero rows, so the call succeeds and returns empty path lists.
  -- (In production the retry never even reaches here: GoTrue rejects a token
  -- whose user is gone, and the Edge Function returns 401.)
  BEGIN
    SELECT delete_own_account_atomic() INTO v_paths;
    INSERT INTO t_results VALUES ('8d retry is a clean no-op',
      v_paths -> 'avatars' = '[]'::jsonb AND v_paths -> 'posts' = '[]'::jsonb
      AND v_paths -> 'club-photos' = '[]'::jsonb
      AND v_paths -> 'chat-attachments' = '[]'::jsonb,
      v_paths::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t_results VALUES ('8d retry is a clean no-op', false, SQLERRM);
  END;
  SELECT count(*) INTO v_cnt FROM auth.users WHERE id IN (v_b, v_c);
  INSERT INTO t_results VALUES ('8e retry never touched another user', v_cnt = 2, 'users=' || v_cnt);

  -- ══ 9. legacy function retired ═════════════════════════════
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM delete_own_user_data();
    INSERT INTO t_results VALUES ('9a legacy delete_own_user_data hard-fails', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t_results VALUES ('9a legacy delete_own_user_data hard-fails', true, SQLERRM);
  END;
  SELECT count(*) INTO v_cnt FROM profiles WHERE id = v_b;
  INSERT INTO t_results VALUES ('9b legacy call deleted nothing', v_cnt = 1, 'B profile rows=' || v_cnt);

  SELECT has_function_privilege('authenticated', 'public.delete_own_user_data()', 'EXECUTE')
    INTO v_bool;
  INSERT INTO t_results VALUES ('9c authenticated cannot EXECUTE legacy fn', v_bool = false,
    'granted=' || v_bool);
  SELECT has_function_privilege('anon', 'public.delete_own_user_data()', 'EXECUTE') INTO v_bool;
  INSERT INTO t_results VALUES ('9d anon cannot EXECUTE legacy fn', v_bool = false,
    'granted=' || v_bool);

  -- ══ 10. Microsoft-only RPC ungranted ═══════════════════════
  SELECT has_function_privilege('authenticated',
    'public.complete_oauth_onboarding(text,text[],text[])', 'EXECUTE') INTO v_bool;
  INSERT INTO t_results VALUES ('10a complete_oauth_onboarding ungranted', v_bool = false,
    'granted=' || v_bool);

  -- ══ 11. the deletion RPC is still callable by authenticated ═
  SELECT has_function_privilege('authenticated',
    'public.delete_own_account_atomic()', 'EXECUTE') INTO v_bool;
  INSERT INTO t_results VALUES ('11a authenticated can still delete own account', v_bool = true,
    'granted=' || v_bool);
  SELECT has_function_privilege('anon',
    'public.delete_own_account_atomic()', 'EXECUTE') INTO v_bool;
  INSERT INTO t_results VALUES ('11b anon cannot call the deletion RPC', v_bool = false,
    'granted=' || v_bool);
END $$;

SELECT
  count(*) FILTER (WHERE ok)        AS passed,
  count(*) FILTER (WHERE NOT ok)    AS failed,
  count(*)                          AS total
FROM t_results;

SELECT test, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, detail
FROM t_results ORDER BY test;

ROLLBACK;
