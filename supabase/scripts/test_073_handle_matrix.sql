-- =============================================================================
-- Migration 073 — CLUB HANDLE MATRIX (26 cases)
--
-- Run against a disposable local database on the FULL 001->074 chain with
-- test_full_chain_grants_bridge.sql applied first.
--
-- This VERIFIES the shipped 073 implementation; it does not redesign it. Every
-- case is a real statement, and the officer cases are issued as the ordinary
-- `authenticated` role with a JWT claim — i.e. exactly what a modified client or
-- a hand-written PostgREST request can send.
--
-- The point of the "subtle" cases is that an unrelated edit (description,
-- avatar, banner, meeting info) must NOT disturb the handle, and that a client
-- can never persist a handle it chose itself.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.universities (id, name, slug) VALUES
  ('70000000-0000-0000-0000-0000000000a1', 'Handle Matrix U A', 'handle-matrix-u-a'),
  ('70000000-0000-0000-0000-0000000000a2', 'Handle Matrix U B', 'handle-matrix-u-b');

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('71000000-0000-0000-0000-000000000001', 'officer-hm@example.test', '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000002', 'member-hm@example.test',  '{}'::jsonb);

INSERT INTO public.profiles (
  id, username, full_name, email_verified, onboarding_complete, onboarding_completed, university_id
) VALUES
  ('71000000-0000-0000-0000-000000000001', 'officerhm', 'Olivia Officer', true, true, true, '70000000-0000-0000-0000-0000000000a1'),
  ('71000000-0000-0000-0000-000000000002', 'memberhm',  'Marco Member',   true, true, true, '70000000-0000-0000-0000-0000000000a1')
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username, full_name = EXCLUDED.full_name,
  email_verified = EXCLUDED.email_verified,
  onboarding_complete = EXCLUDED.onboarding_complete,
  onboarding_completed = EXCLUDED.onboarding_completed,
  university_id = EXCLUDED.university_id;

DO $$
DECLARE
  v_handle   text;
  v_name     text;
  v_id       uuid;
  v_uni      uuid;
  v_created  timestamptz;
  v_case     int := 0;
BEGIN
  -- ── 1. CREATE derives the handle from the entered name ────────────────────
  --      A deliberately wrong client-supplied handle is passed in to prove it
  --      is overwritten rather than trusted.
  INSERT INTO public.clubs (id, name, handle, description, university_id)
  VALUES ('72000000-0000-0000-0000-000000000001', 'Nature Club', 'whatever-the-client-sent',
          'seed description', '70000000-0000-0000-0000-0000000000a1');
  SELECT handle INTO v_handle FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001';
  IF v_handle <> 'NatureClub' THEN
    RAISE EXCEPTION 'case 1/2: create did not derive the handle (got %)', v_handle;
  END IF;
  -- ── 2. Nature Club -> NatureClub (asserted above) ─────────────────────────

  -- ── 4. A meaningful officer-entered number survives ───────────────────────
  INSERT INTO public.clubs (id, name, handle, description, university_id)
  VALUES ('72000000-0000-0000-0000-000000000002', 'Robotics 2026', 'x', 'd',
          '70000000-0000-0000-0000-0000000000a1');
  SELECT handle INTO v_handle FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000002';
  IF v_handle <> 'Robotics2026' THEN
    RAISE EXCEPTION 'case 4: an officer-entered number was lost (got %)', v_handle;
  END IF;

  -- Record the pre-rename identity so cases 18-24 can prove it is unchanged.
  SELECT id, university_id, created_at INTO v_id, v_uni, v_created
    FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001';
END;
$$;

-- Relationships that must survive a rename: members, officers, posts, events,
-- and a club conversation with a message in it.
INSERT INTO public.club_members (club_id, user_id, role) VALUES
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'officer'),
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'member');

INSERT INTO public.posts (id, author_id, club_id, post_type, caption) VALUES
  ('73000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001',
   '72000000-0000-0000-0000-000000000001', 'picture', 'club post');

INSERT INTO public.events (id, club_id, created_by, title, event_date, start_time, end_time, visibility)
VALUES ('74000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001',
        '71000000-0000-0000-0000-000000000001', 'Club event', '2099-03-03', '10:00', '12:00', 'everyone');

