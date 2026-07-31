-- ===========================================================================
-- Test harness — migration 056 (atomic admin mutation + audit)
--
-- HOW TO RUN (throwaway database, NEVER production):
--
--   docker run -d --name wg-audit-test -e POSTGRES_PASSWORD=test -p 55433:5432 postgres:15
--   docker exec -i wg-audit-test psql -U postgres -d postgres <<'EOF'
--     CREATE ROLE pgowner LOGIN PASSWORD 'test' NOSUPERUSER BYPASSRLS CREATEROLE;
--     CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
--     CREATE ROLE service_role NOLOGIN BYPASSRLS;
--     GRANT anon, authenticated, service_role TO pgowner;
--     CREATE DATABASE wg2 OWNER pgowner;
--   EOF
--   docker exec -i wg-audit-test psql -U pgowner -d wg2 -c \
--     "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;"
--   for f in supabase/scripts/test_056_fixture_schema.sql \
--            supabase/migrations/054_atomic_last_officer_protection.sql \
--            supabase/migrations/055_durable_admin_audit.sql \
--            supabase/migrations/056_atomic_admin_mutations.sql; do
--     docker exec -i wg-audit-test psql -U pgowner -d wg2 -v ON_ERROR_STOP=1 -q < $f
--   done
--   docker exec -i wg-audit-test psql -U pgowner -d wg2 -q < \
--     supabase/scripts/test_056_atomic_admin_mutations.sql
--
-- THE CENTRAL CLAIM UNDER TEST:
--     an audit row exists  ⇔  the mutation committed
-- in BOTH directions, for every database-only administrator mutation.
-- ===========================================================================

