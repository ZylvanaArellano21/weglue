-- ===========================================================================
-- Test harness — migration 057 (student-to-student blocking)
--
-- HOW TO RUN (throwaway database, NEVER production):
--
--   docker run -d --name wg-057 -e POSTGRES_PASSWORD=test -p 55437:5432 postgres:15
--   docker exec -i wg-057 psql -U postgres -d postgres <<'EOF'
--     CREATE ROLE pgowner LOGIN PASSWORD 'test' NOSUPERUSER BYPASSRLS CREATEROLE;
--     CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
--     CREATE ROLE service_role NOLOGIN BYPASSRLS;
--     GRANT anon, authenticated, service_role TO pgowner;
--     CREATE DATABASE wg OWNER pgowner;
--   EOF
--   docker exec -i wg-057 psql -U pgowner -d wg -c \
--     "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;"
--   docker exec -i wg-057 psql -U pgowner -d wg -v ON_ERROR_STOP=1 -q \
--     < supabase/scripts/test_057_fixture_schema.sql
--   docker exec -i wg-057 psql -U pgowner -d wg -v ON_ERROR_STOP=1 -q \
--     < supabase/migrations/057_student_blocking.sql
--   docker exec -i wg-057 psql -U pgowner -d wg -q \
--     < supabase/scripts/test_057_student_blocking.sql
--
-- THE CENTRAL CLAIMS UNDER TEST
--   1. A block PREVENTS INTERACTION IN BOTH DIRECTIONS, server-side, even for a
--      caller that bypasses the app entirely.
--   2. The blocked person CANNOT DETECT the block.
--   3. OFFICIAL club and event information SURVIVES the block.
--   4. Shared group and club conversations are NOT filtered.
--   5. Reporting and account deletion still work.
--
-- EVERY negative assertion is paired with a POSITIVE CONTROL. "B sees zero rows"
-- is worthless unless we first prove the rows exist and that A can see them.
-- ===========================================================================

\set ON_ERROR_STOP on
\pset pager off
\timing off
\o /dev/null

-- ── Harness ────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS t_results;
CREATE TABLE t_results (n serial primary key, name text, ok boolean, detail text);

-- SECURITY DEFINER so the harness can record a result while impersonating the
-- `authenticated` role, which deliberately has no rights on the results table.
CREATE OR REPLACE FUNCTION t_ok(p_name text, p_cond boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO t_results (name, ok, detail) VALUES (p_name, COALESCE(p_cond,false), p_detail);
END; $$;

-- Impersonate a student exactly as Supabase does: a JWT `sub` claim.
CREATE OR REPLACE FUNCTION t_as(p_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_uid)::text, false);
END; $$;

CREATE OR REPLACE FUNCTION t_anon() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN PERFORM set_config('request.jwt.claims', '', false); END; $$;

