-- Message-tab category-badge + suggestion-bound harness. Run only after a
-- disposable migration reset that includes 076; never run against Production.
-- Everything happens inside one transaction that is ROLLED BACK.
--
-- docker exec -i supabase_db_weglue psql -U postgres -d postgres \
--   -v ON_ERROR_STOP=1 < supabase/scripts/test_076_message_tab_categories.sql

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

-- `ok` is deliberately nullable and NULL counts as a FAILURE. Against a
-- database without 076 the new JSON keys are absent, so every category
-- assertion evaluates to NULL — that must be reported as a named failing
-- check, not crash the harness or quietly pass.
CREATE TEMP TABLE t076_results (name text PRIMARY KEY, ok boolean, detail text);

DO $$
DECLARE
  v_me      UUID := gen_random_uuid();
  v_other   UUID := gen_random_uuid();
  v_club    UUID;
  v_direct  UUID;
  v_group   UUID;
  v_clubcnv UUID;
  v_main    UUID;
  v_events  UUID;
  v_msg     UUID;
  v_json    JSONB;
  v_before  JSONB;
  v_cnt     INT;
  i         INT;
BEGIN
  -- ── fixtures ──────────────────────────────────────────────────────────────
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_me, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-076-me@example.com', 'x', now(),
     '{"username":"test076me","full_name":"Test Me"}'::jsonb, now(), now()),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-076-other@example.com', 'x', now(),
     '{"username":"test076other","full_name":"Test Other"}'::jsonb, now(), now());
  INSERT INTO profiles (id, username, full_name)
  VALUES (v_me, 'test076me', 'Test Me'), (v_other, 'test076other', 'Test Other')
  ON CONFLICT (id) DO NOTHING;

  -- Direct conversation: 3 incoming unread + 1 of my own (must NOT count).
  INSERT INTO conversations (type) VALUES ('direct') RETURNING id INTO v_direct;
  INSERT INTO conversation_participants (conversation_id, user_id, joined_at)
  VALUES (v_direct, v_me, now() - interval '10 days'),
         (v_direct, v_other, now() - interval '10 days');
  INSERT INTO messages (conversation_id, sender_id, content, created_at)
  SELECT v_direct, v_other, 'dm ' || g, now() - interval '1 hour' + (g * interval '1 minute')
    FROM generate_series(1, 3) g;
  INSERT INTO messages (conversation_id, sender_id, content, created_at)
  VALUES (v_direct, v_me, 'my own reply', now());

  -- Custom group: 2 incoming unread.
  INSERT INTO conversations (type, name, created_by) VALUES ('group', 'T076 Group', v_other)
  RETURNING id INTO v_group;
  INSERT INTO conversation_participants (conversation_id, user_id, joined_at, last_read_at)
  VALUES (v_group, v_me, now() - interval '10 days', now() - interval '2 hours'),
         (v_group, v_other, now() - interval '10 days', now());
  INSERT INTO messages (conversation_id, sender_id, content, created_at)
  SELECT v_group, v_other, 'grp ' || g, now() - interval '1 hour' + (g * interval '1 minute')
    FROM generate_series(1, 2) g;

  -- Club chat with TWO channels: 4 unread in Main, 1 unread in #events.
  -- Reading Main must never clear #events (per-channel read state).
  INSERT INTO clubs (name, handle, description)
  VALUES ('T076 Club', 't076club', 'harness club') RETURNING id INTO v_club;
  INSERT INTO conversations (type, club_id, name) VALUES ('club_group', v_club, 'T076 Club')
  RETURNING id INTO v_clubcnv;
  INSERT INTO conversation_participants (conversation_id, user_id, joined_at)
  VALUES (v_clubcnv, v_me, now() - interval '10 days'),
         (v_clubcnv, v_other, now() - interval '10 days');
  INSERT INTO conversation_channels (conversation_id, name, display_order)
  VALUES (v_clubcnv, 'Main chat', 0) RETURNING id INTO v_main;
  INSERT INTO conversation_channels (conversation_id, name, display_order)
  VALUES (v_clubcnv, 'events', 1) RETURNING id INTO v_events;
  INSERT INTO messages (conversation_id, channel_id, sender_id, content, created_at)
  SELECT v_clubcnv, v_main, v_other, 'main ' || g, now() - interval '1 hour' + (g * interval '1 minute')
    FROM generate_series(1, 4) g;
  INSERT INTO messages (conversation_id, channel_id, sender_id, content, created_at)
  VALUES (v_clubcnv, v_events, v_other, 'events 1', now());

  -- ════ 1. category totals ══════════════════════════════════════════════════
  v_json := get_unread_summary_for(v_me);

  INSERT INTO t076_results VALUES ('1a Single counts DM messages, not threads',
    (v_json->>'unread_direct_messages')::int = 3,
    'got=' || COALESCE(v_json->>'unread_direct_messages', 'NULL'));

  INSERT INTO t076_results VALUES ('1b Groups counts custom-group + every club channel',
    (v_json->>'unread_group_messages')::int = 7,
    'got=' || COALESCE(v_json->>'unread_group_messages', 'NULL'));

  INSERT INTO t076_results VALUES ('1c badge total equals Single + Groups',
    (v_json->>'unread_direct_messages')::int + (v_json->>'unread_group_messages')::int = 10,
    'sum=' || ((v_json->>'unread_direct_messages')::int + (v_json->>'unread_group_messages')::int));

  -- The pre-existing key must keep its OLD thread meaning: 1 DM + 1 group +
  -- 2 club channels = 4 threads, NOT 10 messages. The push worker depends on it.
  INSERT INTO t076_results VALUES ('1d unread_threads still counts threads',
    (v_json->>'unread_threads')::int = 4,
    'got=' || COALESCE(v_json->>'unread_threads', 'NULL'));

  -- ════ 2. read state moves the right category only ═════════════════════════
  v_before := v_json;
  UPDATE conversation_participants SET last_read_at = now() + interval '1 minute'
   WHERE conversation_id = v_direct AND user_id = v_me;
  v_json := get_unread_summary_for(v_me);
  INSERT INTO t076_results VALUES ('2a reading the DM clears Single only',
    (v_json->>'unread_direct_messages')::int = 0
    AND (v_json->>'unread_group_messages')::int = (v_before->>'unread_group_messages')::int,
    'single=' || (v_json->>'unread_direct_messages') || ' groups=' || (v_json->>'unread_group_messages'));

  INSERT INTO channel_reads (channel_id, user_id, last_read_at)
  VALUES (v_main, v_me, now() + interval '1 minute');
  v_json := get_unread_summary_for(v_me);
  INSERT INTO t076_results VALUES ('2b reading Main leaves #events unread',
    (v_json->>'unread_group_messages')::int = 3,
    'got=' || COALESCE(v_json->>'unread_group_messages', 'NULL'));

  -- ════ 3. exclusions mirror the thread rules ═══════════════════════════════
  SELECT id INTO v_msg FROM messages
   WHERE conversation_id = v_group AND sender_id = v_other ORDER BY created_at LIMIT 1;
  INSERT INTO message_hides (message_id, user_id) VALUES (v_msg, v_me);
  v_json := get_unread_summary_for(v_me);
  INSERT INTO t076_results VALUES ('3a delete-for-me is excluded',
    (v_json->>'unread_group_messages')::int = 2,
    'got=' || COALESCE(v_json->>'unread_group_messages', 'NULL'));

  -- 067 keeps deleted_at and deletion_kind consistent; set both, as the
  -- unsend path does, or the lifecycle CHECK rejects the row.
  UPDATE messages SET deleted_at = now(), deletion_kind = 'sender_deleted'
   WHERE conversation_id = v_clubcnv AND channel_id = v_events;
  v_json := get_unread_summary_for(v_me);
  INSERT INTO t076_results VALUES ('3b delete-for-everyone is excluded',
    (v_json->>'unread_group_messages')::int = 1,
    'got=' || COALESCE(v_json->>'unread_group_messages', 'NULL'));

  UPDATE conversation_participants SET hidden_at = now()
   WHERE conversation_id = v_group AND user_id = v_me;
  v_json := get_unread_summary_for(v_me);
  INSERT INTO t076_results VALUES ('3c hidden participation is excluded',
    (v_json->>'unread_group_messages')::int = 0,
    'got=' || COALESCE(v_json->>'unread_group_messages', 'NULL'));

  INSERT INTO t076_results VALUES ('3d null caller returns a zeroed payload',
    (get_unread_summary_for(NULL)->>'unread_direct_messages')::int = 0
    AND (get_unread_summary_for(NULL)->>'unread_group_messages')::int = 0,
    '');

  -- ════ 4. suggestion bound ═════════════════════════════════════════════════
  -- Twelve extra eligible accounts so a 10-row request is genuinely satisfiable.
  FOR i IN 1..12 LOOP
    DECLARE v_extra UUID := gen_random_uuid();
    BEGIN
      INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                              email_confirmed_at, raw_user_meta_data, created_at, updated_at)
      VALUES (v_extra, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              'test-076-extra-' || i || '@example.com', 'x', now(),
              jsonb_build_object('username', 'test076x' || i, 'full_name', 'Extra ' || i),
              now(), now());
      INSERT INTO profiles (id, username, full_name)
      VALUES (v_extra, 'test076x' || i, 'Extra ' || i) ON CONFLICT (id) DO NOTHING;
    END;
  END LOOP;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_me::text, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_cnt FROM get_message_suggestions(10);
  INSERT INTO t076_results VALUES ('4a ten suggestions are returned',
    v_cnt = 10, 'got=' || v_cnt);

  SELECT count(*) INTO v_cnt FROM get_message_suggestions();
  INSERT INTO t076_results VALUES ('4b default request also returns ten',
    v_cnt = 10, 'got=' || v_cnt);

  -- Still bounded: an oversized request cannot dump the directory.
  SELECT count(*) INTO v_cnt FROM get_message_suggestions(500);
  INSERT INTO t076_results VALUES ('4c oversized request stays clamped',
    v_cnt <= 20, 'got=' || v_cnt);

  SELECT count(*) INTO v_cnt FROM get_message_suggestions(10) s WHERE s.user_id = v_me;
  INSERT INTO t076_results VALUES ('4d caller never suggests themselves',
    v_cnt = 0, 'got=' || v_cnt);

  -- A blocked account must stay out of the larger result set too.
  PERFORM block_user(v_other);
  SELECT count(*) INTO v_cnt FROM get_message_suggestions(20) s WHERE s.user_id = v_other;
  INSERT INTO t076_results VALUES ('4e blocked accounts stay excluded at the higher bound',
    v_cnt = 0, 'got=' || v_cnt);

  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(name || ' [' || COALESCE(detail, '') || ']', '; ')
    INTO v_bad FROM t076_results WHERE ok IS NOT TRUE;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '076 message-tab harness failed: %', v_bad;
  END IF;
END;
$$;

SELECT count(*) FILTER (WHERE ok IS TRUE) AS passed,
       count(*) FILTER (WHERE ok IS NOT TRUE) AS failed,
       count(*) AS total
  FROM t076_results;

ROLLBACK;
