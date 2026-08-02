-- ===========================================================================
-- Test harness — migration 061 (Day 10C content lifecycle)
--
-- HOW TO RUN (throwaway database, NEVER production):
--
--   docker run -d --name wg-061 -e POSTGRES_USER=pgowner -e POSTGRES_PASSWORD=pg \
--     -e POSTGRES_DB=wg -p 55461:5432 postgres:15
--   docker exec -i wg-061 psql -U pgowner -d wg <<'EOF'
--     CREATE EXTENSION IF NOT EXISTS pg_trgm;
--     CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
--     CREATE ROLE service_role NOLOGIN;
--     CREATE ROLE wgowner NOSUPERUSER BYPASSRLS CREATEROLE LOGIN PASSWORD 'pg';
--     ALTER SCHEMA public OWNER TO wgowner;
--     GRANT anon, authenticated, service_role TO wgowner;
--     GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
--   EOF
--   for f in supabase/scripts/test_057_fixture_schema.sql \
--            supabase/scripts/test_061_fixture_schema.sql \
--            supabase/migrations/055_durable_admin_audit.sql \
--            supabase/migrations/056_atomic_admin_mutations.sql \
--            supabase/migrations/057_student_blocking.sql \
--            supabase/migrations/058_admin_restrictions.sql \
--            supabase/migrations/060_restriction_enforcement_hotfix.sql \
--            supabase/migrations/061_content_lifecycle.sql; do
--     docker exec -i -e PGPASSWORD=pg wg-061 psql -U wgowner -h 127.0.0.1 -d wg \
--       -v ON_ERROR_STOP=1 -q < $f
--   done
--   docker exec -i -e PGPASSWORD=pg wg-061 psql -U wgowner -h 127.0.0.1 -d wg -q \
--     < supabase/scripts/test_061_content_lifecycle.sql
--
-- The owner role is NOSUPERUSER BYPASSRLS, matching production `postgres` —
-- which is why FORCE ROW LEVEL SECURITY is not what protects content_lifecycle;
-- the absence of grants is.
--
-- THE CENTRAL CLAIMS UNDER TEST
--   1. Removed content is invisible to students through EVERY path, including
--      the SECURITY DEFINER functions that bypass RLS.
--   2. Interactions with removed content are denied by the DATABASE.
--   3. Restore returns the original content, with original timestamps and
--      engagement, and replays NO notification.
--   4. Purge is irreversible, ordered correctly, and idempotent.
--   5. The internal reason never reaches a student.
--   6. Day 10A append-only and Day 10B blocking/restrictions still hold.
--
-- Every negative assertion is paired with a POSITIVE CONTROL.
-- ===========================================================================

\set ON_ERROR_STOP on
\pset pager off
\timing off
\o /dev/null

DROP TABLE IF EXISTS t_results;
CREATE TABLE t_results (n serial primary key, name text, ok boolean, detail text);