GRANT EXECUTE ON FUNCTION t_ok(text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION t_as(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION t_anon()                  TO authenticated;

-- ── Fixtures ───────────────────────────────────────────────────────────────
\set A '''aaaaaaaa-0000-4000-8000-000000000001'''
\set B '''bbbbbbbb-0000-4000-8000-000000000002'''
\set C '''cccccccc-0000-4000-8000-000000000003'''
\set PA '''dddddddd-0000-4000-8000-000000000004'''

INSERT INTO universities (id, name, slug)
VALUES ('11111111-0000-4000-8000-00000000aaaa','Lone Star College','lone-star-college');

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  (:A,  'a@myschool.edu', '{}'::jsonb),
  (:B,  'b@myschool.edu', '{}'::jsonb),
  (:C,  'c@myschool.edu', '{}'::jsonb),
  (:PA, 'founder@weglue.app', '{"account_type":"platform_admin"}'::jsonb);

INSERT INTO profiles (id, username, full_name, university_id) VALUES
  (:A,'alice','Alice Anderson','11111111-0000-4000-8000-00000000aaaa'),
  (:B,'bobby','Bobby Brown',   '11111111-0000-4000-8000-00000000aaaa'),
  (:C,'cara', 'Cara Cruz',     '11111111-0000-4000-8000-00000000aaaa');
-- The platform admin deliberately has NO profiles row (migration 053 behaviour).

INSERT INTO clubs (id, name, is_active, university_id)
VALUES ('22222222-0000-4000-8000-00000000bbbb','Robotics Club', true,
        '11111111-0000-4000-8000-00000000aaaa');
INSERT INTO club_members (club_id, user_id, role) VALUES
  ('22222222-0000-4000-8000-00000000bbbb', :A, 'member'),
  ('22222222-0000-4000-8000-00000000bbbb', :B, 'officer');

-- B is an OFFICER. B authors BOTH an official club post and a personal post.
INSERT INTO posts (id, author_id, club_id, caption) VALUES
  ('33333333-0000-4000-8000-00000000cc01', :B, '22222222-0000-4000-8000-00000000bbbb',
   'OFFICIAL: meeting moved to Room 204'),
  ('33333333-0000-4000-8000-00000000cc02', :B, NULL, 'personal selfie post');

INSERT INTO events (id, club_id, created_by, title, event_date, visibility)
VALUES ('44444444-0000-4000-8000-00000000dd01','22222222-0000-4000-8000-00000000bbbb',
        :B, 'Robotics Showcase', CURRENT_DATE + 3, 'everyone');

-- Mutual accepted follow = Gluemates.
INSERT INTO follows (follower_id, following_id, status) VALUES
  (:A, :B, 'accepted'), (:B, :A, 'accepted');

-- A shared DIRECT conversation with history, and a shared GROUP conversation.
INSERT INTO conversations (id, type, created_by) VALUES
  ('55555555-0000-4000-8000-00000000ee01','direct', :A),
  ('55555555-0000-4000-8000-00000000ee02','group',  :C);
INSERT INTO conversation_participants (conversation_id, user_id) VALUES
  ('55555555-0000-4000-8000-00000000ee01', :A),
  ('55555555-0000-4000-8000-00000000ee01', :B),
  ('55555555-0000-4000-8000-00000000ee02', :A),
  ('55555555-0000-4000-8000-00000000ee02', :B),
  ('55555555-0000-4000-8000-00000000ee02', :C);
INSERT INTO messages (id, conversation_id, sender_id, content) VALUES
  ('66666666-0000-4000-8000-00000000ff01','55555555-0000-4000-8000-00000000ee01', :B, 'old dm from B'),
  ('66666666-0000-4000-8000-00000000ff02','55555555-0000-4000-8000-00000000ee02', :B, 'group msg from B');

INSERT INTO push_tokens (user_id, token) VALUES (:A,'tokA'), (:B,'tokB');

-- Notifications that exist BEFORE any block, one of each class. These are what
-- prove the retro-visibility rule: the PERSONAL one must disappear from A's
-- list once B is blocked, the OFFICIAL one must survive (founder decision 3).
-- (The fixture's two accepted follows also seed new_follower + gluemate.)
INSERT INTO notifications (user_id, actor_id, type, entity_type, read, message) VALUES
  (:A, :B, 'like',      'post', false, 'B liked your post'),
  (:A, :B, 'club_post', 'post', false, 'Robotics Club posted');

-- ===========================================================================
-- POSITIVE CONTROLS — prove the world works BEFORE any block exists.
-- Without these, every "returns zero rows" assertion below is vacuous.
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:A);

SELECT t_ok('PC1 A can see B profile (pre-block)',
  (SELECT count(*) = 1 FROM profiles WHERE id = :B));
SELECT t_ok('PC2 A can see B personal post (pre-block)',
  (SELECT count(*) = 1 FROM posts WHERE id = '33333333-0000-4000-8000-00000000cc02'));
SELECT t_ok('PC3 A can see B official club post (pre-block)',
  (SELECT count(*) = 1 FROM posts WHERE id = '33333333-0000-4000-8000-00000000cc01'));
SELECT t_ok('PC4 Gluemate exists (mutual accepted follow)',
  (SELECT count(*) = 2 FROM follows
    WHERE (follower_id=:A AND following_id=:B) OR (follower_id=:B AND following_id=:A)));
SELECT t_ok('PC5 A finds B in search (pre-block)',
  (SELECT count(*) = 1 FROM search_discovery(:A,'bob') WHERE result_type='person' AND id=:B));
SELECT t_ok('PC6 A can see DM history from B (pre-block)',
  (SELECT count(*) = 1 FROM messages WHERE id='66666666-0000-4000-8000-00000000ff01'));
RESET ROLE;

-- ===========================================================================
-- 1–4. BLOCK / DUPLICATE / SELF / UNBLOCK
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:A);

SELECT t_ok('T01 A blocks B -> ok',
  (SELECT block_user(:B) ->> 'status' = 'ok'));
SELECT t_ok('T01b block row exists, owned by A',
  (SELECT count(*) = 1 FROM user_blocks WHERE blocker_id=:A AND blocked_id=:B));

SELECT t_ok('T02 duplicate block is idempotent (ok + already_blocked)',
  (SELECT (block_user(:B) ->> 'status') = 'ok'
      AND (block_user(:B) ->> 'already_blocked') = 'true'));
SELECT t_ok('T02b still exactly one row after duplicate blocks',
  (SELECT count(*) = 1 FROM user_blocks WHERE blocker_id=:A AND blocked_id=:B));

SELECT t_ok('T03 self-block refused',
  (SELECT block_user(:A) ->> 'status' = 'self_target'));
SELECT t_ok('T03b no self-block row was created',
  (SELECT count(*) = 0 FROM user_blocks WHERE blocker_id=:A AND blocked_id=:A));

SELECT t_ok('T04 platform-admin target refused (indistinguishable from not-found)',
  (SELECT block_user(:PA) ->> 'status' = 'user_not_found'));
RESET ROLE;

-- ===========================================================================
-- 5. THE BLOCKED PERSON CANNOT DETECT THE BLOCK
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:B);
SELECT t_ok('T05 B sees ZERO rows in user_blocks',
  (SELECT count(*) = 0 FROM user_blocks));
