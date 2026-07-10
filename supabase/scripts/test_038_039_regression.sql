-- ============================================================
-- Regression tests for migrations 038/039 (run via Management
-- API; everything happens inside one transaction and is rolled
-- back — no production data is touched).
--
-- Covers:
--   1. remove_post_from_club: strips only the target club's tag,
--      preserves the post + other club tags + likes/comments,
--      requires officer auth.
--   2. remove_club_officer: demotes, deletes display row, revokes
--      officers-chat access, notifies; blocks non-officers + self.
--   3. handle_club_join: joiner + broadcast notifications exactly
--      once per genuine join, no dupes on upsert.
--   4. leave_club: sole officer blocked; member leave revokes
--      chat access.
--   5. Event deletion: shared message survives with NULL id.
--   6. Club rename: both conversation names update.
-- ============================================================
BEGIN;

CREATE TEMP TABLE t_results (test text, ok boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  -- fixtures (live ids; transaction rolls back)
  v_clay      UUID := '925e7a84-eb0b-4c98-9460-65ee4667c611'; -- Clay Club (officer: lola21)
  v_stock     UUID := 'e87b15ef-f7d7-444b-990d-6708ea0bef7d'; -- Stock Market Club
  v_lola      UUID := 'c1797f66-df96-45dd-bd73-0b0353fb8be9'; -- officer of clay+stock
  v_marcus    UUID := '00000001-0000-4000-a000-000000000001'; -- member of stock
  v_diego     UUID := '00000004-0000-4000-a000-000000000004'; -- member of clay+stock
  v_post      UUID;
  v_event     UUID;
  v_msg       UUID;
  v_conv      UUID;
  v_officer_conv UUID;
  v_cnt       INT;
  v_txt       TEXT;
  v_res       TEXT;
BEGIN
  -- ── impersonate lola21 (authenticated) ─────────────────────
  -- auth.uid() reads request.jwt.claims; the executing role stays postgres
  -- (SECURITY DEFINER RPCs bypass RLS regardless).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_lola::text, 'role', 'authenticated')::text, true);

  -- ════ 1. remove_post_from_club ═════════════════════════════
  -- diego posts a picture tagged Clay (primary) + Stock (extra)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_diego::text, 'role', 'authenticated')::text, true);
  INSERT INTO posts (author_id, club_id, post_type, image_url, caption)
  VALUES (v_diego, v_clay, 'picture', 'https://example.com/test.jpg', 'test caption')
  RETURNING id INTO v_post;
  INSERT INTO post_club_tags (post_id, club_id) VALUES (v_post, v_stock);
  INSERT INTO post_likes (post_id, user_id) VALUES (v_post, v_diego);
  INSERT INTO post_comments (post_id, user_id, content) VALUES (v_post, v_diego, 'nice');

  SELECT count(*) INTO v_cnt FROM club_photos WHERE post_id = v_post;
  INSERT INTO t_results VALUES ('1a photo rows for both tags', v_cnt = 2, 'rows=' || v_cnt);

  -- a non-officer must NOT be able to remove from Clay
  BEGIN
    PERFORM remove_post_from_club(v_post, v_clay); -- diego is a member, not officer
    INSERT INTO t_results VALUES ('1b non-officer blocked', false, 'no exception raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t_results VALUES ('1b non-officer blocked', SQLERRM LIKE '%not_authorized%', SQLERRM);
  END;

  -- lola (Clay officer) removes it from Clay only
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_lola::text, 'role', 'authenticated')::text, true);
  PERFORM remove_post_from_club(v_post, v_clay);

  SELECT count(*) INTO v_cnt FROM posts WHERE id = v_post;
  INSERT INTO t_results VALUES ('1c post preserved', v_cnt = 1, 'posts=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM posts WHERE id = v_post AND club_id IS NULL;
  INSERT INTO t_results VALUES ('1d primary clay tag cleared', v_cnt = 1, '');
  SELECT count(*) INTO v_cnt FROM post_club_tags WHERE post_id = v_post AND club_id = v_stock;
  INSERT INTO t_results VALUES ('1e stock tag intact', v_cnt = 1, '');
  SELECT count(*) INTO v_cnt FROM club_photos WHERE post_id = v_post AND club_id = v_clay;
  INSERT INTO t_results VALUES ('1f clay photo row gone', v_cnt = 0, '');
  SELECT count(*) INTO v_cnt FROM club_photos WHERE post_id = v_post AND club_id = v_stock;
  INSERT INTO t_results VALUES ('1g stock photo row intact', v_cnt = 1, '');
  SELECT count(*) INTO v_cnt FROM post_likes WHERE post_id = v_post;
  INSERT INTO t_results VALUES ('1h likes preserved', v_cnt = 1, '');
  SELECT count(*) INTO v_cnt FROM post_comments WHERE post_id = v_post;
  INSERT INTO t_results VALUES ('1i comments preserved', v_cnt = 1, '');

  -- 039: delete_club_photo_everywhere must also NOT delete the post
  PERFORM delete_club_photo_everywhere((SELECT id FROM club_photos WHERE post_id = v_post AND club_id = v_stock));
  -- lola is not a stock officer? she IS officer of stock too — fine.
  SELECT count(*) INTO v_cnt FROM posts WHERE id = v_post;
  INSERT INTO t_results VALUES ('1j 039 photo removal keeps post', v_cnt = 1, 'posts=' || v_cnt);

  -- ════ 2. remove_club_officer ═══════════════════════════════
  -- promote diego in Clay via add_club_officer (as lola)
  PERFORM add_club_officer(v_clay, v_diego, 'Treasurer');
  SELECT id INTO v_officer_conv FROM conversations WHERE club_id = v_clay AND type = 'officer_chat';
  SELECT count(*) INTO v_cnt FROM conversation_participants WHERE conversation_id = v_officer_conv AND user_id = v_diego;
  INSERT INTO t_results VALUES ('2a promoted → officers chat', v_cnt = 1, '');
  SELECT count(*) INTO v_cnt FROM club_officers WHERE club_id = v_clay AND user_id = v_diego;
  INSERT INTO t_results VALUES ('2b display row exists', v_cnt = 1, '');

  -- re-adding must not duplicate (idempotent upsert)
  PERFORM add_club_officer(v_clay, v_diego, 'Treasurer');
  SELECT count(*) INTO v_cnt FROM club_officers WHERE club_id = v_clay AND user_id = v_diego;
  INSERT INTO t_results VALUES ('2c re-add no duplicate', v_cnt = 1, 'rows=' || v_cnt);

  -- self-removal blocked
  BEGIN
    PERFORM remove_club_officer(v_clay, v_lola);
    INSERT INTO t_results VALUES ('2d self-removal blocked', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t_results VALUES ('2d self-removal blocked', SQLERRM LIKE '%cannot_remove_self%', SQLERRM);
  END;

  -- remove diego
  PERFORM remove_club_officer(v_clay, v_diego);
  SELECT role INTO v_txt FROM club_members WHERE club_id = v_clay AND user_id = v_diego;
  INSERT INTO t_results VALUES ('2e demoted to member', v_txt = 'member', 'role=' || v_txt);
  SELECT count(*) INTO v_cnt FROM club_officers WHERE club_id = v_clay AND user_id = v_diego;
  INSERT INTO t_results VALUES ('2f display row deleted', v_cnt = 0, '');
  SELECT count(*) INTO v_cnt FROM conversation_participants WHERE conversation_id = v_officer_conv AND user_id = v_diego;
  INSERT INTO t_results VALUES ('2g officers chat revoked', v_cnt = 0, '');
  SELECT count(*) INTO v_cnt FROM notifications WHERE user_id = v_diego AND type = 'officer_removed' AND entity_id = v_clay;
  INSERT INTO t_results VALUES ('2h removal notification', v_cnt = 1, 'rows=' || v_cnt);

  -- non-officer cannot remove
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_marcus::text, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM remove_club_officer(v_clay, v_lola); -- marcus is not in clay
    INSERT INTO t_results VALUES ('2i outsider blocked', false, 'no exception');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO t_results VALUES ('2i outsider blocked', SQLERRM LIKE '%not_authorized%', SQLERRM);
  END;

  -- ════ 3. join notifications ════════════════════════════════
  -- marcus joins Clay (fresh INSERT)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_marcus::text, 'role', 'authenticated')::text, true);
  DELETE FROM notifications WHERE type IN ('club_joined','member_joined') AND entity_id = v_clay; -- clean slate inside txn
  INSERT INTO club_members (club_id, user_id, role) VALUES (v_clay, v_marcus, 'member');

  SELECT count(*) INTO v_cnt FROM notifications WHERE user_id = v_marcus AND type = 'club_joined' AND entity_id = v_clay;
  INSERT INTO t_results VALUES ('3a joiner confirmation', v_cnt = 1, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM notifications WHERE type = 'member_joined' AND entity_id = v_clay AND user_id = v_marcus;
  INSERT INTO t_results VALUES ('3b joiner excluded from broadcast', v_cnt = 0, '');
  SELECT count(*) INTO v_cnt FROM notifications WHERE type = 'member_joined' AND entity_id = v_clay;
  SELECT count(*) - 1 INTO v_txt FROM club_members WHERE club_id = v_clay; -- existing members (all minus joiner)
  INSERT INTO t_results VALUES ('3c broadcast to every existing member',
    v_cnt::text = v_txt, 'broadcast=' || v_cnt || ' expected=' || v_txt);
  -- duplicate recipients impossible (one row per member)
  SELECT count(*) INTO v_cnt FROM (
    SELECT user_id FROM notifications WHERE type = 'member_joined' AND entity_id = v_clay
    GROUP BY user_id HAVING count(*) > 1
  ) d;
  INSERT INTO t_results VALUES ('3d no duplicate recipients', v_cnt = 0, '');

  -- an upsert on the EXISTING membership must not re-notify
  INSERT INTO club_members (club_id, user_id, role) VALUES (v_clay, v_marcus, 'member')
  ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'member';
  SELECT count(*) INTO v_cnt FROM notifications WHERE user_id = v_marcus AND type = 'club_joined' AND entity_id = v_clay;
  INSERT INTO t_results VALUES ('3e re-upsert no dup notification', v_cnt = 1, 'rows=' || v_cnt);

  -- member chat membership granted
  SELECT id INTO v_conv FROM conversations WHERE club_id = v_clay AND type = 'club_group';
  SELECT count(*) INTO v_cnt FROM conversation_participants WHERE conversation_id = v_conv AND user_id = v_marcus;
  INSERT INTO t_results VALUES ('3f member chat granted', v_cnt = 1, '');

  -- ════ 4. leave_club ════════════════════════════════════════
  -- marcus (member) leaves clay → chat revoked
  SELECT leave_club(v_clay) INTO v_res;
  INSERT INTO t_results VALUES ('4a member leave ok', v_res = 'left', 'res=' || v_res);
  SELECT count(*) INTO v_cnt FROM conversation_participants WHERE conversation_id = v_conv AND user_id = v_marcus;
  INSERT INTO t_results VALUES ('4b member chat revoked', v_cnt = 0, '');

  -- lola is the sole officer of clay → blocked
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_lola::text, 'role', 'authenticated')::text, true);
  SELECT leave_club(v_clay) INTO v_res;
  INSERT INTO t_results VALUES ('4c sole officer blocked', v_res = 'blocked_only_officer', 'res=' || v_res);
  SELECT count(*) INTO v_cnt FROM club_members WHERE club_id = v_clay AND user_id = v_lola;
  INSERT INTO t_results VALUES ('4d membership untouched', v_cnt = 1, '');

  -- ════ 5. event deletion preserves shared messages ══════════
  INSERT INTO events (club_id, created_by, title, event_date, start_time, end_time, visibility)
  VALUES (v_clay, v_lola, 'Test event 038', CURRENT_DATE - 7, '10:00', '11:00', 'everyone')
  RETURNING id INTO v_event;
  SELECT c.id INTO v_conv FROM conversations c
    JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = v_lola
    WHERE c.type = 'direct' LIMIT 1;
  IF v_conv IS NULL THEN
    INSERT INTO conversations (type) VALUES ('direct') RETURNING id INTO v_conv;
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conv, v_lola), (v_conv, v_diego);
  END IF;
  INSERT INTO messages (conversation_id, sender_id, message_type, shared_event_id)
  VALUES (v_conv, v_lola, 'shared_event', v_event)
  RETURNING id INTO v_msg;

  DELETE FROM events WHERE id = v_event;
  SELECT count(*) INTO v_cnt FROM messages WHERE id = v_msg;
  INSERT INTO t_results VALUES ('5a shared message survives', v_cnt = 1, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM messages WHERE id = v_msg AND shared_event_id IS NULL;
  INSERT INTO t_results VALUES ('5b shared id nulled', v_cnt = 1, '');
  SELECT count(*) INTO v_cnt FROM notifications WHERE entity_type = 'event' AND entity_id = v_event;
  INSERT INTO t_results VALUES ('5c event notifications purged', v_cnt = 0, '');

  -- ════ 6. club rename syncs conversations ═══════════════════
  UPDATE clubs SET name = 'Renamed Test Club 038' WHERE id = v_clay;
  SELECT count(*) INTO v_cnt FROM conversations
  WHERE club_id = v_clay AND name IN ('Renamed Test Club 038 · Members', 'Renamed Test Club 038 · Officers');
  INSERT INTO t_results VALUES ('6a rename syncs both chats', v_cnt = 2, 'rows=' || v_cnt);
END $$;

SELECT test, ok, detail FROM t_results ORDER BY test;
-- Nothing persists:
ROLLBACK;