CREATE OR REPLACE FUNCTION t_ok(p_name text, p_cond boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN INSERT INTO t_results (name, ok, detail) VALUES (p_name, COALESCE(p_cond,false), p_detail); END; $$;

CREATE OR REPLACE FUNCTION t_as(p_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, false); END; $$;

GRANT EXECUTE ON FUNCTION t_ok(text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION t_as(uuid) TO authenticated;

-- Status of an admin_tx_* call, as text.
CREATE OR REPLACE FUNCTION t_status(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT p ->> 'status'; $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
--   A   = content author / club officer
--   B   = an ordinary viewer
--   ADM = the administrator actor (platform admin: no profiles row)
\set A   '''61610000-0000-4000-8000-00000000000a'''
\set B   '''61610000-0000-4000-8000-00000000000b'''
\set ADM '''61610000-0000-4000-8000-0000000000ad'''
\set CLUB '''61610000-0000-4000-8000-00000000c1b0'''
-- uuids are hex only: content ids use hex-safe suffixes.
\set P1  '''61610000-0000-4000-8000-000000000f01'''
\set P2  '''61610000-0000-4000-8000-000000000f02'''
\set P3  '''61610000-0000-4000-8000-000000000f03'''
\set C1  '''61610000-0000-4000-8000-000000000c01'''
\set E1  '''61610000-0000-4000-8000-000000000e01'''
\set E2  '''61610000-0000-4000-8000-000000000e02'''
\set UNI '''61610000-0000-4000-8000-000000000001'''

INSERT INTO universities (id,name,slug) VALUES (:UNI,'Lone Star College','lone-star-college')
  ON CONFLICT DO NOTHING;

INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES
  (:A,   'a@lonestar.edu', '{}'::jsonb),
  (:B,   'b@lonestar.edu', '{}'::jsonb),
  (:ADM, 'founder@weglue.app', '{"account_type":"platform_admin"}'::jsonb);

INSERT INTO profiles (id,username,full_name,university,university_id) VALUES
  (:A,'aaa','A Author','Lone Star College',:UNI),
  (:B,'bbb','B Viewer','Lone Star College',:UNI);

INSERT INTO clubs (id,name,university,university_id,is_active) VALUES
  (:CLUB,'Chess Club','Lone Star College',:UNI,true);
INSERT INTO club_members (club_id,user_id,role) VALUES (:CLUB,:A,'officer'), (:CLUB,:B,'member');
INSERT INTO club_officers (club_id,user_id,role_title) VALUES (:CLUB,:A,'President');

-- Posts. P1 carries media in the `posts` bucket; P3 shares P1's media URL so the
-- uniquely-owned check has a real negative case.
INSERT INTO posts (id,author_id,club_id,post_type,image_url,caption,created_at) VALUES
  (:P1,:A,:CLUB,'picture','https://x.supabase.co/storage/v1/object/public/posts/a/1.jpg','hello',now() - interval '3 days'),
  (:P2,:A,NULL,  'picture','https://picsum.photos/200',                                   'seed', now() - interval '2 days'),
  (:P3,:A,NULL,  'picture','https://x.supabase.co/storage/v1/object/public/posts/a/1.jpg','dup',  now() - interval '1 day');

INSERT INTO post_comments (id,post_id,user_id,content,created_at) VALUES
  (:C1,:P1,:B,'nice one', now() - interval '2 days');
INSERT INTO post_likes (post_id,user_id) VALUES (:P1,:B);
INSERT INTO post_club_tags (post_id,club_id) VALUES (:P1,:CLUB);

INSERT INTO events (id,club_id,created_by,title,description,location,event_date,start_time,end_time,visibility,cover_image_url)
VALUES
  (:E1,:CLUB,:A,'Chess Night','Come play','Room 101', CURRENT_DATE + 5,'18:00','20:00','everyone',
   'https://x.supabase.co/storage/v1/object/public/posts/a/e1.jpg'),
  (:E2,:CLUB,:A,'Past Match','Old','Room 102', CURRENT_DATE - 5,'18:00','20:00','everyone',NULL);

INSERT INTO event_rsvps (event_id,user_id,status) VALUES (:E1,:B,'going');
INSERT INTO saved_events (user_id,event_id) VALUES (:B,:E1);

\o

-- ===========================================================================
\echo '=== 1. BASELINE — everything visible before any lifecycle action ==='
-- ===========================================================================
\o /dev/null
SET ROLE authenticated;
SELECT t_as(:A);
SELECT t_ok('1.1 author sees own post',        (SELECT count(*) FROM posts WHERE id = :P1) = 1);
SELECT t_ok('1.2 author sees own event',       (SELECT count(*) FROM events WHERE id = :E1) = 1);
SELECT t_as(:B);
SELECT t_ok('1.3 viewer sees post',            (SELECT count(*) FROM posts WHERE id = :P1) = 1);
SELECT t_ok('1.4 viewer sees comment',         (SELECT count(*) FROM post_comments WHERE id = :C1) = 1);
SELECT t_ok('1.5 viewer sees event',           (SELECT count(*) FROM events WHERE id = :E1) = 1);
SELECT t_ok('1.6 viewer sees club tag',        (SELECT count(*) FROM post_club_tags WHERE post_id = :P1) = 1);
SELECT t_ok('1.7 discovery lists event',       EXISTS (SELECT 1 FROM get_discovery_events(:B,50,0) g WHERE g.id = :E1));
RESET ROLE;
SELECT t_ok('1.8 realtime post topic allowed', private.can_receive_post_interaction('post:' || :P1));
SELECT t_ok('1.9 realtime event topic allowed',private.can_receive_event_interaction('event:' || :E1));

-- ===========================================================================
\echo '=== 2. REMOVE — post, comment, event ==='
-- ===========================================================================
SELECT t_ok('2.1 remove post ok',
  t_status(admin_tx_post_remove(:ADM,'founder@weglue.app','Policy violation: spam', gen_random_uuid(), :P1)) = 'ok');
SELECT t_ok('2.2 remove comment ok',
  t_status(admin_tx_comment_remove(:ADM,'founder@weglue.app','Harassment in comment', gen_random_uuid(), :C1)) = 'ok');
SELECT t_ok('2.3 remove event ok',
  t_status(admin_tx_event_remove(:ADM,'founder@weglue.app','Unsafe event details', gen_random_uuid(), :E1)) = 'ok');

SELECT t_ok('2.4 lifecycle rows are removed',
  (SELECT count(*) FROM content_lifecycle WHERE state = 'removed') = 3);

-- ── Student invisibility through every path ────────────────────────────────
SET ROLE authenticated;
SELECT t_as(:B);
SELECT t_ok('2.5  removed post invisible to viewer',    (SELECT count(*) FROM posts          WHERE id = :P1) = 0);
SELECT t_ok('2.6  removed comment invisible',           (SELECT count(*) FROM post_comments  WHERE id = :C1) = 0);
SELECT t_ok('2.7  removed event invisible to viewer',   (SELECT count(*) FROM events         WHERE id = :E1) = 0);
SELECT t_ok('2.8  removed post club tag invisible',     (SELECT count(*) FROM post_club_tags WHERE post_id = :P1) = 0);
SELECT t_ok('2.9  discovery excludes removed event',
  NOT EXISTS (SELECT 1 FROM get_discovery_events(:B,50,0) g WHERE g.id = :E1));
SELECT t_ok('2.10 POSITIVE CONTROL: other post still visible',
  (SELECT count(*) FROM posts WHERE id = :P2) = 1);
SELECT t_ok('2.11 POSITIVE CONTROL: past event still visible',
  (SELECT count(*) FROM events WHERE id = :E2) = 1);

-- ── The AUTHOR cannot see or act on their own removed content either ───────
SELECT t_as(:A);
SELECT t_ok('2.12 removed post invisible to its AUTHOR', (SELECT count(*) FROM posts WHERE id = :P1) = 0);

-- ── Interaction denial, enforced by the database ───────────────────────────
SELECT t_as(:B);
DO $$
DECLARE okc int;
BEGIN
  BEGIN INSERT INTO post_likes (post_id,user_id) VALUES ('61610000-0000-4000-8000-000000000f01','61610000-0000-4000-8000-00000000000b');
        PERFORM t_ok('2.13 like on removed post DENIED', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN PERFORM t_ok('2.13 like on removed post DENIED', true);
  END;
  BEGIN INSERT INTO post_comments (post_id,user_id,content) VALUES ('61610000-0000-4000-8000-000000000f01','61610000-0000-4000-8000-00000000000b','x');
        PERFORM t_ok('2.14 comment on removed post DENIED', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN PERFORM t_ok('2.14 comment on removed post DENIED', true);
  END;
  BEGIN INSERT INTO event_rsvps (event_id,user_id,status) VALUES ('61610000-0000-4000-8000-000000000e01','61610000-0000-4000-8000-00000000000a','going');
        PERFORM t_ok('2.15 RSVP to removed event DENIED', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN PERFORM t_ok('2.15 RSVP to removed event DENIED', true);
  END;
  BEGIN INSERT INTO saved_events (user_id,event_id) VALUES ('61610000-0000-4000-8000-00000000000a','61610000-0000-4000-8000-000000000e01');
        PERFORM t_ok('2.16 save removed event DENIED', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN PERFORM t_ok('2.16 save removed event DENIED', true);
  END;
  -- POSITIVE CONTROL: the same insert on ACTIVE content must succeed.
  BEGIN INSERT INTO post_likes (post_id,user_id) VALUES ('61610000-0000-4000-8000-000000000f02','61610000-0000-4000-8000-00000000000b');
        PERFORM t_ok('2.17 POSITIVE CONTROL: like on active post allowed', true);
  EXCEPTION WHEN OTHERS THEN PERFORM t_ok('2.17 POSITIVE CONTROL: like on active post allowed', false, SQLERRM);
  END;
END $$;

-- ── Author edit + self-delete of removed content are blocked ───────────────
SELECT t_as(:A);
UPDATE posts SET caption = 'edited' WHERE id = :P1;
SELECT t_ok('2.18 author cannot edit removed post', (SELECT count(*) FROM posts WHERE id = :P1 AND caption = 'edited') = 0);
DELETE FROM posts WHERE id = :P1;
RESET ROLE;
SELECT t_ok('2.19 author cannot self-delete removed post', (SELECT count(*) FROM posts WHERE id = :P1) = 1);

-- ── Existing engagement is PRESERVED while removed ────────────────────────
SELECT t_ok('2.20 existing like preserved',    (SELECT count(*) FROM post_likes    WHERE post_id = :P1) = 1);
SELECT t_ok('2.21 existing comment preserved', (SELECT count(*) FROM post_comments WHERE id = :C1) = 1);
SELECT t_ok('2.22 existing RSVP preserved',    (SELECT count(*) FROM event_rsvps   WHERE event_id = :E1) = 1);
SELECT t_ok('2.23 post media preserved',       (SELECT image_url IS NOT NULL FROM posts  WHERE id = :P1));
SELECT t_ok('2.24 event media preserved',      (SELECT cover_image_url IS NOT NULL FROM events WHERE id = :E1));
SELECT t_ok('2.25 original created_at preserved',
  (SELECT created_at < now() - interval '2 days' FROM posts WHERE id = :P1));

-- ── Realtime topics now denied ────────────────────────────────────────────
SELECT t_ok('2.26 realtime post topic DENIED',  NOT private.can_receive_post_interaction('post:' || :P1));
SELECT t_ok('2.27 realtime event topic DENIED', NOT private.can_receive_event_interaction('event:' || :E1));
SELECT t_ok('2.28 POSITIVE CONTROL: active post topic still allowed',
  private.can_receive_post_interaction('post:' || :P2));

-- ── Officer RPC guards ────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT t_as(:A);
DO $$
BEGIN
  BEGIN PERFORM remove_post_from_club('61610000-0000-4000-8000-000000000f01','61610000-0000-4000-8000-00000000c1b0');
        PERFORM t_ok('2.29 remove_post_from_club on removed post DENIED', false, 'succeeded');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('2.29 remove_post_from_club on removed post DENIED', true);
  END;
END $$;
RESET ROLE;

-- ===========================================================================
\echo '=== 3. INVALID TRANSITIONS — must fail clearly, never silently succeed ==='
-- ===========================================================================
SELECT t_ok('3.1 duplicate remove rejected',
  t_status(admin_tx_post_remove(:ADM,'f@w.app','again', gen_random_uuid(), :P1)) = 'already_removed');
SELECT t_ok('3.2 restore of ACTIVE content rejected',
  t_status(admin_tx_post_restore(:ADM,'f@w.app','why', gen_random_uuid(), :P2)) = 'not_removed');
SELECT t_ok('3.3 active -> purge_pending rejected (no direct purge)',
  t_status(admin_tx_post_request_purge(:ADM,'f@w.app','skip removal', gen_random_uuid(), :P2)) = 'invalid_transition');
SELECT t_ok('3.4 remove of nonexistent entity rejected',
  t_status(admin_tx_post_remove(:ADM,'f@w.app','ghost', gen_random_uuid(),
    '61610000-0000-4000-8000-0000000000ff')) = 'not_found');
SELECT t_ok('3.5 retry purge when not failed rejected',
  t_status(admin_tx_content_retry_purge(:ADM,'f@w.app','retry', gen_random_uuid(),'post',:P1)) = 'invalid_transition');
SELECT t_ok('3.6 retry purge with bad entity type rejected',
  t_status(admin_tx_content_retry_purge(:ADM,'f@w.app','retry', gen_random_uuid(),'club',:P1)) = 'invalid_target');

-- ── Reason validation (3..500, whitespace-only rejected) ──────────────────
-- Every one of these must come back as an honest `invalid_reason` status, NOT
-- as a raw CHECK-constraint exception from the 055 audit table.
SELECT t_ok('3.7 reason too short rejected',
  t_status(admin_tx_post_remove(:ADM,'f@w.app','no', gen_random_uuid(), :P2)) = 'invalid_reason');
SELECT t_ok('3.8 whitespace-only reason rejected',
  t_status(admin_tx_post_remove(:ADM,'f@w.app','     ', gen_random_uuid(), :P2)) = 'invalid_reason');
SELECT t_ok('3.9 empty reason rejected',
  t_status(admin_tx_post_remove(:ADM,'f@w.app','', gen_random_uuid(), :P2)) = 'invalid_reason');
SELECT t_ok('3.10 NULL reason rejected',
  t_status(admin_tx_post_remove(:ADM,'f@w.app',NULL, gen_random_uuid(), :P2)) = 'invalid_reason');
SELECT t_ok('3.11 reason over 500 chars rejected',
  t_status(admin_tx_post_remove(:ADM,'f@w.app',repeat('x',501), gen_random_uuid(), :P2)) = 'invalid_reason');
SELECT t_ok('3.12 restore validates reason too',
  t_status(admin_tx_post_restore(:ADM,'f@w.app','x', gen_random_uuid(), :P1)) = 'invalid_reason');
SELECT t_ok('3.13 purge request validates reason too',
  t_status(admin_tx_post_request_purge(:ADM,'f@w.app','  ', gen_random_uuid(), :P1)) = 'invalid_reason');
SELECT t_ok('3.14 retry purge validates reason too',
  t_status(admin_tx_content_retry_purge(:ADM,'f@w.app','y', gen_random_uuid(),'post',:P1)) = 'invalid_reason');
SELECT t_ok('3.15 a rejected reason changed NO state',
  (SELECT count(*) FROM content_lifecycle WHERE entity_id = :P2) = 0
  AND private.content_state('post', :P1) = 'removed');
SELECT t_ok('3.16 POSITIVE CONTROL: exactly-3-char reason accepted',
  t_status(admin_tx_post_remove(:ADM,'f@w.app','spa', gen_random_uuid(), :P2)) = 'ok');
SELECT t_ok('3.17 POSITIVE CONTROL: exactly-500-char reason accepted',
  t_status(admin_tx_post_restore(:ADM,'f@w.app',repeat('z',500), gen_random_uuid(), :P2)) = 'ok');

-- ===========================================================================
\echo '=== 4. RESTORE — original content back, nothing replayed ==='
-- ===========================================================================
\o /dev/null
-- Notification baseline BEFORE restore, so "no replay" is measured, not assumed.
CREATE TEMP TABLE t_notif_before AS SELECT count(*) AS n FROM notifications;

SELECT t_ok('4.1 restore post ok',
  t_status(admin_tx_post_restore(:ADM,'f@w.app','Appeal upheld', gen_random_uuid(), :P1)) = 'ok');
SELECT t_ok('4.2 restore event ok',
  t_status(admin_tx_event_restore(:ADM,'f@w.app','Appeal upheld', gen_random_uuid(), :E1)) = 'ok');

SET ROLE authenticated;
SELECT t_as(:B);
SELECT t_ok('4.3 restored post visible again',  (SELECT count(*) FROM posts  WHERE id = :P1) = 1);
SELECT t_ok('4.4 restored event visible again', (SELECT count(*) FROM events WHERE id = :E1) = 1);
SELECT t_ok('4.5 restored post has original caption',
  (SELECT caption FROM posts WHERE id = :P1) = 'hello');
SELECT t_ok('4.6 restored post keeps original created_at',
  (SELECT created_at < now() - interval '2 days' FROM posts WHERE id = :P1));
SELECT t_ok('4.7 engagement intact after restore',
  (SELECT count(*) FROM post_likes WHERE post_id = :P1) = 1);
SELECT t_ok('4.8 discovery lists restored event again',
  EXISTS (SELECT 1 FROM get_discovery_events(:B,50,0) g WHERE g.id = :E1));
SELECT t_ok('4.9 no duplicate post row after restore',
  (SELECT count(*) FROM posts WHERE id = :P1) = 1);
RESET ROLE;

SELECT t_ok('4.10 NO notification replayed by restore',
  (SELECT n FROM t_notif_before) = (SELECT count(*) FROM notifications));

-- The comment is STILL removed; restoring it now must work because its parent
-- post is active again.
SELECT t_ok('4.11 comment restore ok once parent active',
  t_status(admin_tx_comment_restore(:ADM,'f@w.app','Appeal upheld', gen_random_uuid(), :C1)) = 'ok');
SET ROLE authenticated; SELECT t_as(:B);
SELECT t_ok('4.12 restored comment has original body',
  (SELECT content FROM post_comments WHERE id = :C1) = 'nice one');
RESET ROLE;

-- ── Restore must FAIL when the parent post is not active ──────────────────
SELECT t_ok('4.13 remove comment again',
  t_status(admin_tx_comment_remove(:ADM,'f@w.app','again', gen_random_uuid(), :C1)) = 'ok');
SELECT t_ok('4.14 remove parent post',
  t_status(admin_tx_post_remove(:ADM,'f@w.app','parent', gen_random_uuid(), :P1)) = 'ok');
SELECT t_ok('4.15 comment restore DENIED while parent removed',
  t_status(admin_tx_comment_restore(:ADM,'f@w.app','try', gen_random_uuid(), :C1)) = 'parent_unavailable');
-- Put the post back so later sections start from a known state.
SELECT t_ok('4.16 restore parent post',
  t_status(admin_tx_post_restore(:ADM,'f@w.app','restoring for later sections', gen_random_uuid(), :P1)) = 'ok');

-- ===========================================================================
\echo '=== 5. REPORT / EVIDENCE BOUNDARY ==='
-- ===========================================================================
INSERT INTO reports (reporter_id, entity_type, entity_id, reason, status)
VALUES (:B,'post',:P1,'spam','pending');

SELECT t_ok('5.1 remove post with open report ok',
  t_status(admin_tx_post_remove(:ADM,'f@w.app','reported', gen_random_uuid(), :P1)) = 'ok');
SELECT t_ok('5.2 purge BLOCKED while report unresolved and no snapshot',
  t_status(admin_tx_post_request_purge(:ADM,'f@w.app','purge it', gen_random_uuid(), :P1)) = 'evidence_required');
SELECT t_ok('5.3 report row survived removal',
  (SELECT count(*) FROM reports WHERE entity_type='post' AND entity_id=:P1) = 1);

UPDATE reports SET status = 'resolved' WHERE entity_type='post' AND entity_id=:P1;
SELECT t_ok('5.4 purge ALLOWED once report resolved',
  t_status(admin_tx_post_request_purge(:ADM,'f@w.app','purge it', gen_random_uuid(), :P1)) = 'ok');

-- Student must not reach removed content through the report relationship.
SET ROLE authenticated; SELECT t_as(:B);
SELECT t_ok('5.5 student cannot read purge-pending post via report join',
  (SELECT count(*) FROM reports r JOIN posts p ON p.id = r.entity_id
    WHERE r.entity_type='post' AND r.entity_id = :P1) = 0);
RESET ROLE;

-- ===========================================================================
\echo '=== 6. PURGE ORCHESTRATION ==='
-- ===========================================================================
SELECT t_ok('6.1 state is purge_pending',
  private.content_state('post',:P1) = 'purge_pending');
SELECT t_ok('6.2 restore DENIED once purge begins',
  t_status(admin_tx_post_restore(:ADM,'f@w.app','undo', gen_random_uuid(), :P1)) = 'purge_in_progress');
SELECT t_ok('6.3 duplicate purge request rejected',
  t_status(admin_tx_post_request_purge(:ADM,'f@w.app','again', gen_random_uuid(), :P1)) = 'purge_in_progress');

-- SHARED MEDIA: P3 uses the same object URL as P1, so it is NOT uniquely owned.
SELECT t_ok('6.4 shared media NOT marked uniquely owned',
  (SELECT count(*) FROM content_purge_objects o
    JOIN content_lifecycle cl ON cl.id = o.lifecycle_id
   WHERE cl.entity_id = :P1 AND NOT o.uniquely_owned) = 1);
SELECT t_ok('6.5 no deletable object while media is shared',
  (SELECT count(*) FROM content_purge_pending_objects(
     (SELECT id FROM content_lifecycle WHERE entity_type='post' AND entity_id=:P1))) = 0);

-- Finalize with no deletable objects must succeed.
SELECT t_ok('6.6 finalize purge ok',
  t_status(content_purge_finalize(:ADM,'f@w.app', gen_random_uuid(), 'post', :P1)) = 'ok');
SELECT t_ok('6.7 state is purged', private.content_state('post',:P1) = 'purged');

-- ── Irreversible redaction ────────────────────────────────────────────────
SELECT t_ok('6.8  caption redacted',   (SELECT caption   IS NULL FROM posts WHERE id = :P1));
SELECT t_ok('6.9  image_url redacted', (SELECT image_url IS NULL FROM posts WHERE id = :P1));
SELECT t_ok('6.10 likes removed',      (SELECT count(*) FROM post_likes     WHERE post_id = :P1) = 0);
SELECT t_ok('6.11 club tags removed',  (SELECT count(*) FROM post_club_tags WHERE post_id = :P1) = 0);
SELECT t_ok('6.12 comments removed',   (SELECT count(*) FROM post_comments  WHERE post_id = :P1) = 0);
SELECT t_ok('6.13 child comment recorded as purged',
  private.content_state('comment',:C1) = 'purged');

-- ── Terminal state ────────────────────────────────────────────────────────
SELECT t_ok('6.14 restore after purge DENIED',
  t_status(admin_tx_post_restore(:ADM,'f@w.app','undo', gen_random_uuid(), :P1)) = 'already_purged');
SELECT t_ok('6.15 remove after purge DENIED',
  t_status(admin_tx_post_remove(:ADM,'f@w.app','again', gen_random_uuid(), :P1)) = 'already_purged');
SELECT t_ok('6.16 purge request after purge DENIED',
  t_status(admin_tx_post_request_purge(:ADM,'f@w.app','again', gen_random_uuid(), :P1)) = 'already_purged');
SELECT t_ok('6.17 duplicate finalize is an idempotent no-op',
  (content_purge_finalize(:ADM,'f@w.app', gen_random_uuid(), 'post', :P1)) ->> 'already' = 'true');
SELECT t_ok('6.18 exactly ONE purgeCompleted audit event',
  (SELECT count(*) FROM admin_audit_events
    WHERE action = 'post.purgeCompleted' AND target_id = :P1) = 1);
SELECT t_ok('6.19 late failure report cannot un-purge',
  (content_purge_mark_failed(:ADM,'f@w.app', gen_random_uuid(),'post',:P1,'storage_delete_failed')) ->> 'already' = 'true');
SELECT t_ok('6.20 still purged after late failure report',
  private.content_state('post',:P1) = 'purged');

-- Student still cannot see it.
SET ROLE authenticated; SELECT t_as(:B);
SELECT t_ok('6.21 purged post invisible to students', (SELECT count(*) FROM posts WHERE id = :P1) = 0);
RESET ROLE;

-- ===========================================================================
\echo '=== 7. EVENT PURGE — ordering, dependents, NO cancellation notice ==='
-- ===========================================================================
\o /dev/null
CREATE TEMP TABLE t_notif_before_evt AS SELECT count(*) AS n FROM notifications;

SELECT t_ok('7.1 remove event',
  t_status(admin_tx_event_remove(:ADM,'f@w.app','policy', gen_random_uuid(), :E1)) = 'ok');
SELECT t_ok('7.2 request event purge',
  t_status(admin_tx_event_request_purge(:ADM,'f@w.app','purge', gen_random_uuid(), :E1)) = 'ok');

-- E1's cover image is unique, so there IS a deletable object; simulate the
-- worker deleting it before finalizing.
SELECT t_ok('7.3 one uniquely-owned object captured',
  (SELECT count(*) FROM content_purge_pending_objects(
     (SELECT id FROM content_lifecycle WHERE entity_type='event' AND entity_id=:E1))) = 1);
SELECT t_ok('7.4 finalize BLOCKED while object undeleted',
  t_status(content_purge_finalize(:ADM,'f@w.app', gen_random_uuid(),'event',:E1)) = 'storage_incomplete');

SELECT content_purge_record_object(o.object_id, true)
  FROM content_purge_pending_objects(
    (SELECT id FROM content_lifecycle WHERE entity_type='event' AND entity_id=:E1)) o;

SELECT t_ok('7.5 finalize ok after storage deleted',
  t_status(content_purge_finalize(:ADM,'f@w.app', gen_random_uuid(),'event',:E1)) = 'ok');

-- THE ORDERING CLAIM: dependents are deleted BEFORE redaction, so
-- trg_event_updated_notify finds no 'going' RSVPs and notifies nobody.
SELECT t_ok('7.6 NO event_updated notification produced by purge',
  (SELECT count(*) FROM notifications WHERE type = 'event_updated' AND entity_id = :E1) = 0);
SELECT t_ok('7.7 no new notifications at all from event purge',
  (SELECT n FROM t_notif_before_evt) = (SELECT count(*) FROM notifications));

SELECT t_ok('7.8  title redacted',       (SELECT title           = '[removed]' FROM events WHERE id = :E1));
SELECT t_ok('7.9  description redacted', (SELECT description     IS NULL FROM events WHERE id = :E1));
SELECT t_ok('7.10 location redacted',    (SELECT location        IS NULL FROM events WHERE id = :E1));
SELECT t_ok('7.11 cover image redacted', (SELECT cover_image_url IS NULL FROM events WHERE id = :E1));
SELECT t_ok('7.12 RSVPs deleted',        (SELECT count(*) FROM event_rsvps  WHERE event_id = :E1) = 0);
SELECT t_ok('7.13 saved_events deleted', (SELECT count(*) FROM saved_events WHERE event_id = :E1) = 0);
SELECT t_ok('7.14 event row survives as tombstone', (SELECT count(*) FROM events WHERE id = :E1) = 1);

-- ===========================================================================
\echo '=== 8. PURGE FAILURE AND RETRY ==='
-- ===========================================================================
SELECT t_ok('8.1 remove P3',
  t_status(admin_tx_post_remove(:ADM,'f@w.app','policy', gen_random_uuid(), :P3)) = 'ok');
SELECT t_ok('8.2 request purge P3',
  t_status(admin_tx_post_request_purge(:ADM,'f@w.app','purge', gen_random_uuid(), :P3)) = 'ok');
SELECT t_ok('8.3 mark failed',
  (content_purge_mark_failed(:ADM,'f@w.app', gen_random_uuid(),'post',:P3,'storage_delete_failed')) ->> 'status' = 'ok');
SELECT t_ok('8.4 state is purge_failed', private.content_state('post',:P3) = 'purge_failed');

SET ROLE authenticated; SELECT t_as(:B);
SELECT t_ok('8.5 failed-purge content STILL hidden', (SELECT count(*) FROM posts WHERE id = :P3) = 0);
RESET ROLE;

SELECT t_ok('8.6 restore from purge_failed DENIED',
  t_status(admin_tx_post_restore(:ADM,'f@w.app','undo', gen_random_uuid(), :P3)) = 'purge_in_progress');
SELECT t_ok('8.7 retry moves back to purge_pending',
  t_status(admin_tx_content_retry_purge(:ADM,'f@w.app','retrying', gen_random_uuid(),'post',:P3)) = 'ok');
SELECT t_ok('8.8 state is purge_pending again', private.content_state('post',:P3) = 'purge_pending');

-- Now P1's media is free (P1 purged), so P3's object IS uniquely owned.
SELECT t_ok('8.9 P3 object now uniquely owned',
  (SELECT count(*) FROM content_purge_objects o JOIN content_lifecycle cl ON cl.id=o.lifecycle_id
    WHERE cl.entity_id = :P3 AND o.uniquely_owned) = 1);

-- Idempotency: an object that is already gone converges to deleted.
SELECT content_purge_record_object(o.object_id, false, 'not_found')
  FROM content_purge_pending_objects(
    (SELECT id FROM content_lifecycle WHERE entity_type='post' AND entity_id=:P3)) o;
SELECT t_ok('8.10 not_found converges to deleted (idempotent retry)',
  (SELECT count(*) FROM content_purge_pending_objects(
     (SELECT id FROM content_lifecycle WHERE entity_type='post' AND entity_id=:P3))) = 0);
SELECT t_ok('8.11 finalize after retry ok',
  t_status(content_purge_finalize(:ADM,'f@w.app', gen_random_uuid(),'post',:P3)) = 'ok');

-- ── Reconciliation ────────────────────────────────────────────────────────
SELECT content_purge_mark_reconciliation(:ADM,'f@w.app', gen_random_uuid(),'post',:P2,'outcome_persist_failed');
SELECT t_ok('8.12 reconciliation never touches a purged row',
  (SELECT reconciliation_required FROM content_lifecycle WHERE entity_type='post' AND entity_id=:P1) = false);
SELECT t_ok('8.13 reconciliation audit event written',
  (SELECT count(*) FROM admin_audit_events
    WHERE action='content.purgeReconciliationRequired' AND event_type='reconciliation_required') = 1);

-- ===========================================================================
\echo '=== 9. PRIVACY — internal reasons and payloads never leak ==='
-- ===========================================================================
SET ROLE authenticated; SELECT t_as(:B);
DO $$
BEGIN
  BEGIN PERFORM count(*) FROM content_lifecycle;
        PERFORM t_ok('9.1 student cannot read content_lifecycle', false, 'SELECT succeeded');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('9.1 student cannot read content_lifecycle', true);
  END;
  BEGIN PERFORM count(*) FROM content_purge_objects;
        PERFORM t_ok('9.2 student cannot read content_purge_objects', false, 'SELECT succeeded');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('9.2 student cannot read content_purge_objects', true);
  END;
  BEGIN PERFORM private.content_state('post','61610000-0000-4000-8000-000000000f01');
        PERFORM t_ok('9.3 student cannot call private.content_state', false, 'call succeeded');
  EXCEPTION WHEN insufficient_privilege OR undefined_function OR invalid_schema_name
    THEN PERFORM t_ok('9.3 student cannot call private.content_state', true);
  END;
  BEGIN PERFORM admin_tx_post_remove('61610000-0000-4000-8000-0000000000ad','x','y',gen_random_uuid(),
                                     '61610000-0000-4000-8000-000000000f02');
        PERFORM t_ok('9.4 student cannot call admin_tx_post_remove', false, 'call succeeded');
  EXCEPTION WHEN insufficient_privilege OR undefined_function
    THEN PERFORM t_ok('9.4 student cannot call admin_tx_post_remove', true);
  END;
  BEGIN PERFORM content_purge_claim_batch(5);
        PERFORM t_ok('9.5 student cannot claim purge work', false, 'call succeeded');
  EXCEPTION WHEN insufficient_privilege OR undefined_function
    THEN PERFORM t_ok('9.5 student cannot claim purge work', true);
  END;
END $$;
-- POSITIVE CONTROL: the visibility predicate IS callable (RLS needs it).
SELECT t_ok('9.6 POSITIVE CONTROL: predicate callable by student',
  content_is_student_visible('post', :P2) = true);
RESET ROLE;

-- ── Audit payload sanitization ────────────────────────────────────────────
SELECT t_ok('9.7 no audit payload contains the post caption',
  (SELECT count(*) FROM admin_audit_events
    WHERE (COALESCE(before_state::text,'') || COALESCE(after_state::text,'') ||
           COALESCE(metadata::text,'')) LIKE '%hello%') = 0);
SELECT t_ok('9.8 no audit payload contains the comment body',
  (SELECT count(*) FROM admin_audit_events
    WHERE (COALESCE(before_state::text,'') || COALESCE(after_state::text,'') ||
           COALESCE(metadata::text,'')) LIKE '%nice one%') = 0);
SELECT t_ok('9.9 no audit payload contains the event description or location',
  (SELECT count(*) FROM admin_audit_events
    WHERE (COALESCE(before_state::text,'') || COALESCE(after_state::text,'') ||
           COALESCE(metadata::text,'')) LIKE '%Room 101%'
       OR (COALESCE(before_state::text,'') || COALESCE(after_state::text,'') ||
           COALESCE(metadata::text,'')) LIKE '%Come play%') = 0);
SELECT t_ok('9.10 no audit payload contains a media URL',
  (SELECT count(*) FROM admin_audit_events
    WHERE (COALESCE(before_state::text,'') || COALESCE(after_state::text,'') ||
           COALESCE(metadata::text,'')) LIKE '%storage/v1/object%') = 0);
SELECT t_ok('9.11 no audit payload contains the internal reason field name',
  (SELECT count(*) FROM admin_audit_events
    WHERE COALESCE(before_state::text,'') LIKE '%internal_reason%'
       OR COALESCE(after_state::text,'')  LIKE '%internal_reason%') = 0);
-- The reason DOES live in the dedicated audit column — that is correct.
SELECT t_ok('9.12 POSITIVE CONTROL: reason recorded in the reason column',
  (SELECT count(*) FROM admin_audit_events WHERE reason = 'Policy violation: spam') >= 1);

-- ===========================================================================
\echo '=== 10. SECURITY POSTURE ==='
-- ===========================================================================
SELECT t_ok('10.1 content_is_student_visible is SECURITY DEFINER',
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='content_is_student_visible'));
SELECT t_ok('10.2 content_lifecycle has RLS enabled AND forced',
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname='content_lifecycle'));
SELECT t_ok('10.3 content_lifecycle has ZERO policies',
  (SELECT count(*) FROM pg_policies WHERE tablename='content_lifecycle') = 0);
SELECT t_ok('10.4 service_role has SELECT but no DML on content_lifecycle',
  has_table_privilege('service_role','content_lifecycle','SELECT')
  AND NOT has_table_privilege('service_role','content_lifecycle','INSERT')
  AND NOT has_table_privilege('service_role','content_lifecycle','UPDATE')
  AND NOT has_table_privilege('service_role','content_lifecycle','DELETE'));
SELECT t_ok('10.5 authenticated has NO privilege on content_lifecycle',
  NOT has_table_privilege('authenticated','content_lifecycle','SELECT'));
SELECT t_ok('10.6 anon has NO privilege on content_lifecycle',
  NOT has_table_privilege('anon','content_lifecycle','SELECT'));
SELECT t_ok('10.7 every new admin_tx_* is service_role only',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'admin_tx_%'
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE'))) = 0);
SELECT t_ok('10.8 purge worker functions are service_role only',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'content_purge_%'
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE'))) = 0);
SELECT t_ok('10.9 append-only: content_lifecycle rows cannot be deleted',
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE c.relname='content_lifecycle' AND NOT t.tgisinternal) >= 2);
DO $$
BEGIN
  BEGIN DELETE FROM content_lifecycle WHERE entity_type='post';
        PERFORM t_ok('10.10 DELETE on content_lifecycle refused', false, 'delete succeeded');
  EXCEPTION WHEN insufficient_privilege THEN PERFORM t_ok('10.10 DELETE on content_lifecycle refused', true);
  END;
END $$;
SELECT t_ok('10.11 post_club_tags no longer readable by anon',
  NOT EXISTS (SELECT 1 FROM pg_policies
               WHERE tablename='post_club_tags' AND cmd='SELECT' AND 'anon' = ANY(roles)));

-- RLS must be ENABLED on every table 061 writes a policy for; a policy on a
-- table with RLS off is decoration, and every invisibility assertion above
-- would be vacuously true.
SELECT t_ok('10.12 RLS enabled on all seven lifecycle-guarded tables',
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relrowsecurity
      AND c.relname IN ('posts','post_comments','post_likes','post_club_tags',
                        'events','event_rsvps','saved_events')) = 7);

-- The self-delete evidence guard MUST be SECURITY DEFINER: written inline in a
-- policy it reads `reports` as the caller, whose own RLS (reporter_id =
-- auth.uid()) hides the report and turns the guard into a no-op.
SELECT t_ok('10.13 content_delete_allowed is SECURITY DEFINER',
  (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='content_delete_allowed'));
SELECT t_ok('10.14 no DELETE policy reads reports inline',
  (SELECT count(*) FROM pg_policies
    WHERE tablename IN ('posts','events','post_comments') AND cmd='DELETE'
      AND COALESCE(qual,'') LIKE '%reports%') = 0);

-- ===========================================================================
\echo '=== 11. REGRESSION — Day 10A / 10B / prior migrations still intact ==='
-- ===========================================================================
SELECT t_ok('11.1 admin_audit_events still append-only (no DELETE)',
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE c.relname='admin_audit_events' AND NOT t.tgisinternal) >= 2);
SELECT t_ok('11.2 account_restrictions table intact',
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='account_restrictions') = 1);
SELECT t_ok('11.3 user_blocks table intact (Day 10B1)',
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema='public' AND table_name='user_blocks') = 1);
SELECT t_ok('11.4 current_student_can_access_app still present',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='current_student_can_access_app') = 1);
SELECT t_ok('11.5 delete_own_account_atomic still callable by students',
  (SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='delete_own_account_atomic'));
SELECT t_ok('11.6 create_poll still guarded (060)',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_poll__inner') = 1);
SELECT t_ok('11.7 check_club_inactivity still service_role only',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='check_club_inactivity'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 0);
SELECT t_ok('11.8 restriction predicate still applies to student writes',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='posts'
      AND COALESCE(qual,'')||COALESCE(with_check,'') LIKE '%current_student_can_access_app%') >= 1);
SELECT t_ok('11.9 057 block term preserved on posts SELECT',
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='posts' AND cmd='SELECT'
      AND COALESCE(qual,'') LIKE '%blocked_user_ids%') = 1);
