-- Migration 062 focused harness (throwaway DB only; never Production).
--
-- Load test_057_fixture_schema.sql first — it reproduces the production shape
-- of profiles / user_privacy / follows / clubs / club_members / posts, enables
-- RLS on posts, installs the ORIGINAL "posts: anyone authenticated can read"
-- policy, and drives auth.uid() from the request.jwt.claims GUC. Then apply
-- migrations/062_private_account_posts.sql, then run this file.
--
-- The point of the harness is that every assertion is made AS A STUDENT, over
-- real RLS, through the `authenticated` role — not as the owner. An assertion
-- run as a superuser would pass no matter what the policy said.

\set ON_ERROR_STOP on
\pset pager off

CREATE TABLE t062_results (name text PRIMARY KEY, ok boolean NOT NULL);

-- SECURITY DEFINER so an assertion can be recorded while the session is running
-- as `authenticated` or `service_role`, which is the whole point of this
-- harness. It records results only; it never reads the tables under test, so it
-- cannot mask a policy failure.
CREATE OR REPLACE FUNCTION t062_ok(p_name text, p_ok boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN INSERT INTO t062_results VALUES (p_name, coalesce(p_ok,false)); END; $$;
GRANT EXECUTE ON FUNCTION t062_ok(text, boolean) TO authenticated, service_role;

-- ── Cast ───────────────────────────────────────────────────────────────────
--   PRIV     a private student
--   PUB      a public student
--   FOLLOWER an ACCEPTED follower of PRIV
--   PENDING  a student whose follow request to PRIV is still pending
--   STRANGER no relationship to PRIV at all
\set PRIV     '''aa000000-0000-4000-8000-000000000001'''
\set PUB      '''aa000000-0000-4000-8000-000000000002'''
\set FOLLOWER '''aa000000-0000-4000-8000-000000000003'''
\set PENDING  '''aa000000-0000-4000-8000-000000000004'''
\set STRANGER '''aa000000-0000-4000-8000-000000000005'''
\set CLUB     '''cc000000-0000-4000-8000-000000000001'''

INSERT INTO auth.users (id, email) VALUES
  (:PRIV,'priv-062@test.invalid'), (:PUB,'pub-062@test.invalid'),
  (:FOLLOWER,'fol-062@test.invalid'), (:PENDING,'pen-062@test.invalid'),
  (:STRANGER,'str-062@test.invalid');

INSERT INTO public.profiles (id, username, full_name) VALUES
  (:PRIV,'priv062','Private Student'), (:PUB,'pub062','Public Student'),
  (:FOLLOWER,'fol062','Follower'), (:PENDING,'pen062','Pending'),
  (:STRANGER,'str062','Stranger');

-- PRIV is private; PUB is explicitly public (a real row, not just an absent one,
-- so clause 3 is exercised against a present-but-false row as well).
INSERT INTO public.user_privacy (user_id, is_private) VALUES
  (:PRIV, true), (:PUB, false);

INSERT INTO public.follows (follower_id, following_id, status) VALUES
  (:FOLLOWER, :PRIV, 'accepted'),
  (:PENDING,  :PRIV, 'pending');

INSERT INTO public.clubs (id, name) VALUES (:CLUB, 'Test Club 062');

-- Four posts: PRIV personal, PRIV official (club), PUB personal, and a PRIV
-- personal post used for the direct-id ("direct URL") probe.
INSERT INTO public.posts (id, author_id, club_id, post_type, image_url, caption) VALUES
  ('dd000000-0000-4000-8000-000000000001', :PRIV, NULL,  'picture','u1','private personal'),
  ('dd000000-0000-4000-8000-000000000002', :PRIV, :CLUB, 'picture','u2','private official'),
  ('dd000000-0000-4000-8000-000000000003', :PUB,  NULL,  'picture','u3','public personal'),
  ('dd000000-0000-4000-8000-000000000004', :PRIV, NULL,  'picture','u4','private direct-url target');

-- Everything below runs as a student, never as the table owner.
SET ROLE authenticated;

-- ── 1. The leak this migration exists to close ─────────────────────────────
SELECT set_config('request.jwt.claims', json_build_object('sub', :STRANGER)::text, false);
SELECT t062_ok('stranger cannot read a private account''s personal post',
  NOT EXISTS (SELECT 1 FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000001'));

SELECT t062_ok('stranger cannot reach it by direct id either (direct-URL case)',
  (SELECT count(*) FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000004') = 0);

SELECT t062_ok('stranger sees NONE of the private account''s personal posts in a feed-shaped scan',
  (SELECT count(*) FROM public.posts WHERE author_id=:PRIV AND club_id IS NULL) = 0);

-- ── 2. What must KEEP working (over-blocking regressions) ──────────────────
SELECT t062_ok('stranger still reads a public account''s personal post',
  EXISTS (SELECT 1 FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000003'));

SELECT t062_ok('official club content stays visible even though its author is private',
  EXISTS (SELECT 1 FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000002'));

-- ── 3. Accepted follower gets in; pending request does not ─────────────────
SELECT set_config('request.jwt.claims', json_build_object('sub', :FOLLOWER)::text, false);
SELECT t062_ok('accepted follower reads the private account''s personal post',
  EXISTS (SELECT 1 FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000001'));

SELECT set_config('request.jwt.claims', json_build_object('sub', :PENDING)::text, false);
SELECT t062_ok('PENDING follow request grants no access',
  NOT EXISTS (SELECT 1 FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000001'));

-- ── 4. The author never loses their own content ────────────────────────────
SELECT set_config('request.jwt.claims', json_build_object('sub', :PRIV)::text, false);
SELECT t062_ok('private author still reads all four of their own + club posts',
  (SELECT count(*) FROM public.posts WHERE author_id=:PRIV) = 3);

SELECT t062_ok('private author reads their own personal post',
  EXISTS (SELECT 1 FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000001'));

-- ── 5. Toggling privacy is immediately effective in both directions ────────
RESET ROLE;
UPDATE public.user_privacy SET is_private = false WHERE user_id = :PRIV;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :STRANGER)::text, false);
SELECT t062_ok('going public re-exposes the personal post immediately',
  EXISTS (SELECT 1 FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000001'));

RESET ROLE;
UPDATE public.user_privacy SET is_private = true WHERE user_id = :PRIV;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :STRANGER)::text, false);
SELECT t062_ok('going private hides it again immediately',
  NOT EXISTS (SELECT 1 FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000001'));

-- ── 6. An author with NO user_privacy row at all is treated as public ──────
--    Most accounts never touch a privacy control, so the absent-row path is the
--    common case and must not accidentally hide the whole campus feed.
RESET ROLE;
INSERT INTO auth.users (id,email) VALUES ('aa000000-0000-4000-8000-000000000006','norow-062@test.invalid');
INSERT INTO public.profiles (id,username,full_name) VALUES ('aa000000-0000-4000-8000-000000000006','norow062','No Privacy Row');
INSERT INTO public.posts (id,author_id,club_id,post_type,image_url,caption)
  VALUES ('dd000000-0000-4000-8000-000000000005','aa000000-0000-4000-8000-000000000006',NULL,'picture','u5','no privacy row');
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :STRANGER)::text, false);
SELECT t062_ok('author with no user_privacy row is treated as public',
  EXISTS (SELECT 1 FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000005'));

-- ── 7. Writes are untouched by this migration ──────────────────────────────
SELECT set_config('request.jwt.claims', json_build_object('sub', :PRIV)::text, false);
-- A data-modifying CTE may not be nested inside an expression, so the delete
-- runs on its own and the assertion checks the row is gone afterwards.
DELETE FROM public.posts WHERE id = 'dd000000-0000-4000-8000-000000000004';
SELECT t062_ok('private author can still delete their own post',
  NOT EXISTS (SELECT 1 FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000004'));

-- ── 8. service_role (the Admin Dashboard) still sees everything ────────────
RESET ROLE;
SET ROLE service_role;
SELECT t062_ok('service_role still reads the private personal post (admin moderation)',
  EXISTS (SELECT 1 FROM public.posts WHERE id='dd000000-0000-4000-8000-000000000001'));
RESET ROLE;

-- ── Report ─────────────────────────────────────────────────────────────────
SELECT name, ok FROM t062_results ORDER BY name;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) AS total FROM t062_results;

DO $$
DECLARE failed int;
BEGIN
  SELECT count(*) INTO failed FROM t062_results WHERE NOT ok;
  IF failed > 0 THEN
    RAISE EXCEPTION '062 harness failed: % assertion(s)', failed;
  END IF;
END $$;