INSERT INTO public.conversations (id, type, club_id, name, created_by)
VALUES ('75000000-0000-0000-0000-000000000001', 'club_group', '72000000-0000-0000-0000-000000000001',
        'Club chat', '71000000-0000-0000-0000-000000000001');
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  ('75000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001'),
  ('75000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002');
INSERT INTO public.messages (id, conversation_id, sender_id, content, message_type)
VALUES ('76000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001',
        '71000000-0000-0000-0000-000000000001', 'hello club', 'text');

-- Cross-university twin, created BEFORE the rename so cases 16/17 are real.
INSERT INTO public.clubs (id, name, handle, description, university_id)
VALUES ('72000000-0000-0000-0000-0000000000b1', 'Forest Club', 'x', 'd',
        '70000000-0000-0000-0000-0000000000a2');

-- Everything below runs as an ordinary authenticated OFFICER.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);

DO $$
DECLARE
  v_handle  text;
  v_name    text;
  v_uni     uuid;
  v_created timestamptz;
  v_rows    int;
BEGIN
  -- ── 5. Rename updates name AND handle atomically ─────────────────────────
  UPDATE public.clubs SET name = 'Forest Club'
   WHERE id = '72000000-0000-0000-0000-000000000001';
  SELECT name, handle INTO v_name, v_handle
    FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001';
  IF v_name <> 'Forest Club' OR v_handle <> 'ForestClub' THEN
    RAISE EXCEPTION 'case 5/3: rename was not atomic (% / %)', v_name, v_handle;
  END IF;
  -- ── 3. Forest Club -> ForestClub (asserted above) ────────────────────────

  -- ── 6. Description-only update leaves the handle alone ───────────────────
  UPDATE public.clubs SET description = 'a new description'
   WHERE id = '72000000-0000-0000-0000-000000000001';
  SELECT name, handle INTO v_name, v_handle
    FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001';
  IF v_handle <> 'ForestClub' OR v_name <> 'Forest Club' THEN
    RAISE EXCEPTION 'case 6: a description-only edit changed the identity (% / %)', v_name, v_handle;
  END IF;

  -- ── 7. "Bio"-only update. `clubs` has no bio column; description IS the
  --      club bio, so this asserts the same column a second way (a longer,
  --      multi-line value) rather than inventing a column that does not exist.
  UPDATE public.clubs SET description = E'Line one\nLine two — the club bio.'
   WHERE id = '72000000-0000-0000-0000-000000000001';
  SELECT handle INTO v_handle FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001';
  IF v_handle <> 'ForestClub' THEN
    RAISE EXCEPTION 'case 7: a bio-only edit changed the handle (%)', v_handle;
  END IF;

  -- ── 8. Profile-image-only update ─────────────────────────────────────────
  UPDATE public.clubs SET avatar_url = 'https://cdn.example.test/avatar.png'
   WHERE id = '72000000-0000-0000-0000-000000000001';
  SELECT handle INTO v_handle FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001';
  IF v_handle <> 'ForestClub' THEN
    RAISE EXCEPTION 'case 8: an avatar-only edit changed the handle (%)', v_handle;
  END IF;

  -- ── 9. Banner-only update (and cover image, the other banner surface) ────
  UPDATE public.clubs SET banner_url = 'https://cdn.example.test/banner.png'
   WHERE id = '72000000-0000-0000-0000-000000000001';
  UPDATE public.clubs SET cover_image_url = 'https://cdn.example.test/cover.png'
   WHERE id = '72000000-0000-0000-0000-000000000001';
  SELECT handle INTO v_handle FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001';
  IF v_handle <> 'ForestClub' THEN
    RAISE EXCEPTION 'case 9: a banner-only edit changed the handle (%)', v_handle;
  END IF;

  -- ── 10. Meeting-information-only update, every meeting_* column at once ──
  UPDATE public.clubs
     SET meeting_day = 'Tuesday',
         meeting_time_start = '17:00',
         meeting_time_end   = '18:30',
         meeting_location   = 'Building B',
         meeting_building   = 'B',
         meeting_room       = '204',
         meeting_schedule   = '{"cadence":"weekly"}'::jsonb
   WHERE id = '72000000-0000-0000-0000-000000000001';
  SELECT name, handle INTO v_name, v_handle
    FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001';
  IF v_handle <> 'ForestClub' OR v_name <> 'Forest Club' THEN
    RAISE EXCEPTION 'case 10: a meeting-info edit changed the identity (% / %)', v_name, v_handle;
  END IF;

  -- ── 11. A direct handle-only update cannot persist an arbitrary handle ───
  UPDATE public.clubs SET handle = 'TotallyDifferent'
   WHERE id = '72000000-0000-0000-0000-000000000001';
  SELECT handle INTO v_handle FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001';
  IF v_handle <> 'ForestClub' THEN
    RAISE EXCEPTION 'case 11: a client-chosen handle persisted (%)', v_handle;
  END IF;

  -- ── 12. name + FORGED handle in one statement: the name is honoured and the
  --        handle is re-derived, so only the correct handle can persist.
  UPDATE public.clubs SET name = 'Forest Club Two', handle = 'ForgedHandle'
   WHERE id = '72000000-0000-0000-0000-000000000001';
  SELECT name, handle INTO v_name, v_handle
    FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001';
  IF v_name <> 'Forest Club Two' OR v_handle <> 'ForestClubTwo' THEN
    RAISE EXCEPTION 'case 12: a forged handle survived alongside a rename (% / %)', v_name, v_handle;
  END IF;
  -- Put the name back for the remaining cases.
  UPDATE public.clubs SET name = 'Forest Club'
   WHERE id = '72000000-0000-0000-0000-000000000001';