SELECT t_ok('11.10 events realtime publication membership unchanged by 061',
  (SELECT count(*) FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND tablename='content_lifecycle') = 0);

-- ===========================================================================
\echo '=== 12. STUDENT SELF-DELETE vs ADMINISTRATOR REMOVAL ==='
-- ===========================================================================
-- P2 is active and unreported: the author may still delete it normally.
SET ROLE authenticated; SELECT t_as(:A);
DELETE FROM posts WHERE id = :P2;
RESET ROLE;
SELECT t_ok('12.1 author CAN self-delete active unreported post',
  (SELECT count(*) FROM posts WHERE id = :P2) = 0);

-- A reported active post cannot be self-deleted (evidence rule).
INSERT INTO posts (id,author_id,post_type,caption) VALUES
  ('61610000-0000-4000-8000-000000000f04',:A,'picture','reported one');
INSERT INTO reports (reporter_id, entity_type, entity_id, reason, status)
VALUES (:B,'post','61610000-0000-4000-8000-000000000f04','spam','pending');
SET ROLE authenticated; SELECT t_as(:A);
DELETE FROM posts WHERE id = '61610000-0000-4000-8000-000000000f04';
RESET ROLE;
SELECT t_ok('12.2 author CANNOT self-delete a post under open report',
  (SELECT count(*) FROM posts WHERE id = '61610000-0000-4000-8000-000000000f04') = 1);