\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE TABLE IF NOT EXISTS t_counter (passed int NOT NULL);
DELETE FROM t_counter; INSERT INTO t_counter VALUES (0);
GRANT SELECT, UPDATE ON t_counter TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION t_assert(cond boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN
    RAISE NOTICE 'PASS  %', label;
    UPDATE t_counter SET passed = passed + 1;
  ELSE
    RAISE EXCEPTION 'FAIL  %', label;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION t_denied(sql text, label text, expect text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN others THEN
    msg := SQLERRM;
    IF expect IS NOT NULL AND position(lower(expect) IN lower(msg)) = 0 THEN
      RAISE EXCEPTION 'FAIL  % — wrong error: %', label, msg;
    END IF;
    RAISE NOTICE 'PASS  %  [%]', label, left(replace(msg, E'\n', ' '), 66);
    UPDATE t_counter SET passed = passed + 1;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL  % — statement SUCCEEDED but should have been denied', label;
END $$;

-- Fixed ids.
\set FOUNDER '''94387196-0000-4000-8000-000000000001'''
\set UNI     '''174a1779-0000-4000-8000-000000000002'''
\set CLUB    '''22222222-0000-4000-8000-000000000003'''
\set UA      '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set UB      '''bbbbbbbb-0000-4000-8000-00000000000b'''
\set UC      '''cccccccc-0000-4000-8000-00000000000c'''
\set POST    '''dddddddd-0000-4000-8000-00000000000d'''
\set EVENT   '''eeeeeeee-0000-4000-8000-00000000000e'''
\set CONV    '''ffffffff-0000-4000-8000-00000000000f'''
\set CHAN    '''11111111-0000-4000-8000-000000000011'''
\set NOTIF   '''22222222-0000-4000-8000-000000000022'''
\set REPORT  '''33333333-0000-4000-8000-000000000033'''
\set COMMENT '''44444444-0000-4000-8000-000000000044'''

-- Canonical fixture. A/B are officers (so demoting ONE is allowed by the 054
-- floor), C is an ordinary member.
-- SECURITY DEFINER so the fixture can suspend the 054 triggers even when the
-- harness is currently running as service_role (which is not the table owner).
CREATE OR REPLACE FUNCTION fixture_reset() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Migration 054's floor triggers are suspended for the TEARDOWN ONLY: tearing
  -- a fixture down legitimately trips the last-officer rule. Every assertion
  -- below runs with them live — 4.2 proves the floor still fires.
  ALTER TABLE club_members DISABLE TRIGGER trg_club_officer_floor_delete;
  ALTER TABLE club_members DISABLE TRIGGER trg_club_officer_floor_update;

  DELETE FROM event_rsvps; DELETE FROM post_club_tags; DELETE FROM club_photos;
  DELETE FROM post_comments; DELETE FROM posts; DELETE FROM events;
  DELETE FROM messages; DELETE FROM conversation_channels; DELETE FROM conversations;
  DELETE FROM notifications; DELETE FROM reports; DELETE FROM follows;
  DELETE FROM club_officers; DELETE FROM club_members; DELETE FROM clubs;
  DELETE FROM app_config; DELETE FROM profiles; DELETE FROM universities;

  INSERT INTO universities (id, name, slug, is_active)
  VALUES ('174a1779-0000-4000-8000-000000000002', 'Lone Star College', 'lone-star-college', true);

  INSERT INTO profiles (id, username, full_name, university_id) VALUES
    ('aaaaaaaa-0000-4000-8000-00000000000a', 'ann', 'Ann A', '174a1779-0000-4000-8000-000000000002'),
    ('bbbbbbbb-0000-4000-8000-00000000000b', 'bob', 'Bob B', '174a1779-0000-4000-8000-000000000002'),
    ('cccccccc-0000-4000-8000-00000000000c', 'cy',  'Cy C',  '174a1779-0000-4000-8000-000000000002');

  INSERT INTO clubs (id, name, handle, university_id, is_active)
  VALUES ('22222222-0000-4000-8000-000000000003', 'Chess Club', 'chess', '174a1779-0000-4000-8000-000000000002', true);

  INSERT INTO club_members (club_id, user_id, role) VALUES
    ('22222222-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-00000000000a', 'officer'),
    ('22222222-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-00000000000b', 'officer'),
    ('22222222-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-00000000000c', 'member');

  INSERT INTO club_officers (club_id, user_id, role_title) VALUES
    ('22222222-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-00000000000a', 'President'),
    ('22222222-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-00000000000b', 'Treasurer');

  INSERT INTO follows (follower_id, following_id, status) VALUES
    ('aaaaaaaa-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-00000000000b', 'accepted'),
    ('bbbbbbbb-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-00000000000a', 'accepted');

  INSERT INTO events (id, club_id, created_by, title, event_date, visibility)
  VALUES ('eeeeeeee-0000-4000-8000-00000000000e', '22222222-0000-4000-8000-000000000003',
          'aaaaaaaa-0000-4000-8000-00000000000a', 'Tournament', '2026-09-01', 'club');

  INSERT INTO posts (id, author_id, club_id, caption)
  VALUES ('dddddddd-0000-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-00000000000a',
          '22222222-0000-4000-8000-000000000003', 'original caption');
  INSERT INTO post_club_tags (post_id, club_id)
  VALUES ('dddddddd-0000-4000-8000-00000000000d', '22222222-0000-4000-8000-000000000003');
  INSERT INTO club_photos (club_id, post_id, url)
  VALUES ('22222222-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-00000000000d', 'https://x/p.jpg');

  INSERT INTO post_comments (id, post_id, user_id, content)
  VALUES ('44444444-0000-4000-8000-000000000044', 'dddddddd-0000-4000-8000-00000000000d',
          'cccccccc-0000-4000-8000-00000000000c', 'original comment');

  INSERT INTO event_rsvps (event_id, user_id, status)
  VALUES ('eeeeeeee-0000-4000-8000-00000000000e', 'cccccccc-0000-4000-8000-00000000000c', 'going');

  INSERT INTO conversations (id, type, club_id, name)
  VALUES ('ffffffff-0000-4000-8000-00000000000f', 'club', '22222222-0000-4000-8000-000000000003', 'Members');
  INSERT INTO conversation_channels (id, conversation_id, name, kind, display_order)
  VALUES ('11111111-0000-4000-8000-000000000011', 'ffffffff-0000-4000-8000-00000000000f', 'General', 'topic', 1);

  INSERT INTO notifications (id, user_id, type, read)
  VALUES ('22222222-0000-4000-8000-000000000022', 'cccccccc-0000-4000-8000-00000000000c', 'club_post', false);

  INSERT INTO reports (id, reporter_id, entity_type, entity_id, status)
  VALUES ('33333333-0000-4000-8000-000000000033', 'cccccccc-0000-4000-8000-00000000000c',
          'post', 'dddddddd-0000-4000-8000-00000000000d', 'pending');

  ALTER TABLE club_members ENABLE TRIGGER trg_club_officer_floor_delete;
  ALTER TABLE club_members ENABLE TRIGGER trg_club_officer_floor_update;

  -- NOTE: the audit trail is deliberately NOT cleared here. It CANNOT be —
  -- admin_audit_events is append-only, and an attempt would raise. Critically,
  -- catching that exception would roll back this ENTIRE function body (plpgsql
  -- rolls a block back to its start when an exception is handled), silently
  -- leaving the fixture unseeded and making every assertion below vacuous.
  -- So: every assertion scopes its audit query by correlation_id instead of
  -- assuming an empty table.
END $$;

-- Count audit rows for one action since a marker time.
CREATE OR REPLACE FUNCTION t_audit_count(p_action text, p_type text DEFAULT NULL)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM admin_audit_events
   WHERE action = p_action AND (p_type IS NULL OR event_type = p_type);
$$;

CREATE OR REPLACE FUNCTION t_last_audit(p_action text) RETURNS admin_audit_events
LANGUAGE sql STABLE AS $$
  SELECT * FROM admin_audit_events WHERE action = p_action ORDER BY occurred_at DESC, id DESC LIMIT 1;
$$;


-- ===========================================================================
-- GROUP 1 — Privileges: only the server may reach these functions
-- ===========================================================================
SELECT t_assert(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_tx\_%') = 22,
  '1.1  all 22 atomic mutation RPCs exist'
);

SET ROLE anon;
SELECT t_denied($$SELECT public.admin_tx_membership_add(
  '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app',NULL,gen_random_uuid(),
  '22222222-0000-4000-8000-000000000003'::uuid,'cccccccc-0000-4000-8000-00000000000c'::uuid)$$,
  '1.2  anon cannot EXECUTE an atomic mutation RPC', 'permission denied');
RESET ROLE;

SET ROLE authenticated;
SELECT t_denied($$SELECT public.admin_tx_club_reactivate(
  '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','x',gen_random_uuid(),
  '22222222-0000-4000-8000-000000000003'::uuid)$$,
  '1.3  founder browser session cannot EXECUTE an atomic mutation RPC', 'permission denied');
RESET ROLE;

SELECT t_assert(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_tx\_%'
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')) = 22,
  '1.4  service_role can execute all 22 (the server path)'
);
SELECT t_assert(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_tx\_%'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))) = 0,
  '1.5  NO atomic mutation RPC is reachable by anon or authenticated'
);


-- ===========================================================================
-- GROUP 2 — Success: mutation and audit commit TOGETHER
-- ===========================================================================
SELECT fixture_reset();
SET ROLE service_role;

-- 2.1 membership.add
DO $$
DECLARE r JSONB; corr UUID := gen_random_uuid();
BEGIN
  DELETE FROM club_members WHERE club_id = '22222222-0000-4000-8000-000000000003'
    AND user_id = 'cccccccc-0000-4000-8000-00000000000c';
  r := public.admin_tx_membership_add(
        '94387196-0000-4000-8000-000000000001','founder@weglue.app', NULL, corr,
        '22222222-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-00000000000c');
  PERFORM t_assert(r ->> 'status' = 'ok', '2.1a membership.add succeeds');
  PERFORM t_assert(EXISTS (SELECT 1 FROM club_members WHERE club_id='22222222-0000-4000-8000-000000000003'
                             AND user_id='cccccccc-0000-4000-8000-00000000000c'),
                   '2.1b the membership row exists');
  PERFORM t_assert(EXISTS (SELECT 1 FROM admin_audit_events WHERE correlation_id = corr
                             AND action='membership.add' AND event_type='success'),
                   '2.1c a success audit row committed WITH it, same correlation id');
END $$;

-- 2.2 officer.demote — before/after must reflect the REAL canonical rows
DO $$
DECLARE r JSONB; corr UUID := gen_random_uuid(); ev admin_audit_events;
BEGIN
  r := public.admin_tx_member_role_set(
        '94387196-0000-4000-8000-000000000001','founder@weglue.app',
        'Stepping down at the end of term.', corr,
        '22222222-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-00000000000b','member');
  PERFORM t_assert(r ->> 'status' = 'ok', '2.2a officer.demote succeeds (two officers, floor satisfied)');

  SELECT * INTO ev FROM admin_audit_events WHERE correlation_id = corr;
  PERFORM t_assert(ev.action = 'officer.demote', '2.2b action derived from the role, not the caller');
  PERFORM t_assert(ev.before_state ->> 'role' = 'officer', '2.2c before_state reflects the ACTUAL prior row');
  PERFORM t_assert(ev.after_state  ->> 'role' = 'member',  '2.2d after_state reflects the COMMITTED row');
  PERFORM t_assert(ev.reason = 'Stepping down at the end of term.', '2.2e the submitted reason is in the audit record');
  PERFORM t_assert((SELECT role FROM club_members WHERE club_id='22222222-0000-4000-8000-000000000003'
                      AND user_id='bbbbbbbb-0000-4000-8000-00000000000b') = 'member',
                   '2.2f the canonical row really changed');
END $$;

-- 2.3 the remaining mutations, each: status ok + canonical change + audit row
SELECT fixture_reset();
DO $$
DECLARE r JSONB; corr UUID;
BEGIN
  corr := gen_random_uuid();
  r := public.admin_tx_officer_title_set('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        '22222222-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a','Vice President');
  PERFORM t_assert(r->>'status'='ok' AND (SELECT role_title FROM club_officers
      WHERE club_id='22222222-0000-4000-8000-000000000003' AND user_id='aaaaaaaa-0000-4000-8000-00000000000a')='Vice President'
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3a officer.editTitle — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_gluemate_remove('94387196-0000-4000-8000-000000000001','f@w.app','Harassment report 118.',corr,
        'aaaaaaaa-0000-4000-8000-00000000000a','bbbbbbbb-0000-4000-8000-00000000000b');
  PERFORM t_assert(r->>'status'='ok' AND NOT EXISTS(SELECT 1 FROM follows)
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3b gluemate.remove — BOTH follow directions gone, audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_post_caption_set('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        'dddddddd-0000-4000-8000-00000000000d','edited caption');
  PERFORM t_assert(r->>'status'='ok' AND (SELECT caption FROM posts WHERE id='dddddddd-0000-4000-8000-00000000000d')='edited caption'
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3c post.editCaption — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_comment_content_set('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        '44444444-0000-4000-8000-000000000044','moderated comment');
  PERFORM t_assert(r->>'status'='ok' AND (SELECT content FROM post_comments WHERE id='44444444-0000-4000-8000-000000000044')='moderated comment'
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3d comment.editContent — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_event_edit('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        'eeeeeeee-0000-4000-8000-00000000000e','{"title":"Autumn Tournament","location":"Hall B"}'::jsonb);
  PERFORM t_assert(r->>'status'='ok' AND (SELECT title FROM events WHERE id='eeeeeeee-0000-4000-8000-00000000000e')='Autumn Tournament'
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3e event.edit — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_rsvp_upsert('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        'eeeeeeee-0000-4000-8000-00000000000e','aaaaaaaa-0000-4000-8000-00000000000a','going');
  PERFORM t_assert(r->>'status'='ok' AND EXISTS(SELECT 1 FROM event_rsvps WHERE user_id='aaaaaaaa-0000-4000-8000-00000000000a')
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3f rsvp.upsert — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_rsvp_remove('94387196-0000-4000-8000-000000000001','f@w.app','Duplicate entry.',corr,
        'eeeeeeee-0000-4000-8000-00000000000e','cccccccc-0000-4000-8000-00000000000c');
  PERFORM t_assert(r->>'status'='ok' AND NOT EXISTS(SELECT 1 FROM event_rsvps WHERE user_id='cccccccc-0000-4000-8000-00000000000c')
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3g rsvp.remove — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_channel_create('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        'ffffffff-0000-4000-8000-00000000000f','Announcements');
  PERFORM t_assert(r->>'status'='ok' AND EXISTS(SELECT 1 FROM conversation_channels WHERE name='Announcements')
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3h channel.create — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_channel_rename('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        '11111111-0000-4000-8000-000000000011','Renamed');
  PERFORM t_assert(r->>'status'='ok' AND (SELECT name FROM conversation_channels WHERE id='11111111-0000-4000-8000-000000000011')='Renamed'
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3i channel.rename — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_channel_set_permission('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        '11111111-0000-4000-8000-000000000011','officers');
  PERFORM t_assert(r->>'status'='ok' AND (SELECT post_permission FROM conversation_channels WHERE id='11111111-0000-4000-8000-000000000011')='officers'
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3j channel.setPermission — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_channel_delete_empty('94387196-0000-4000-8000-000000000001','f@w.app','Created by mistake.',corr,
        '11111111-0000-4000-8000-000000000011');
  PERFORM t_assert(r->>'status'='ok' AND NOT EXISTS(SELECT 1 FROM conversation_channels WHERE id='11111111-0000-4000-8000-000000000011')
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3k channel.deleteEmpty — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_notification_set_read('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        '22222222-0000-4000-8000-000000000022', true);
  PERFORM t_assert(r->>'status'='ok' AND (SELECT read FROM notifications WHERE id='22222222-0000-4000-8000-000000000022')
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3l notification.setRead — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_report_set_status('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        '33333333-0000-4000-8000-000000000033','reviewing');
  PERFORM t_assert(r->>'status'='ok' AND (SELECT status FROM reports WHERE id='33333333-0000-4000-8000-000000000033')='reviewing'
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3m report.setStatus — mutation + audit committed together');

  UPDATE clubs SET is_active = false WHERE id='22222222-0000-4000-8000-000000000003';
  corr := gen_random_uuid();
  r := public.admin_tx_club_reactivate('94387196-0000-4000-8000-000000000001','f@w.app','Appeal upheld.',corr,
        '22222222-0000-4000-8000-000000000003');
  PERFORM t_assert(r->>'status'='ok' AND (SELECT is_active FROM clubs WHERE id='22222222-0000-4000-8000-000000000003')
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3n deletedContent.reactivateClub — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_university_edit('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        '174a1779-0000-4000-8000-000000000002','Lone Star College North',NULL);
  PERFORM t_assert(r->>'status'='ok' AND (SELECT name FROM universities WHERE id='174a1779-0000-4000-8000-000000000002')='Lone Star College North'
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3o university.edit — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_university_set_active('94387196-0000-4000-8000-000000000001','f@w.app','Campus closed.',corr,
        '174a1779-0000-4000-8000-000000000002', false);
  PERFORM t_assert(r->>'status'='ok' AND NOT (SELECT is_active FROM universities WHERE id='174a1779-0000-4000-8000-000000000002')
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3p university.setActive — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_university_add('94387196-0000-4000-8000-000000000001','f@w.app','Second campus approved.',corr,
        'North Campus','north-campus');
  PERFORM t_assert(r->>'status'='ok' AND EXISTS(SELECT 1 FROM universities WHERE slug='north-campus')
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3q university.add — mutation + audit committed together');

  corr := gen_random_uuid();
  r := public.admin_tx_officer_add('94387196-0000-4000-8000-000000000001','f@w.app',NULL,corr,
        '22222222-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-00000000000c','Secretary');
  PERFORM t_assert(r->>'status'='ok'
      AND (SELECT role FROM club_members WHERE club_id='22222222-0000-4000-8000-000000000003' AND user_id='cccccccc-0000-4000-8000-00000000000c')='officer'
      AND EXISTS(SELECT 1 FROM club_officers WHERE user_id='cccccccc-0000-4000-8000-00000000000c')
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3r officer.add — authority row AND roster row, both with the audit');

  corr := gen_random_uuid();
  r := public.admin_tx_membership_remove('94387196-0000-4000-8000-000000000001','f@w.app','Left the college.',corr,
        '22222222-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-00000000000c');
  PERFORM t_assert(r->>'status'='ok'
      AND NOT EXISTS(SELECT 1 FROM club_members WHERE club_id='22222222-0000-4000-8000-000000000003' AND user_id='cccccccc-0000-4000-8000-00000000000c')
      AND EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '2.3s membership.remove — mutation + audit committed together');
END $$;

-- post.removeFromClub touches THREE tables; none may be left half-done.
SELECT fixture_reset();
DO $$
DECLARE r JSONB; corr UUID := gen_random_uuid();
BEGIN
  r := public.admin_tx_post_remove_from_club('94387196-0000-4000-8000-000000000001','f@w.app',
        'Off-topic for this club.', corr,
        'dddddddd-0000-4000-8000-00000000000d','22222222-0000-4000-8000-000000000003');
  PERFORM t_assert(r->>'status'='ok', '2.4a post.removeFromClub succeeds');
  PERFORM t_assert((SELECT club_id FROM posts WHERE id='dddddddd-0000-4000-8000-00000000000d') IS NULL,
                   '2.4b the primary club tag is cleared');
  PERFORM t_assert(NOT EXISTS(SELECT 1 FROM post_club_tags WHERE post_id='dddddddd-0000-4000-8000-00000000000d'),
                   '2.4c the extra tag row is gone');
  PERFORM t_assert(NOT EXISTS(SELECT 1 FROM club_photos WHERE post_id='dddddddd-0000-4000-8000-00000000000d'),
                   '2.4d the club Glue-photo entry is gone — NO partial relationship remains');
  PERFORM t_assert(EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
                   '2.4e all three table changes committed with ONE audit row');
END $$;
RESET ROLE;


-- ===========================================================================
-- GROUP 3 — Forced audit failure ROLLS BACK the mutation
-- ===========================================================================
-- This is the property migration 055 alone could not provide. Each case forces
-- the audit INSERT to raise and then proves the canonical row is unchanged.
SELECT fixture_reset();
SET ROLE service_role;

-- 3.1 A destructive action with NO reason: the 055 trigger raises.
DO $$
DECLARE ok BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.admin_tx_membership_remove(
      '94387196-0000-4000-8000-000000000001','f@w.app', NULL, gen_random_uuid(),
      '22222222-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-00000000000c');
  EXCEPTION WHEN others THEN ok := TRUE;
  END;
  PERFORM t_assert(ok, '3.1a a destructive mutation with no reason RAISES');
  PERFORM t_assert(EXISTS (SELECT 1 FROM club_members
      WHERE club_id='22222222-0000-4000-8000-000000000003' AND user_id='cccccccc-0000-4000-8000-00000000000c'),
    '3.1b THE MEMBERSHIP STILL EXISTS — the mutation was rolled back by the audit failure');
END $$;

DO $$
DECLARE ok BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.admin_tx_rsvp_remove('94387196-0000-4000-8000-000000000001','f@w.app','   ',gen_random_uuid(),
      'eeeeeeee-0000-4000-8000-00000000000e','cccccccc-0000-4000-8000-00000000000c');
  EXCEPTION WHEN others THEN ok := TRUE;
  END;
  PERFORM t_assert(ok, '3.2a a whitespace-only reason RAISES');
  PERFORM t_assert(EXISTS (SELECT 1 FROM event_rsvps WHERE user_id='cccccccc-0000-4000-8000-00000000000c'),
    '3.2b THE RSVP STILL EXISTS — rolled back');
END $$;

DO $$
DECLARE ok BOOLEAN := FALSE;
BEGIN
  -- Deactivate first, so the call reaches the audit write instead of being
  -- short-circuited by the 'already_active' business rejection.
  UPDATE clubs SET is_active = false WHERE id = '22222222-0000-4000-8000-000000000003';
  BEGIN
    PERFORM public.admin_tx_club_reactivate('94387196-0000-4000-8000-000000000001','f@w.app',
      repeat('x', 600), gen_random_uuid(), '22222222-0000-4000-8000-000000000003');
  EXCEPTION WHEN others THEN ok := TRUE;
  END;
  PERFORM t_assert(ok, '3.3a an over-limit reason RAISES (500-char cap)');
  PERFORM t_assert(NOT (SELECT is_active FROM clubs WHERE id = '22222222-0000-4000-8000-000000000003'),
    '3.3b THE CLUB IS STILL INACTIVE — rolled back');
END $$;

-- 3.4 An audit payload that the TABLE refuses must also roll the mutation back.
--     Forced with ordinary writes only: an oversized event description makes
--     before_state exceed the 16 KB cap, so the audit INSERT violates its CHECK.
DO $$
DECLARE ok BOOLEAN := FALSE; before_title TEXT;
BEGIN
  UPDATE events SET description = repeat('x', 20000) WHERE id='eeeeeeee-0000-4000-8000-00000000000e';
  SELECT title INTO before_title FROM events WHERE id='eeeeeeee-0000-4000-8000-00000000000e';

  BEGIN
    PERFORM public.admin_tx_event_edit('94387196-0000-4000-8000-000000000001','f@w.app',NULL,gen_random_uuid(),
      'eeeeeeee-0000-4000-8000-00000000000e','{"title":"Should Not Persist"}'::jsonb);
  EXCEPTION WHEN others THEN ok := TRUE;
  END;

  PERFORM t_assert(ok, '3.4a an audit payload the table refuses RAISES');
  PERFORM t_assert((SELECT title FROM events WHERE id='eeeeeeee-0000-4000-8000-00000000000e') = before_title,
    '3.4b THE EVENT TITLE IS UNCHANGED — the mutation rolled back with the audit');
  PERFORM t_assert(before_title = 'Tournament',
    '3.4c (control) the title really was the fixture value, so 3.4b is not vacuous');
END $$;
RESET ROLE;


-- ===========================================================================
-- GROUP 4 — Business rejection: no mutation, durable FAILURE record
-- ===========================================================================
SELECT fixture_reset();
SET ROLE service_role;

DO $$
DECLARE r JSONB; corr UUID := gen_random_uuid();
BEGIN
  r := public.admin_tx_membership_remove('94387196-0000-4000-8000-000000000001','f@w.app','Cleanup.',corr,
        '22222222-0000-4000-8000-000000000003','94387196-0000-4000-8000-000000000001');
  PERFORM t_assert(r->>'status' = 'not_member', '4.1a a non-member removal is rejected');
  PERFORM t_assert(EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='failure'
                            AND error_code='not_member'),
    '4.1b a durable FAILURE record is committed');
  PERFORM t_assert(NOT EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='success'),
    '4.1c and NO success record exists for it');
  PERFORM t_assert((SELECT count(*) FROM club_members WHERE club_id='22222222-0000-4000-8000-000000000003') = 3,
    '4.1d no membership was changed');
END $$;

-- 4.2 Migration 054's last-officer floor still governs, through the new layer.
DO $$
DECLARE r JSONB; corr UUID := gen_random_uuid();
BEGIN
  -- Demote B first so A is the ONLY officer.
  PERFORM public.admin_tx_member_role_set('94387196-0000-4000-8000-000000000001','f@w.app','Term ended.',gen_random_uuid(),
    '22222222-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-00000000000b','member');

  r := public.admin_tx_member_role_set('94387196-0000-4000-8000-000000000001','f@w.app','Term ended.',corr,
        '22222222-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a','member');

  PERFORM t_assert(r->>'status' = 'last_officer',
    '4.2a MIGRATION 054 last-officer protection still fires through the atomic layer');
  PERFORM t_assert((SELECT role FROM club_members WHERE club_id='22222222-0000-4000-8000-000000000003'
                      AND user_id='aaaaaaaa-0000-4000-8000-00000000000a') = 'officer',
    '4.2b the last officer KEPT their role');
  PERFORM t_assert(EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr
                            AND event_type='failure' AND error_code='last_officer'),
    '4.2c the refusal is durably audited');
END $$;

SELECT fixture_reset();
DO $$
DECLARE r JSONB; corr UUID := gen_random_uuid();
BEGIN
  INSERT INTO messages (channel_id, conversation_id, sender_id, content)
  VALUES ('11111111-0000-4000-8000-000000000011','ffffffff-0000-4000-8000-00000000000f',
          'aaaaaaaa-0000-4000-8000-00000000000a','hello');
  r := public.admin_tx_channel_delete_empty('94387196-0000-4000-8000-000000000001','f@w.app','Tidying up.',corr,
        '11111111-0000-4000-8000-000000000011');
  PERFORM t_assert(r->>'status' = 'channel_not_empty', '4.3a a channel holding messages is refused');
  PERFORM t_assert(EXISTS(SELECT 1 FROM conversation_channels WHERE id='11111111-0000-4000-8000-000000000011'),
    '4.3b the channel and its messages survive');
  PERFORM t_assert(EXISTS(SELECT 1 FROM admin_audit_events WHERE correlation_id=corr AND event_type='failure'),
    '4.3c the refusal is durably audited');
END $$;
RESET ROLE;


-- ===========================================================================
-- GROUP 5 — Audit event model
-- ===========================================================================
SET ROLE service_role;
SELECT t_assert(
  public.admin_audit_log('94387196-0000-4000-8000-000000000001','f@w.app','membership.add','club_member',
    NULL,NULL,NULL,NULL,'{}'::jsonb,NULL,NULL,gen_random_uuid(),'attempt') IS NOT NULL,
  '5.1  an ATTEMPT record can be written (success/error both NULL)');

SELECT t_assert(
  public.admin_audit_log('94387196-0000-4000-8000-000000000001','f@w.app','membership.add','club_member',
    NULL,NULL,NULL,NULL,'{}'::jsonb,NULL,'outcome_not_recorded',gen_random_uuid(),'reconciliation_required') IS NOT NULL,
  '5.2  a RECONCILIATION_REQUIRED record can be written');

SELECT t_denied($$SELECT public.admin_audit_log('94387196-0000-4000-8000-000000000001','f@w.app',
  'membership.add','club_member',NULL,NULL,NULL,NULL,'{}'::jsonb,NULL,'boom',gen_random_uuid(),'attempt')$$,
  '5.3  an attempt record carrying an error_code is rejected', 'error_consistency');

SELECT t_denied($$SELECT public.admin_audit_log('94387196-0000-4000-8000-000000000001','f@w.app',
  'membership.add','club_member',NULL,NULL,NULL,NULL,'{}'::jsonb,NULL,NULL,gen_random_uuid(),'reconciliation_required')$$,
  '5.4  a reconciliation record with no error_code is rejected', 'error_consistency');

SELECT t_denied($$SELECT public.admin_audit_log('94387196-0000-4000-8000-000000000001','f@w.app',
  'membership.add','club_member',NULL,NULL,NULL,NULL,'{}'::jsonb,NULL,NULL,gen_random_uuid(),'made_up_type')$$,
  '5.5  an unknown event_type is rejected', 'unknown event_type');

-- Cross-service pattern: attempt and outcome are SEPARATE rows sharing one id.
DO $$
DECLARE corr UUID := gen_random_uuid(); attempt_id UUID; outcome_id UUID;
BEGIN
  attempt_id := public.admin_audit_log('94387196-0000-4000-8000-000000000001','f@w.app','portal.lock','portal',
                  NULL,NULL,NULL,NULL,'{}'::jsonb,NULL,NULL,corr,'attempt');
  outcome_id := public.admin_audit_log('94387196-0000-4000-8000-000000000001','f@w.app','portal.lock','portal',
                  NULL,NULL,NULL,NULL,'{}'::jsonb,NULL,NULL,corr,'success');
  PERFORM t_assert(attempt_id <> outcome_id, '5.6  the outcome is a NEW row, not an edit of the attempt');
  PERFORM t_assert((SELECT count(*) FROM admin_audit_events WHERE correlation_id = corr) = 2,
    '5.7  attempt and outcome share ONE correlation id');
  PERFORM t_assert((SELECT count(DISTINCT event_type) FROM admin_audit_events WHERE correlation_id = corr) = 2,
    '5.8  and are distinguishable by event_type');
END $$;
RESET ROLE;

-- The attempt row can never be overwritten, even by the owner.
SELECT t_denied($$UPDATE admin_audit_events SET event_type = 'success' WHERE event_type = 'attempt'$$,
  '5.9  an ATTEMPT row cannot be converted into an outcome row', 'append-only');
SELECT t_denied($$DELETE FROM admin_audit_events WHERE event_type = 'attempt'$$,
  '5.10 an ATTEMPT row cannot be deleted', 'append-only');


-- ===========================================================================
-- GROUP 6 — Existing protections survive migration 056
-- ===========================================================================
SELECT t_denied($$UPDATE admin_audit_events SET reason = 'tampered'$$,
  '6.1  owner still cannot UPDATE audit rows', 'append-only');
SELECT t_denied($$DELETE FROM admin_audit_events$$,
  '6.2  owner still cannot DELETE audit rows', 'append-only');
SELECT t_denied($$TRUNCATE admin_audit_events$$,
  '6.3  owner still cannot TRUNCATE the trail', 'append-only');

SET ROLE service_role;
SELECT t_denied($$INSERT INTO admin_audit_events (actor_user_id, action, target_type, success, correlation_id, event_type)
  VALUES (gen_random_uuid(),'portal.lock','portal',true,gen_random_uuid(),'success')$$,
  '6.4  service_role still cannot insert directly', 'permission denied');
RESET ROLE;

SET ROLE authenticated;
SELECT t_denied($$SELECT * FROM admin_audit_events$$, '6.5  authenticated still cannot read the trail', 'permission denied');
SELECT t_denied($$SELECT public.admin_audit_log('94387196-0000-4000-8000-000000000001','f@w.app','portal.lock','portal')$$,
  '6.6  authenticated still cannot call admin_audit_log', 'permission denied');
RESET ROLE;

SET ROLE anon;
SELECT t_denied($$SELECT * FROM admin_audit_events$$, '6.7  anon still cannot read the trail', 'permission denied');
RESET ROLE;

-- The private in-transaction helpers are not a second, weaker door into the
-- table: nobody but their SECURITY DEFINER callers may execute them.
SELECT t_assert(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private' AND p.proname LIKE 'admin\_%'
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) = 0,
  '6.8  private audit helpers are executable by no client role'
);


-- ===========================================================================
-- Summary
-- ===========================================================================
DO $$
DECLARE n int;
BEGIN
  SELECT passed INTO n FROM t_counter;
  RAISE NOTICE '';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '  migration 056 harness: % assertions PASSED', n;
  RAISE NOTICE '=====================================================';
END $$;
