-- Run only against a disposable local database after migrations through 072.
--
-- Proves the two halves of migration 072 together:
--   POSITIVE — every legitimate officer / owner action still works, including
--              the founder's Nature Club -> Forest Club rename with all club
--              relationships intact.
--   NEGATIVE — no ordinary `authenticated` client can rewrite a protected
--              identity column, on its own or smuggled alongside a legal field.
--
-- Every negative case is a real statement issued as the `authenticated` role
-- with a JWT claim, i.e. exactly what a modified client or a hand-written
-- PostgREST request can send. Nothing here depends on client-side validation.

\set ON_ERROR_STOP on

-- Bridge: the compact 057 fixture omits club/profile columns that 072 protects
-- or that officers legitimately edit. Production has them from 001.
ALTER TABLE public.clubs    ADD COLUMN IF NOT EXISTS description      text;
ALTER TABLE public.clubs    ADD COLUMN IF NOT EXISTS banner_url       text;
ALTER TABLE public.clubs    ADD COLUMN IF NOT EXISTS meeting_location text;
ALTER TABLE public.clubs    ADD COLUMN IF NOT EXISTS meeting_schedule jsonb;
ALTER TABLE public.clubs    ADD COLUMN IF NOT EXISTS is_seed          boolean NOT NULL DEFAULT false;
ALTER TABLE public.clubs    ADD COLUMN IF NOT EXISTS claimed          boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_domain     text;

-- Dependency policies, copied verbatim from the migrations that own them, so the
-- officer-authority half of the positive controls is real rather than stubbed.
-- The compact harness chain applies 057 -> 062 -> 069 -> 070 -> 072 and so does
-- not carry 034 (club_members role updates) or 063 (event officer updates).
-- 072 is about WHICH COLUMNS may change, not about who may update a row, so
-- these are dependencies of the test rather than the subject of it.
-- is_club_officer is owned by 001 and is the caller-bound officer predicate the
-- policies below depend on; recreated verbatim for the compact chain.
CREATE OR REPLACE FUNCTION public.is_club_officer(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_members
     WHERE club_id = p_club_id
       AND user_id = auth.uid()
       AND role = 'officer'
  );
$$;

-- The compact 057 fixture leaves RLS OFF on clubs and club_members. Without
-- this, every "wrong actor is refused" assertion below would pass vacuously
-- because no policy is consulted at all. Production enables RLS on both from
-- 001, so reproduce that before the guard is exercised.
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clubs: anyone authenticated can read" ON public.clubs;
CREATE POLICY "clubs: anyone authenticated can read"
  ON public.clubs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "clubs: officers can update" ON public.clubs;
CREATE POLICY "clubs: officers can update"
  ON public.clubs FOR UPDATE TO authenticated
  USING (is_club_officer(id) AND (SELECT public.current_student_can_access_app()));

DROP POLICY IF EXISTS "club_members: anyone authenticated can read" ON public.club_members;
CREATE POLICY "club_members: anyone authenticated can read"
  ON public.club_members FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "club_members: officers can update roles" ON public.club_members;
CREATE POLICY "club_members: officers can update roles"
  ON public.club_members FOR UPDATE TO authenticated
  USING (
    is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
  )
  WITH CHECK (
    is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
  );

DROP POLICY IF EXISTS "events: officers can update/delete" ON public.events;
CREATE POLICY "events: officers can update/delete"
  ON public.events FOR UPDATE TO authenticated
  USING (
    is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('event', id)
  )
  WITH CHECK (
    is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('event', id)
  );

-- ── Catalog: the guard exists and is not reachable by clients ───────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private' AND p.proname = 'reject_protected_identity_change'
  ) THEN
    RAISE EXCEPTION '072: identity guard function is missing';
  END IF;

  -- SECURITY INVOKER is load-bearing: the guard must observe the role that
  -- really issued the statement, otherwise every SECURITY DEFINER caller would
  -- look like a client and legitimate maintenance would break.
  IF (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'private' AND p.proname = 'reject_protected_identity_change') THEN
    RAISE EXCEPTION '072: identity guard must be SECURITY INVOKER';
  END IF;

  IF has_function_privilege('authenticated', 'private.reject_protected_identity_change()', 'EXECUTE') THEN
    RAISE EXCEPTION '072: identity guard must not be executable by clients';
  END IF;

  FOR i IN 1..1 LOOP
    IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE NOT t.tgisinternal AND t.tgname IN (
           'trg_profiles_protect_identity', 'trg_clubs_protect_identity',
           'trg_events_protect_identity', 'trg_club_members_protect_identity',
           'trg_posts_protect_identity', 'trg_event_rsvps_protect_identity')) <> 6 THEN
      RAISE EXCEPTION '072: expected an identity guard on all six protected tables';
    END IF;
  END LOOP;