-- The guard must hold even though the AUTHOR cannot see the report row itself.
SET ROLE authenticated; SELECT t_as(:A);
SELECT t_ok('12.3 author genuinely cannot see the report row',
  (SELECT count(*) FROM reports WHERE entity_id = '61610000-0000-4000-8000-000000000f04') = 0);
SELECT t_ok('12.4 predicate still denies the author',
  public.content_delete_allowed('post','61610000-0000-4000-8000-000000000f04') = false);
SELECT t_as(:B);
SELECT t_ok('12.5 predicate is not an oracle for a non-owner',
  public.content_delete_allowed('post','61610000-0000-4000-8000-000000000f04') = false);
RESET ROLE;

-- Once the report is resolved the author may delete again (positive control:
-- the guard is about OPEN reports, not a permanent freeze).
UPDATE reports SET status = 'resolved' WHERE entity_id = '61610000-0000-4000-8000-000000000f04';
SET ROLE authenticated; SELECT t_as(:A);
DELETE FROM posts WHERE id = '61610000-0000-4000-8000-000000000f04';
RESET ROLE;
SELECT t_ok('12.6 POSITIVE CONTROL: self-delete allowed once report resolved',
  (SELECT count(*) FROM posts WHERE id = '61610000-0000-4000-8000-000000000f04') = 0);