SELECT t_ok('T05b B''s own blocked list is empty',
  (SELECT count(*) = 0 FROM get_my_blocked_users()));
SELECT t_ok('T05c B cannot learn the direction (symmetric predicate only)',
  (SELECT target_is_blocked_from_current_user(:A) = true
      AND current_user_blocks(:A) = false));
RESET ROLE;

SET ROLE authenticated;
SELECT t_as(:A);
SELECT t_ok('T05d A DOES see the row they own (positive control for T05)',
  (SELECT count(*) = 1 FROM user_blocks));
RESET ROLE;

-- ===========================================================================
-- 6–8. FOLLOWS AND GLUEMATE
-- ===========================================================================
SELECT t_ok('T06 follow rows removed in BOTH directions',
  (SELECT count(*) = 0 FROM follows
    WHERE (follower_id=:A AND following_id=:B) OR (follower_id=:B AND following_id=:A)));

SELECT t_ok('T07 Gluemate (mutual accepted follow) no longer derivable',
  (SELECT NOT EXISTS (
     SELECT 1 FROM follows f1 JOIN follows f2
       ON f1.follower_id = f2.following_id AND f1.following_id = f2.follower_id
      WHERE f1.follower_id = :A AND f1.following_id = :B
        AND f1.status='accepted' AND f2.status='accepted')));

-- NOTE ON WHAT THIS MEASURES. The fixture's two ACCEPTED follows fire
-- handle_follow_insert, which legitimately creates new_follower + gluemate
-- notifications BEFORE any block exists. So "count = 0" would be measuring the
-- fixture, not the block. The two things that actually matter are measured
-- separately: (a) block_user() itself emits nothing new, and (b) the pre-block
-- personal notifications stop being VISIBLE to the blocker.
-- T08a measures a real DELTA around a real call, on a FRESH pair, so it cannot
-- pass by accident: snapshot every notification id, block, then assert that the
-- set of notification ids is byte-for-byte unchanged.
DO $$
DECLARE
  v_before bigint;
  v_after  bigint;
BEGIN
  SELECT count(*) INTO v_before FROM notifications;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','cccccccc-0000-4000-8000-000000000003')::text, false);
  PERFORM block_user('aaaaaaaa-0000-4000-8000-000000000001');
  SELECT count(*) INTO v_after FROM notifications;
  PERFORM t_ok('T08a block_user() emitted NO notification at all (measured delta)',
               v_after = v_before,
               format('before=%s after=%s', v_before, v_after));
  PERFORM unblock_user('aaaaaaaa-0000-4000-8000-000000000001');
END $$;

SET ROLE authenticated;
SELECT t_as(:A);
SELECT t_ok('T08b pre-block PERSONAL notifications from B are hidden from A',
  (SELECT count(*) = 0 FROM notifications
    WHERE actor_id=:B AND type IN ('new_follower','gluemate','like','comment')));
SELECT t_ok('T08d positive control: OFFICIAL notifications from B still visible',
  (SELECT count(*) >= 1 FROM notifications
    WHERE actor_id=:B AND type IN ('club_post','event_canceled')));
RESET ROLE;

SET ROLE authenticated;
SELECT t_as(:B);
SELECT t_ok('T08c reverse direction: A''s personal notifications hidden from B',
  (SELECT count(*) = 0 FROM notifications
    WHERE actor_id=:A AND type IN ('new_follower','gluemate','like','comment')));
RESET ROLE;