END;
$$;

RESET ROLE;

-- ── 13/14/15. Duplicates are rejected WHOLE, and never numbered ────────────
DO $$
DECLARE
  v_name text;
BEGIN
  -- 14. Duplicate CREATE at the same university, in several formatting variants.
  BEGIN
    INSERT INTO public.clubs (id, name, handle, description, university_id)
    VALUES ('72000000-0000-0000-0000-0000000000c1', 'forest club', 'x', 'd',
            '70000000-0000-0000-0000-0000000000a1');
    RAISE EXCEPTION 'case 14: a duplicate club name was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  BEGIN
    INSERT INTO public.clubs (id, name, handle, description, university_id)
    VALUES ('72000000-0000-0000-0000-0000000000c2', '  FOREST    CLUB  ', 'x', 'd',
            '70000000-0000-0000-0000-0000000000a1');
    RAISE EXCEPTION 'case 14: a whitespace/case duplicate was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- A DIFFERENT name that derives the SAME handle must also be refused, or the
  -- handle index would be the only thing standing between two identical slugs.
  BEGIN
    INSERT INTO public.clubs (id, name, handle, description, university_id)
    VALUES ('72000000-0000-0000-0000-0000000000c3', 'Forest-Club', 'x', 'd',
            '70000000-0000-0000-0000-0000000000a1');
    RAISE EXCEPTION 'case 14: a different name deriving a duplicate handle was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 13. Duplicate RENAME rejects the WHOLE statement and persists nothing.
  BEGIN
    UPDATE public.clubs SET name = 'Forest Club', description = 'should not persist'
     WHERE id = '72000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'case 13: a duplicate rename was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  SELECT name INTO v_name FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000002';
  IF v_name <> 'Robotics 2026' THEN
    RAISE EXCEPTION 'case 13: a rejected rename partially persisted (%)', v_name;
  END IF;
  IF (SELECT description FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000002')
       = 'should not persist' THEN
    RAISE EXCEPTION 'case 13: a rejected rename persisted its other columns';
  END IF;

  -- 15. NO numeric suffix was invented anywhere. Only the club whose real name
  --     contains a number may end in one.
  IF EXISTS (
    SELECT 1 FROM public.clubs
     WHERE university_id IN ('70000000-0000-0000-0000-0000000000a1',
                             '70000000-0000-0000-0000-0000000000a2')
       AND handle ~ '[0-9]$'
       AND handle <> 'Robotics2026'
  ) THEN
    RAISE EXCEPTION 'case 15: a numeric suffix was invented to resolve a collision';
  END IF;
END;
$$;

-- ── 16/17. The same normalized name AND the same derived handle are allowed
--           at a DIFFERENT university. This is what 073 exists to permit.
DO $$
DECLARE v_handle text;
BEGIN
  SELECT handle INTO v_handle FROM public.clubs WHERE id = '72000000-0000-0000-0000-0000000000b1';
  IF v_handle <> 'ForestClub' THEN
    RAISE EXCEPTION 'case 16/17: the cross-university twin did not derive its handle (%)', v_handle;
  END IF;
  IF (SELECT count(*) FROM public.clubs WHERE handle = 'ForestClub') <> 2 THEN
    RAISE EXCEPTION 'case 17: two universities cannot both hold the same handle';
  END IF;
  IF (SELECT count(DISTINCT university_id) FROM public.clubs WHERE handle = 'ForestClub') <> 2 THEN
    RAISE EXCEPTION 'case 16: the twin clubs are not at different universities';
  END IF;
END;
$$;

-- ── 18-24. Identity and every relationship survived every rename above ─────
DO $$
DECLARE v_uni uuid;
BEGIN
  -- 18. Internal club id unchanged (the row is still reachable by its id).
  IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'case 18: the club id changed during renaming';
  END IF;

  -- 19. university_id unchanged.
  SELECT university_id INTO v_uni FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001';
  IF v_uni IS DISTINCT FROM '70000000-0000-0000-0000-0000000000a1' THEN
    RAISE EXCEPTION 'case 19: university_id changed during renaming (%)', v_uni;
  END IF;

  -- 20/21. Members and officers still attached.
  IF (SELECT count(*) FROM public.club_members
       WHERE club_id = '72000000-0000-0000-0000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'case 20: renaming disconnected club members';
  END IF;
  IF (SELECT count(*) FROM public.club_members
       WHERE club_id = '72000000-0000-0000-0000-000000000001' AND role = 'officer') <> 1 THEN
    RAISE EXCEPTION 'case 21: renaming disconnected club officers';
  END IF;

  -- 22/23. Posts and events still attached.
  IF (SELECT count(*) FROM public.posts
       WHERE club_id = '72000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'case 22: renaming disconnected club posts';
  END IF;
  IF (SELECT count(*) FROM public.events
       WHERE club_id = '72000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'case 23: renaming disconnected club events';
  END IF;

  -- 24. Conversations and their messages still attached. The club's own
  --      official chats are created by an existing trigger on club insert, so
  --      this asserts the SPECIFIC seeded conversation rather than a count.
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
     WHERE id = '75000000-0000-0000-0000-000000000001'
       AND club_id = '72000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'case 24: renaming disconnected the club conversation';
  END IF;
  IF (SELECT count(*) FROM public.conversations
       WHERE club_id = '72000000-0000-0000-0000-000000000001') < 1 THEN
    RAISE EXCEPTION 'case 24: renaming detached every club conversation';
  END IF;
  IF (SELECT count(*) FROM public.messages
       WHERE conversation_id = '75000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'case 24: renaming disconnected club chat history';
  END IF;
END;
$$;

-- ── 25. Search finds the club by its NEW current name, not the old one ─────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.clubs
     WHERE university_id = '70000000-0000-0000-0000-0000000000a1'
       AND name ILIKE '%Forest%'
       AND id = '72000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'case 25: the renamed club is not findable by its new name';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.clubs
     WHERE university_id = '70000000-0000-0000-0000-0000000000a1'
       AND name ILIKE '%Nature%'
  ) THEN
    RAISE EXCEPTION 'case 25: the OLD club name still resolves after a rename';
  END IF;
END;
$$;

-- ── 26. Existing id-based routes and references keep working. Every club read
--        path in both clients is keyed by the immutable id (a repo-wide grep
--        found no handle-based lookup), so this exercises the id-keyed reads a
--        route would perform after the handle changed underneath it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = '72000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'case 26: an id-keyed club route stopped resolving';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.get_club_profile_events('72000000-0000-0000-0000-000000000001')
  ) THEN
    RAISE EXCEPTION 'case 26: the id-keyed club profile RPC stopped returning events';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_shared_identities('72000000-0000-0000-0000-000000000001')
  ) THEN
    RAISE EXCEPTION 'case 26: the id-keyed shared-identity reader stopped resolving';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;

SELECT '073 handle matrix passed — all 26 cases' AS result;