-- ===========================================================================
\echo '=== 13. ACCOUNT + CLUB INTERACTIONS ==='
-- ===========================================================================
-- Lifecycle rows have NO FK, so nothing about them cascades.
SELECT t_ok('13.1 content_lifecycle has no FK to content or profiles',
  (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relname='content_lifecycle' AND c.contype='f') = 0);
SELECT t_ok('13.2 removing content did not restrict the author',
  get_account_access_state(:A) = 'active');
SELECT t_ok('13.3 removing content did not delete the club',
  (SELECT count(*) FROM clubs WHERE id = :CLUB) = 1);

-- Restore into a club that no longer exists must fail safely.
INSERT INTO clubs (id,name,university_id,is_active)
VALUES ('61610000-0000-4000-8000-00000000c1b1','Doomed',:UNI,true);
INSERT INTO posts (id,author_id,club_id,post_type,caption)
VALUES ('61610000-0000-4000-8000-000000000f05',:A,'61610000-0000-4000-8000-00000000c1b1','picture','x');
SELECT t_ok('13.4 remove post of doomed club',
  t_status(admin_tx_post_remove(:ADM,'f@w.app','policy', gen_random_uuid(),
    '61610000-0000-4000-8000-000000000f05')) = 'ok');
-- Deleting the club cascades the POST away but MUST leave the lifecycle row.
DELETE FROM clubs WHERE id = '61610000-0000-4000-8000-00000000c1b1';
SELECT t_ok('13.5 lifecycle row survives club deletion',
  (SELECT count(*) FROM content_lifecycle
    WHERE entity_id = '61610000-0000-4000-8000-000000000f05') = 1);