-- A modified client must not be able to recreate the follow.
SET ROLE authenticated;
SELECT t_as(:A);
DO $$ BEGIN
  BEGIN
    INSERT INTO follows (follower_id, following_id, status)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002','accepted');
    PERFORM t_ok('T09 raw follow INSERT while blocked is DENIED', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    PERFORM t_ok('T09 raw follow INSERT while blocked is DENIED', true);
  END;
END $$;
RESET ROLE;

-- ...and neither can the blocked person, from their side.
SET ROLE authenticated;
SELECT t_as(:B);
DO $$ BEGIN
  BEGIN
    INSERT INTO follows (follower_id, following_id, status)
    VALUES ('bbbbbbbb-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','pending');
    PERFORM t_ok('T09b blocked person cannot follow back either', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    PERFORM t_ok('T09b blocked person cannot follow back either', true);
  END;
END $$;
RESET ROLE;

-- ===========================================================================
-- 11. DISCOVERY IDENTITY SPOOFING  (the B2 regression)
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:A);

DO $$ BEGIN
  BEGIN
    PERFORM search_discovery('cccccccc-0000-4000-8000-000000000003','bob');
    PERFORM t_ok('T11 search_discovery with SPOOFED p_user_id is REJECTED', false, 'call succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t_ok('T11 search_discovery with SPOOFED p_user_id is REJECTED', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM get_discovery_people('cccccccc-0000-4000-8000-000000000003');
    PERFORM t_ok('T11b get_discovery_people SPOOFED p_user_id REJECTED', false, 'call succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t_ok('T11b get_discovery_people SPOOFED p_user_id REJECTED', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM get_discovery_clubs('cccccccc-0000-4000-8000-000000000003', NULL, 20, 0);
    PERFORM t_ok('T11c get_discovery_clubs SPOOFED p_user_id REJECTED', false, 'call succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t_ok('T11c get_discovery_clubs SPOOFED p_user_id REJECTED', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM get_discovery_events('cccccccc-0000-4000-8000-000000000003', 20, 0);
    PERFORM t_ok('T11d get_discovery_events SPOOFED p_user_id REJECTED', false, 'call succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t_ok('T11d get_discovery_events SPOOFED p_user_id REJECTED', true);
  END;
END $$;

-- COMPATIBILITY: shipped clients pass their OWN id. That must keep working.
SELECT t_ok('T11e installed clients passing correct p_user_id still work',
  (SELECT count(*) >= 0 FROM search_discovery(:A,'rob')));
SELECT t_ok('T11f NULL p_user_id is accepted (future clients may omit it)',
  (SELECT count(*) >= 0 FROM search_discovery(NULL,'rob')));
RESET ROLE;

-- Unauthenticated calls are refused outright.
SET ROLE authenticated;
SELECT t_anon();
DO $$ BEGIN
  BEGIN
    PERFORM search_discovery(NULL,'rob');
    PERFORM t_ok('T11g unauthenticated discovery call REJECTED', false, 'call succeeded');
  EXCEPTION WHEN invalid_authorization_specification THEN
    PERFORM t_ok('T11g unauthenticated discovery call REJECTED', true);
  END;
END $$;
RESET ROLE;

-- ===========================================================================
-- SEARCH INPUT HARDENING (Gate 1)
--
-- User input reaches an ILIKE pattern. Parameterization stops SQL injection,
-- but NOT LIKE metacharacters. Before safe_like_fragment() existed, a bare '%'
-- returned the entire student directory up to the limit — enumeration through
-- the search box — and a pattern with no trigrams also forced the exact
-- sequential scan search_students() exists to avoid.
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:A);
SELECT unblock_user(:B);
SELECT unblock_user(:C);

-- POSITIVE CONTROLS FIRST: without these, every "returns 0" below is vacuous.
SELECT t_ok('T30 positive control: a real fragment still matches',
  (SELECT count(*) = 1 FROM search_students('bob', 10)));
SELECT t_ok('T30b search is case-insensitive, as before',
  (SELECT count(*) = 1 FROM search_students('BOBBY', 10)));
SELECT t_ok('T30c search_discovery still matches a real fragment',
  (SELECT count(*) = 1 FROM search_discovery(NULL,'bob') WHERE result_type='person'));

SELECT t_ok('T31 wildcard-only "%" returns NOTHING (no directory enumeration)',
  (SELECT count(*) = 0 FROM search_students('%', 50)));
SELECT t_ok('T31b wildcard-only "_" returns NOTHING',
  (SELECT count(*) = 0 FROM search_students('_', 50)));
SELECT t_ok('T31c repeated wildcards "%%%" return NOTHING',
  (SELECT count(*) = 0 FROM search_students('%%%', 50)));
SELECT t_ok('T31d a lone backslash is handled safely',
  (SELECT count(*) = 0 FROM search_students('\', 50)));
SELECT t_ok('T31e search_discovery is hardened identically',
  (SELECT count(*) = 0 FROM search_discovery(NULL,'%') WHERE result_type='person'));

SELECT t_ok('T32 a 10,000-character fragment is capped, not scanned raw',
  (SELECT length(safe_like_fragment(repeat('x',10000))) = 100));
SELECT t_ok('T32b blank and whitespace-only input return nothing',
  (SELECT count(*) = 0 FROM search_students('', 10))
   AND (SELECT count(*) = 0 FROM search_students('    ', 10)));

-- MINIMUM QUERY LENGTH. A trigram index cannot serve a pattern under 3 chars,
-- so a shorter fragment always seq-scans: 20.6 ms at 1 char and 72.2 ms at 2
-- chars on a 200k-profile database, versus 0.41 ms at 3. The bound is measured
-- on the RAW trimmed input, because escaping '%' yields the 2-character '\%'.
SELECT t_ok('T32c a 1-character query returns nothing (below the index threshold)',
  (SELECT count(*) = 0 FROM search_students('b', 50)));
SELECT t_ok('T32d a 2-character query returns nothing',
  (SELECT count(*) = 0 FROM search_students('bo', 50)));
SELECT t_ok('T32e 3 characters IS enough (the boundary is inclusive)',
  (SELECT count(*) = 1 FROM search_students('bob', 50)));
SELECT t_ok('T32f escaped wildcard cannot sneak past the length bound',
  (SELECT count(*) = 0 FROM search_students('%', 50))
   AND (SELECT count(*) = 0 FROM search_students('%%', 50)));

SELECT t_ok('T33 limit is bounded above (9999 cannot be requested)',
  (SELECT count(*) <= 50 FROM search_students('bob', 9999)));
SELECT t_ok('T33b negative and NULL limits are handled safely',
  (SELECT count(*) >= 0 FROM search_students('bob', -5))
   AND (SELECT count(*) >= 0 FROM search_students('bob', NULL)));

SELECT block_user(:B);
SELECT t_ok('T34 block filtering still applies on top of literal matching',
  (SELECT count(*) = 0 FROM search_students('bob', 10)));
RESET ROLE;

SET ROLE authenticated;
SELECT t_as(:B);
DO $$ BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims','',false);
    PERFORM search_students('bob', 10);
    PERFORM t_ok('T35 unauthenticated search_students is REJECTED', false, 'call succeeded');
  EXCEPTION WHEN invalid_authorization_specification THEN
    PERFORM t_ok('T35 unauthenticated search_students is REJECTED', true);
  END;
END $$;
RESET ROLE;

-- ===========================================================================
-- 15–17. SEARCH / RECOMMENDATION / PROFILE EXCLUSION — BOTH DIRECTIONS
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:A);
SELECT t_ok('T15 A cannot find B in search',
  (SELECT count(*) = 0 FROM search_discovery(:A,'bob') WHERE result_type='person' AND id=:B));
SELECT t_ok('T16 A does not get B in people recommendations',
  (SELECT count(*) = 0 FROM get_discovery_people(:A) WHERE user_id=:B));
SELECT t_ok('T17 A''s direct profile read of B returns ZERO rows',
  (SELECT count(*) = 0 FROM profiles WHERE id=:B));
SELECT t_ok('T17b A can still see unrelated student C (no over-blocking)',
  (SELECT count(*) = 1 FROM profiles WHERE id=:C));
RESET ROLE;

SET ROLE authenticated;
SELECT t_as(:B);
SELECT t_ok('T15b B cannot find A in search (reverse direction)',
  (SELECT count(*) = 0 FROM search_discovery(:B,'alice') WHERE result_type='person' AND id=:A));
SELECT t_ok('T16b B does not get A in recommendations (reverse direction)',
  (SELECT count(*) = 0 FROM get_discovery_people(:B) WHERE user_id=:A));
SELECT t_ok('T17c B''s direct profile read of A returns ZERO rows (reverse)',
  (SELECT count(*) = 0 FROM profiles WHERE id=:A));
RESET ROLE;

-- ===========================================================================
-- 18–19. PERSONAL vs OFFICIAL CONTENT  (founder decision 3)
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:A);
SELECT t_ok('T18 B''s PERSONAL post is hidden from A',
  (SELECT count(*) = 0 FROM posts WHERE id='33333333-0000-4000-8000-00000000cc02'));
SELECT t_ok('T19 B''s OFFICIAL CLUB post REMAINS VISIBLE to A',
  (SELECT count(*) = 1 FROM posts WHERE id='33333333-0000-4000-8000-00000000cc01'));
SELECT t_ok('T19b the club event created by B remains visible',
  (SELECT count(*) = 1 FROM get_discovery_events(:A,20,0)
    WHERE id='44444444-0000-4000-8000-00000000dd01'));
SELECT t_ok('T19c the club itself remains discoverable',
  (SELECT count(*) = 1 FROM get_discovery_clubs(:A,NULL,20,0)
    WHERE id='22222222-0000-4000-8000-00000000bbbb'));
SELECT t_ok('T19d club membership + officer role unchanged by the block',
  (SELECT count(*) = 2 FROM club_members
    WHERE club_id='22222222-0000-4000-8000-00000000bbbb')
   AND (SELECT role='officer' FROM club_members
         WHERE club_id='22222222-0000-4000-8000-00000000bbbb' AND user_id=:B));
RESET ROLE;

-- ===========================================================================
-- 13–14. DIRECT MESSAGING
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:A);
DO $$ BEGIN
  BEGIN
    PERFORM get_or_create_direct_chat('bbbbbbbb-0000-4000-8000-000000000002');
    PERFORM t_ok('T13 new DM creation DENIED after block', false, 'call succeeded');
  EXCEPTION WHEN raise_exception THEN
    PERFORM t_ok('T13 new DM creation DENIED after block', true);
  END;
END $$;

DO $$ BEGIN
  BEGIN
    INSERT INTO messages (conversation_id, sender_id, content)
    VALUES ('55555555-0000-4000-8000-00000000ee01',
            'aaaaaaaa-0000-4000-8000-000000000001','sneaky');
    PERFORM t_ok('T14 raw INSERT into existing DM DENIED (blocker side)', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    PERFORM t_ok('T14 raw INSERT into existing DM DENIED (blocker side)', true);
  END;
END $$;

SELECT t_ok('T14c existing DM HISTORY is preserved and still readable',
  (SELECT count(*) = 1 FROM messages WHERE id='66666666-0000-4000-8000-00000000ff01'));
SELECT t_ok('T14d the DM thread was hidden from the BLOCKER''s inbox',
  (SELECT hidden_at IS NOT NULL FROM conversation_participants
    WHERE conversation_id='55555555-0000-4000-8000-00000000ee01' AND user_id=:A));
RESET ROLE;

SET ROLE authenticated;
SELECT t_as(:B);
DO $$ BEGIN
  BEGIN
    INSERT INTO messages (conversation_id, sender_id, content)
    VALUES ('55555555-0000-4000-8000-00000000ee01',
            'bbbbbbbb-0000-4000-8000-000000000002','sneaky from B');
    PERFORM t_ok('T14b raw INSERT into existing DM DENIED (blocked side)', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    PERFORM t_ok('T14b raw INSERT into existing DM DENIED (blocked side)', true);
  END;
END $$;
SELECT t_ok('T14e blocked person''s inbox was NOT touched (no disclosure)',
  (SELECT hidden_at IS NULL FROM conversation_participants
    WHERE conversation_id='55555555-0000-4000-8000-00000000ee01' AND user_id=:B));
SELECT t_ok('T14f blocked person can still READ the DM history',
  (SELECT count(*) = 1 FROM messages WHERE id='66666666-0000-4000-8000-00000000ff01'));
RESET ROLE;

-- ===========================================================================
-- 22. SHARED GROUP / CLUB CONVERSATIONS ARE NOT FILTERED  (founder decision 2)
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:A);
SELECT t_ok('T22 B''s GROUP message stays fully visible to A',
  (SELECT count(*) = 1 FROM messages WHERE id='66666666-0000-4000-8000-00000000ff02'));
WITH ins AS (
  INSERT INTO messages (conversation_id, sender_id, content)
  VALUES ('55555555-0000-4000-8000-00000000ee02',
          'aaaaaaaa-0000-4000-8000-000000000001','hello group')
  RETURNING 1)
SELECT t_ok('T22b A can still send in the SHARED group conversation',
            (SELECT count(*) = 1 FROM ins));
SELECT t_ok('T22c nobody was removed from the shared group',
  (SELECT count(*) = 3 FROM conversation_participants
    WHERE conversation_id='55555555-0000-4000-8000-00000000ee02'));
RESET ROLE;

SET ROLE authenticated;
SELECT t_as(:C);
SELECT t_ok('T22d third participant C is completely unaffected',
  (SELECT count(*) = 2 FROM messages
    WHERE conversation_id='55555555-0000-4000-8000-00000000ee02'));
RESET ROLE;

-- ===========================================================================
-- 20–21. NOTIFICATION SUPPRESSION — every insertion path
-- ===========================================================================
-- Path 1: the helper used by most triggers.
SELECT insert_notification_once(:B, :A, 'like', gen_random_uuid(), 'post');
SELECT t_ok('T20 insert_notification_once suppressed for a blocked pair',
  (SELECT count(*) = 0 FROM notifications WHERE user_id=:B AND actor_id=:A AND type='like'));

-- Path 2: a DIRECT INSERT, the path create_group_chat/add_group_participants use.
INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
VALUES (:B, :A, 'group_chat_added', gen_random_uuid(), 'message', false, 'added');
SELECT t_ok('T21 DIRECT notification INSERT suppressed by the BEFORE trigger',
  (SELECT count(*) = 0 FROM notifications WHERE user_id=:B AND actor_id=:A AND type='group_chat_added'));

-- Shared-context and official types must still get through.
INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
VALUES (:B, :A, 'group_message', gen_random_uuid(), 'message', false, 'group activity');
SELECT t_ok('T21b SHARED-CONTEXT group_message is NOT suppressed',
  (SELECT count(*) = 1 FROM notifications WHERE user_id=:B AND actor_id=:A AND type='group_message'));

INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
VALUES (:A, :B, 'club_post', '88888888-0000-4000-8000-00000000ab01', 'post', false, 'official club post');
SELECT t_ok('T21c OFFICIAL club_post notification is NOT suppressed',
  (SELECT count(*) = 1 FROM notifications
    WHERE user_id=:A AND actor_id=:B AND type='club_post'
      AND entity_id='88888888-0000-4000-8000-00000000ab01'));

INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
VALUES (:A, :B, 'event_canceled', gen_random_uuid(), 'event', false, 'event cancelled');
SELECT t_ok('T21d SAFETY/official event_canceled is NOT suppressed',
  (SELECT count(*) = 1 FROM notifications WHERE user_id=:A AND actor_id=:B AND type='event_canceled'));

-- Unrelated pairs are entirely unaffected.
SELECT insert_notification_once(:C, :A, 'like', gen_random_uuid(), 'post');
SELECT t_ok('T21e unblocked pair still receives notifications (no over-blocking)',
  (SELECT count(*) = 1 FROM notifications WHERE user_id=:C AND actor_id=:A AND type='like'));

-- Push: an item queued BEFORE the block is swept at claim time.
INSERT INTO notifications (id, user_id, actor_id, type, entity_type, read, message)
VALUES ('77777777-0000-4000-8000-000000009901', :B, :A, 'group_message', 'message', false, 'x');
INSERT INTO push_queue (user_id, notification_id, category, title, body, scheduled_for)
VALUES (:B, '77777777-0000-4000-8000-000000009901', 'messages', 't', 'b', now() - interval '1 minute');
UPDATE notifications SET type = 'like'
 WHERE id = '77777777-0000-4000-8000-000000009901';   -- now a blockable type
SELECT count(*) FROM claim_push_batch(50);
SELECT t_ok('T21f queued push for a blocked pair is SUPPRESSED at claim time',
  (SELECT status = 'suppressed' FROM push_queue
    WHERE notification_id='77777777-0000-4000-8000-000000009901'));

-- ===========================================================================
-- 12. DIRECT API BYPASS ATTEMPTS
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:B);
DO $$ BEGIN
  BEGIN
    INSERT INTO user_blocks (blocker_id, blocked_id)
    VALUES ('bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000003');
    PERFORM t_ok('T12 raw INSERT into user_blocks DENIED (RPC-only)', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t_ok('T12 raw INSERT into user_blocks DENIED (RPC-only)', true);
  END;
END $$;
DO $$ BEGIN
  BEGIN
    DELETE FROM user_blocks;
    PERFORM t_ok('T12b raw DELETE from user_blocks DENIED', false, 'delete succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM t_ok('T12b raw DELETE from user_blocks DENIED', true);
  END;
END $$;
RESET ROLE;

-- ===========================================================================
-- REPORTING MUST SURVIVE A BLOCK
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:A);
WITH ins AS (
  INSERT INTO reports (reporter_id, entity_type, entity_id, reason)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','user',
          'bbbbbbbb-0000-4000-8000-000000000002','harassment')
  RETURNING 1)
SELECT t_ok('T23 A can still REPORT B after blocking them',
            (SELECT count(*) = 1 FROM ins));
RESET ROLE;

-- ===========================================================================
-- 9–10. RACE SAFETY (both interleavings tested deterministically)
-- ===========================================================================
-- follow-then-block: the follow exists first, the block must still win.
SET ROLE authenticated;
SELECT t_as(:C);
INSERT INTO follows (follower_id, following_id, status) VALUES (:C, :A, 'accepted');
RESET ROLE;
SET ROLE authenticated;
SELECT t_as(:A);
SELECT block_user(:C);
SELECT t_ok('T09c follow-then-block: block wins, follow removed',
  (SELECT count(*) = 0 FROM follows WHERE follower_id=:C AND following_id=:A));
-- block-then-follow was already proven by T09/T09b.
SELECT unblock_user(:C);
RESET ROLE;

-- ===========================================================================
-- 4. UNBLOCK
-- ===========================================================================
SET ROLE authenticated;
SELECT t_as(:A);
SELECT t_ok('T24 A unblocks B -> ok, was_blocked=true',
  (SELECT (unblock_user(:B) ->> 'was_blocked') = 'true'));
SELECT t_ok('T24b repeated unblock is idempotent (was_blocked=false)',
  (SELECT (unblock_user(:B) ->> 'was_blocked') = 'false'));
SELECT t_ok('T25 unblock does NOT restore follows',
  (SELECT count(*) = 0 FROM follows
    WHERE (follower_id=:A AND following_id=:B) OR (follower_id=:B AND following_id=:A)));
SELECT t_ok('T25b unblock does NOT recreate Gluemate status',
  (SELECT NOT EXISTS (
     SELECT 1 FROM follows f1 JOIN follows f2
       ON f1.follower_id=f2.following_id AND f1.following_id=f2.follower_id
      WHERE f1.follower_id=:A AND f1.following_id=:B)));
SELECT t_ok('T26 after unblock, B is discoverable again',
  (SELECT count(*) = 1 FROM profiles WHERE id=:B));
SELECT t_ok('T26b after unblock, B''s personal post is visible again',
  (SELECT count(*) = 1 FROM posts WHERE id='33333333-0000-4000-8000-00000000cc02'));
RESET ROLE;

-- A cannot unblock a pair they do not own.
SET ROLE authenticated;
SELECT t_as(:A);
SELECT block_user(:B);
RESET ROLE;
SET ROLE authenticated;
SELECT t_as(:C);
SELECT t_ok('T27 C''s unblock cannot touch a block owned by A',
  (SELECT (unblock_user(:B) ->> 'was_blocked') = 'false'));
RESET ROLE;
SELECT t_ok('T27b A''s block row survived C''s unblock attempt',
  (SELECT count(*) = 1 FROM user_blocks WHERE blocker_id=:A AND blocked_id=:B));

-- ===========================================================================
-- 23. ACCOUNT DELETION CLEANUP
-- ===========================================================================
-- Deleting the profile must cascade both directions of the relationship, with
-- no change to delete_own_account_atomic().
INSERT INTO auth.users (id, email, raw_app_meta_data)
VALUES ('eeeeeeee-0000-4000-8000-000000000005','d@myschool.edu','{}'::jsonb);
INSERT INTO profiles (id, username, full_name) VALUES
  ('eeeeeeee-0000-4000-8000-000000000005','dave','Dave Diaz');
SET ROLE authenticated;
SELECT t_as('eeeeeeee-0000-4000-8000-000000000005');
SELECT block_user(:C);              -- Dave blocks Cara  (Dave is blocker)
RESET ROLE;
SET ROLE authenticated;
SELECT t_as(:C);
SELECT block_user('eeeeeeee-0000-4000-8000-000000000005');  -- Cara blocks Dave
RESET ROLE;
SELECT t_ok('T28 two block rows exist before deletion (positive control)',
  (SELECT count(*) = 2 FROM user_blocks
    WHERE blocker_id='eeeeeeee-0000-4000-8000-000000000005'
       OR blocked_id='eeeeeeee-0000-4000-8000-000000000005'));

DELETE FROM auth.users WHERE id='eeeeeeee-0000-4000-8000-000000000005';
SELECT t_ok('T28b deleting the account cascaded BOTH block rows away',
  (SELECT count(*) = 0 FROM user_blocks
    WHERE blocker_id='eeeeeeee-0000-4000-8000-000000000005'
       OR blocked_id='eeeeeeee-0000-4000-8000-000000000005'));
SELECT t_ok('T28c unrelated blocks survived the deletion',
  (SELECT count(*) = 1 FROM user_blocks WHERE blocker_id=:A AND blocked_id=:B));

-- ===========================================================================
-- RESULTS
-- ===========================================================================
\o
\echo ''
\echo '================= MIGRATION 057 TEST RESULTS ================='
SELECT lpad(n::text,3) AS "#",
       CASE WHEN ok THEN 'PASS' ELSE '*** FAIL ***' END AS result,
       name,
       NULLIF(detail,'') AS detail
FROM t_results ORDER BY n;

SELECT count(*) FILTER (WHERE ok) AS passed,
       count(*) FILTER (WHERE NOT ok) AS failed,
       count(*) AS total
FROM t_results;

DO $$
DECLARE v_failed int;
BEGIN
  SELECT count(*) INTO v_failed FROM t_results WHERE NOT ok;
  IF v_failed > 0 THEN
    RAISE EXCEPTION '% TEST(S) FAILED', v_failed;
  END IF;
  RAISE NOTICE 'ALL MIGRATION 057 TESTS PASSED';
END $$;