END;
$$;

SELECT '072 protected-identity catalog harness passed' AS result;

-- ── Behaviour ───────────────────────────────────────────────────────────────
BEGIN;

-- Names are suffixed because the full 001->073 chain already seeds the real
-- universities and `universities.name` is unique. The compact fixture does not.
INSERT INTO public.universities (id, name, slug) VALUES
  ('40000000-0000-0000-0000-0000000000a1', 'Lone Star College 072', 'lone-star-college-072'),
  ('40000000-0000-0000-0000-0000000000a2', 'Rival University 072',  'rival-university-072');

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('41000000-0000-0000-0000-000000000001', 'officer-072@example.test',   '{}'::jsonb),
  ('41000000-0000-0000-0000-000000000002', 'member-072@example.test',    '{}'::jsonb),
  ('41000000-0000-0000-0000-000000000003', 'outsider-072@example.test',  '{}'::jsonb),
  ('41000000-0000-0000-0000-000000000004', 'other-officer-072@example.test', '{}'::jsonb);

INSERT INTO public.profiles (
  id, username, full_name, email_verified, onboarding_complete, onboarding_completed, university_id
) VALUES
  ('41000000-0000-0000-0000-000000000001', 'officer072',  'Olivia Officer', true, true, true, '40000000-0000-0000-0000-0000000000a1'),
  ('41000000-0000-0000-0000-000000000002', 'member072',   'Marco Member',   true, true, true, '40000000-0000-0000-0000-0000000000a1'),
  ('41000000-0000-0000-0000-000000000003', 'outsider072', 'Nina Outsider',  true, true, true, '40000000-0000-0000-0000-0000000000a1'),
  ('41000000-0000-0000-0000-000000000004', 'other072',    'Otto Other',     true, true, true, '40000000-0000-0000-0000-0000000000a1')
-- ON CONFLICT so this fixture runs on the full 001->073 chain too, where
-- handle_new_user already created a profile row for each auth.users insert.
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username, full_name = EXCLUDED.full_name,
  email_verified = EXCLUDED.email_verified,
  onboarding_complete = EXCLUDED.onboarding_complete,
  onboarding_completed = EXCLUDED.onboarding_completed,
  university_id = EXCLUDED.university_id;

-- "Nature Club" is the founder's worked example; the second club exists so a
-- cross-club move is actually reachable for someone who is an officer of both.
INSERT INTO public.clubs (id, name, handle, university_id, description) VALUES
  ('42000000-0000-0000-0000-000000000001', 'Nature Club', 'nature-club-072', '40000000-0000-0000-0000-0000000000a1', 'fixture'),
  ('42000000-0000-0000-0000-000000000002', 'Other Club',  'other-club-072',  '40000000-0000-0000-0000-0000000000a1', 'fixture');