SELECT t_ok('13.6 restore fails safely when the content is gone',
  t_status(admin_tx_post_restore(:ADM,'f@w.app','try', gen_random_uuid(),
    '61610000-0000-4000-8000-000000000f05')) = 'not_found');

-- ===========================================================================
\echo '=== 14. EVENT REMINDERS SUPPRESSED FOR REMOVED EVENTS ==='
-- ===========================================================================
-- The event must start inside the `event_reminder_hour` window: lead 60 min,
-- catch-up 30 min, so start ∈ (now+30, now+60]. 45 minutes sits in the middle.
-- Both date AND time are derived from Chicago-local now, because CURRENT_DATE is
-- the SERVER's date and would be the wrong day late in the Chicago evening.
INSERT INTO events (id,club_id,created_by,title,event_date,start_time,end_time,visibility)
SELECT '61610000-0000-4000-8000-000000000e03',:CLUB,:A,'Reminder Test',
       s.v::date, s.v::time, (s.v + interval '1 hour')::time, 'everyone'
  FROM (SELECT (now() AT TIME ZONE 'America/Chicago') + interval '45 minutes' AS v) s;
INSERT INTO event_rsvps (event_id,user_id,status)
VALUES ('61610000-0000-4000-8000-000000000e03',:B,'going');