INSERT INTO public.club_members (club_id, user_id, role) VALUES
  ('42000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'officer'),
  ('42000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000002', 'member'),
  ('42000000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000001', 'officer'),
  ('42000000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000004', 'officer');

INSERT INTO public.events (
  id, club_id, created_by, title, event_date, start_time, end_time, visibility
) VALUES
  ('43000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001',
   '41000000-0000-0000-0000-000000000001', 'Nature Walk', '2099-05-01', '10:00', '12:00', 'everyone');

INSERT INTO public.event_rsvps (event_id, user_id, status) VALUES
  ('43000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000002', 'going');

SET LOCAL ROLE authenticated;

-- ── POSITIVE: the officer keeps full control of club content ───────────────
SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  v_rows int;
  v_id uuid;
BEGIN
  -- The founder's rename, plus the rest of the supported content surface.
  UPDATE public.clubs
     SET name = 'Forest Club',
         description = 'A club about forests',
         banner_url = 'https://example.test/banner.png',
         avatar_url = 'https://example.test/avatar.png',
         meeting_day = 'Tuesday',
         meeting_time_start = '17:00',
         meeting_time_end = '18:00',
         meeting_location = 'North Campus',
         meeting_building = 'B',
         meeting_room = '12'
   WHERE id = '42000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '072: officer could not edit legitimate club content';
  END IF;

  -- The rename must not have disturbed identity or relationships.
  -- Scoped to the fixture university: the full 001->073 chain seeds a real
  -- "Nature Club" at a different university, and 073 makes name uniqueness
  -- university-scoped, so a global name lookup is no longer well defined.
  SELECT id INTO v_id FROM public.clubs
   WHERE name = 'Forest Club' AND university_id = '40000000-0000-0000-0000-0000000000a1';
  IF v_id IS DISTINCT FROM '42000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION '072: club id changed during a rename';
  END IF;
  IF (SELECT university_id FROM public.clubs WHERE id = v_id)
       IS DISTINCT FROM '40000000-0000-0000-0000-0000000000a1' THEN
    RAISE EXCEPTION '072: rename disturbed the university assignment';
  END IF;
  IF (SELECT count(*) FROM public.club_members WHERE club_id = v_id) <> 2 THEN
    RAISE EXCEPTION '072: rename disconnected club members';
  END IF;
  IF (SELECT count(*) FROM public.club_members WHERE club_id = v_id AND role = 'officer') <> 1 THEN
    RAISE EXCEPTION '072: rename disconnected club officers';
  END IF;
  IF (SELECT count(*) FROM public.events WHERE club_id = v_id) <> 1 THEN
    RAISE EXCEPTION '072: rename disconnected club events';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs
                  WHERE name = 'Forest Club'
                    AND university_id = '40000000-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION '072: renamed club is not findable by its new name';
  END IF;
  IF EXISTS (SELECT 1 FROM public.clubs
              WHERE name = 'Nature Club'
                AND university_id = '40000000-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION '072: the old club name still resolves after a rename';
  END IF;

  -- Soft delete is an officer content action on mobile; it must keep working.
  UPDATE public.clubs SET is_active = false WHERE id = v_id;
  UPDATE public.clubs SET is_active = true  WHERE id = v_id;

  -- Officer event editing and officer role management stay available.
  UPDATE public.events SET title = 'Forest Walk'
   WHERE id = '43000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '072: officer could not edit event content'; END IF;

  UPDATE public.club_members SET role = 'officer'
   WHERE club_id = '42000000-0000-0000-0000-000000000001'
     AND user_id = '41000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '072: officer could not change a member role'; END IF;
  UPDATE public.club_members SET role = 'member'
   WHERE club_id = '42000000-0000-0000-0000-000000000001'
     AND user_id = '41000000-0000-0000-0000-000000000002';
END;
$$;

-- ── NEGATIVE: protected club identity ──────────────────────────────────────
DO $$
DECLARE
  v_name text;
BEGIN
  BEGIN
    UPDATE public.clubs SET university_id = '40000000-0000-0000-0000-0000000000a2'
     WHERE id = '42000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '072: officer moved a club to another university';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE public.clubs SET created_at = '2000-01-01'
     WHERE id = '42000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '072: officer rewrote club created_at';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE public.clubs SET member_count = 99999
     WHERE id = '42000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '072: officer rewrote the system member counter';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE public.clubs SET is_seed = true
     WHERE id = '42000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '072: officer flipped the seed flag';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE public.clubs SET id = '42000000-0000-0000-0000-0000000000ee'
     WHERE id = '42000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '072: officer rewrote a club primary key';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- A manipulated MIXED request must not half-apply: the legal column must not
  -- persist when a protected column rides along in the same statement.
  BEGIN
    UPDATE public.clubs
       SET name = 'Smuggled Name',
           university_id = '40000000-0000-0000-0000-0000000000a2'
     WHERE id = '42000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '072: mixed manipulated club update was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  SELECT name INTO v_name FROM public.clubs WHERE id = '42000000-0000-0000-0000-000000000001';
  IF v_name <> 'Forest Club' THEN
    RAISE EXCEPTION '072: a rejected mixed request still persisted its legal field (%)', v_name;
  END IF;
END;
$$;

-- ── NEGATIVE: protected event / membership identity ────────────────────────
DO $$
BEGIN
  BEGIN
    UPDATE public.events SET created_by = '41000000-0000-0000-0000-000000000003'
     WHERE id = '43000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '072: officer reassigned event authorship';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE public.events SET club_id = '42000000-0000-0000-0000-000000000002'
     WHERE id = '43000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '072: officer moved an event to another club';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE public.events SET id = '43000000-0000-0000-0000-0000000000ee'
     WHERE id = '43000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '072: officer rewrote an event primary key';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE public.club_members SET user_id = '41000000-0000-0000-0000-000000000003'
     WHERE club_id = '42000000-0000-0000-0000-000000000001'
       AND user_id = '41000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION '072: officer reassigned a membership to another person';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE public.club_members SET club_id = '42000000-0000-0000-0000-000000000002'
     WHERE club_id = '42000000-0000-0000-0000-000000000001'
       AND user_id = '41000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION '072: officer moved a membership to another club';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;

-- ── NEGATIVE: wrong actors ─────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  v_rows int;
BEGIN
  -- Ordinary member of THIS club.
  UPDATE public.clubs SET name = 'Member Rename' WHERE id = '42000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION '072: an ordinary member edited the club'; END IF;

  -- Self-promotion to officer.
  UPDATE public.club_members SET role = 'officer'
   WHERE club_id = '42000000-0000-0000-0000-000000000001' AND user_id = auth.uid();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION '072: a member promoted itself to officer'; END IF;

  -- Self-asserted account state.
  BEGIN
    UPDATE public.profiles SET email_verified = false WHERE id = auth.uid();
    RAISE EXCEPTION '072: a student rewrote its own verification state';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  BEGIN
    UPDATE public.profiles SET university_id = '40000000-0000-0000-0000-0000000000a2'
     WHERE id = auth.uid();
    RAISE EXCEPTION '072: a student moved itself to another university';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- The RSVP row's own identity is fixed even though its status is not.
  UPDATE public.event_rsvps SET status = 'cant'
   WHERE event_id = '43000000-0000-0000-0000-000000000001' AND user_id = auth.uid();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '072: owner could not change its own RSVP status'; END IF;

  BEGIN
    UPDATE public.event_rsvps SET id = gen_random_uuid()
     WHERE event_id = '43000000-0000-0000-0000-000000000001' AND user_id = auth.uid();
    RAISE EXCEPTION '072: owner rewrote an RSVP primary key';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Legitimate self-service still works.
  UPDATE public.profiles SET full_name = 'Marco Renamed' WHERE id = auth.uid();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '072: a student could not edit its own display name'; END IF;
END;
$$;

-- Outsider, and an officer of a DIFFERENT club, are both refused.
SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE v_rows int;
BEGIN
  UPDATE public.clubs SET name = 'Outsider Rename' WHERE id = '42000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION '072: a non-member edited the club'; END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE v_rows int;
BEGIN
  UPDATE public.clubs SET name = 'Cross Club Rename' WHERE id = '42000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION '072: an officer of another club edited this club'; END IF;
END;
$$;

-- Former officer: demotion takes effect on the very next request.
RESET ROLE;
-- The full 001->073 chain carries migration 054's last-officer protection, which
-- the compact 057 fixture does not. Promote the existing member first so the
-- club never reaches zero officers. This is a fixture requirement; the assertion
-- below is still solely about the demoted officer losing authority immediately.
UPDATE public.club_members SET role = 'officer'
 WHERE club_id = '42000000-0000-0000-0000-000000000001'
   AND user_id = '41000000-0000-0000-0000-000000000002';
UPDATE public.club_members SET role = 'member'
 WHERE club_id = '42000000-0000-0000-0000-000000000001'
   AND user_id = '41000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE v_rows int;
BEGIN
  UPDATE public.clubs SET name = 'Former Officer Rename'
   WHERE id = '42000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION '072: a former officer still edited the club'; END IF;
END;
$$;

RESET ROLE;
ROLLBACK;

SELECT '072 protected-identity behaviour harness passed' AS result;