-- POSITIVE CONTROL first: an ACTIVE event does generate a reminder.
SELECT t_ok('14.1 POSITIVE CONTROL: active event generates a reminder',
  process_event_reminders() >= 1);
DELETE FROM notifications WHERE entity_id = '61610000-0000-4000-8000-000000000e03';

SELECT t_ok('14.2 remove the event',
  t_status(admin_tx_event_remove(:ADM,'f@w.app','policy', gen_random_uuid(),
    '61610000-0000-4000-8000-000000000e03')) = 'ok');
SELECT t_ok('14.3 removed event generates NO reminder',
  process_event_reminders() = 0);
SELECT t_ok('14.4 no reminder row and no title leak',
  (SELECT count(*) FROM notifications
    WHERE entity_id = '61610000-0000-4000-8000-000000000e03') = 0);

-- ===========================================================================
\echo '=== RESULTS ==='
-- ===========================================================================
\o
SELECT n, CASE WHEN ok THEN 'PASS' ELSE '*** FAIL ***' END AS result, name,
       NULLIF(detail,'') AS detail
  FROM t_results ORDER BY n;

SELECT count(*) FILTER (WHERE ok) AS passed,
       count(*) FILTER (WHERE NOT ok) AS failed,
       count(*) AS total
  FROM t_results;
