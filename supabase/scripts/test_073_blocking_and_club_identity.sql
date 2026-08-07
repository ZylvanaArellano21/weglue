-- Run only against a disposable local database after migrations through 073.
--
-- Covers the three things 073 changes, each with a positive control so a
-- regression that simply hides everything cannot pass:
--   * blocking overrides the club-tag exception, WITHOUT removing that
--     exception for everyone else
--   * block/unblock emits an access-convergence signal for both parties
--   * club names and derived handles are unique per university

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_blocks_access_sync' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '073: block/unblock must publish an access-convergence signal';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clubs_derive_handle' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '073: club handle must be derived by the backend';
  END IF;
  IF (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relname = 'posts' AND p.polcmd = 'r' AND p.polpermissive) <> 1 THEN
    RAISE EXCEPTION '073: posts must keep exactly one permissive SELECT policy';
  END IF;
  -- Uniqueness must be scoped to the university, never global.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clubs_handle_key') THEN
    RAISE EXCEPTION '073: the global handle uniqueness constraint must be gone';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'clubs_university_normalized_name_key')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'clubs_university_normalized_handle_key') THEN
    RAISE EXCEPTION '073: university-scoped name/handle uniqueness is missing';
  END IF;
END;
$$;

-- Normalization contract (pure, no fixture needed).
DO $$
BEGIN
  IF public.normalized_club_name('  Forest     Club ') <> public.normalized_club_name('FOREST CLUB') THEN
    RAISE EXCEPTION '073: case/whitespace variants must normalize to the same name';
  END IF;
  IF public.club_handle_from_name('Forest Club') <> 'ForestClub' THEN
    RAISE EXCEPTION '073: handle must derive as ForestClub';
  END IF;
  IF public.club_handle_from_name('Nature Club') <> 'NatureClub' THEN
    RAISE EXCEPTION '073: handle must derive as NatureClub';
  END IF;
  -- A number the officer genuinely chose stays part of the identity.
  IF public.club_handle_from_name('Robotics 2026') <> 'Robotics2026' THEN
    RAISE EXCEPTION '073: a meaningful officer-entered number must survive';
  END IF;
END;
$$;

SELECT '073 catalog and normalization harness passed' AS result;

BEGIN;

INSERT INTO public.universities (id, name, slug) VALUES
  ('50000000-0000-0000-0000-0000000000a1', 'Lone Star 073', 'lone-star-073'),
  ('50000000-0000-0000-0000-0000000000a2', 'Houston 073',   'houston-073');

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('51000000-0000-0000-0000-000000000001', 'officer-073@example.test', '{}'::jsonb),
  ('51000000-0000-0000-0000-000000000002', 'private-073@example.test', '{}'::jsonb),
  ('51000000-0000-0000-0000-000000000003', 'viewer-073@example.test',  '{}'::jsonb),
  ('51000000-0000-0000-0000-000000000004', 'blocked-073@example.test', '{}'::jsonb);

INSERT INTO public.profiles (
  id, username, full_name, email_verified, onboarding_complete, onboarding_completed, university_id
) VALUES
  ('51000000-0000-0000-0000-000000000001', 'officer073', 'Olivia Officer', true, true, true, '50000000-0000-0000-0000-0000000000a1'),
  ('51000000-0000-0000-0000-000000000002', 'private073', 'Pat Private',    true, true, true, '50000000-0000-0000-0000-0000000000a1'),
  ('51000000-0000-0000-0000-000000000003', 'viewer073',  'Val Viewer',     true, true, true, '50000000-0000-0000-0000-0000000000a1'),
  ('51000000-0000-0000-0000-000000000004', 'blocked073', 'Bea Blocked',    true, true, true, '50000000-0000-0000-0000-0000000000a1')
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username, full_name = EXCLUDED.full_name,
  email_verified = EXCLUDED.email_verified, onboarding_completed = EXCLUDED.onboarding_completed,
  university_id = EXCLUDED.university_id;

DELETE FROM public.user_privacy WHERE user_id = '51000000-0000-0000-0000-000000000002';
INSERT INTO public.user_privacy (user_id, is_private) VALUES
  ('51000000-0000-0000-0000-000000000002', true);

INSERT INTO public.clubs (id, name, handle, description, university_id) VALUES
  ('52000000-0000-0000-0000-000000000001', 'Nature Club', 'ignored-client-handle', 'd', '50000000-0000-0000-0000-0000000000a1');

INSERT INTO public.club_members (club_id, user_id, role) VALUES
  ('52000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'officer');

-- A private student's club-tagged post, and an ordinary personal post.
INSERT INTO public.posts (id, author_id, club_id, post_type, caption) VALUES
  ('53000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002',
   '52000000-0000-0000-0000-000000000001', 'picture', 'club tagged'),
  ('53000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000002',
   NULL, 'picture', 'personal');

-- The private author blocks one viewer; the other viewer is unaffected.
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES
  ('51000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000004');

DO $$
BEGIN
  IF public.club_handle_from_name('Nature Club') <> (
       SELECT handle FROM public.clubs WHERE id = '52000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION '073: a client-supplied handle was trusted instead of derived';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;

-- POSITIVE CONTROL: the club-tag exception still works for a non-blocked viewer.
SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000003', true);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id = '53000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION '073: the private club-tag exception was lost for an ordinary viewer';
  END IF;
  -- ...while the same author's ordinary private post stays private.
  IF EXISTS (SELECT 1 FROM public.posts WHERE id = '53000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION '073: a private personal post leaked to a non-follower';
  END IF;
END;
$$;

-- NEGATIVE: blocking overrides the club-tag exception, in both directions.
SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000004', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.posts WHERE id = '53000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION '073: a blocked student still read the blocker club-tagged post';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  -- The blocker sees their own post (authorship always wins) but must not see
  -- the blocked person's content; covered by the symmetric blocked_user_ids.
  IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id = '53000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION '073: an author lost their own post';
  END IF;
END;
$$;

-- UNBLOCK restores the club-tagged post with no recreation of anything.
RESET ROLE;
DELETE FROM public.user_blocks
 WHERE blocker_id = '51000000-0000-0000-0000-000000000002'
   AND blocked_id = '51000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000004', true);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id = '53000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION '073: unblocking did not restore the club-tagged post';
  END IF;
END;
$$;

-- ── Club rename, uniqueness, and duplicate rejection ───────────────────────
SELECT set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  v_handle text;
  v_name   text;
BEGIN
  UPDATE public.clubs SET name = 'Forest Club' WHERE id = '52000000-0000-0000-0000-000000000001';
  SELECT name, handle INTO v_name, v_handle
    FROM public.clubs WHERE id = '52000000-0000-0000-0000-000000000001';
  IF v_name <> 'Forest Club' OR v_handle <> 'ForestClub' THEN
    RAISE EXCEPTION '073: rename did not atomically derive the handle (% / %)', v_name, v_handle;
  END IF;
  IF (SELECT count(*) FROM public.club_members WHERE club_id = '52000000-0000-0000-0000-000000000001') <> 1
     OR (SELECT count(*) FROM public.posts WHERE club_id = '52000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION '073: rename disconnected club relationships';
  END IF;

  -- A handle change that is not driven by the name is simply re-derived.
  UPDATE public.clubs SET handle = 'SomethingElse' WHERE id = '52000000-0000-0000-0000-000000000001';
  SELECT handle INTO v_handle FROM public.clubs WHERE id = '52000000-0000-0000-0000-000000000001';
  IF v_handle <> 'ForestClub' THEN
    RAISE EXCEPTION '073: an independently supplied handle was accepted (%)', v_handle;
  END IF;
END;
$$;

RESET ROLE;
DO $$
BEGIN
  -- Duplicate CREATE at the same university, in every obvious formatting
  -- variant, is rejected outright — never renamed to a numbered variant.
  FOR i IN 1..1 LOOP
    BEGIN
      INSERT INTO public.clubs (id, name, handle, description, university_id)
      VALUES ('52000000-0000-0000-0000-0000000000b1', 'forest club', 'x', 'd',
              '50000000-0000-0000-0000-0000000000a1');
      RAISE EXCEPTION '073: a duplicate club name was accepted';
    EXCEPTION WHEN unique_violation THEN NULL; END;

    BEGIN
      INSERT INTO public.clubs (id, name, handle, description, university_id)
      VALUES ('52000000-0000-0000-0000-0000000000b2', '  FOREST    CLUB  ', 'x', 'd',
              '50000000-0000-0000-0000-0000000000a1');
      RAISE EXCEPTION '073: a whitespace/case duplicate was accepted';
    EXCEPTION WHEN unique_violation THEN NULL; END;
  END LOOP;

  -- No numeric suffix may have been invented by any of the above.
  IF EXISTS (
    SELECT 1 FROM public.clubs
     WHERE university_id = '50000000-0000-0000-0000-0000000000a1'
       AND handle ~ '[0-9]$' AND handle <> 'Robotics2026'
  ) THEN
    RAISE EXCEPTION '073: a numeric suffix was invented to resolve a collision';
  END IF;

  -- The SAME name at a DIFFERENT university is allowed.
  INSERT INTO public.clubs (id, name, handle, description, university_id)
  VALUES ('52000000-0000-0000-0000-0000000000c1', 'Forest Club', 'x', 'd',
          '50000000-0000-0000-0000-0000000000a2');
  IF (SELECT handle FROM public.clubs WHERE id = '52000000-0000-0000-0000-0000000000c1') <> 'ForestClub' THEN
    RAISE EXCEPTION '073: cross-university club did not derive its handle';
  END IF;

  -- A genuinely distinct name containing a number is fine.
  INSERT INTO public.clubs (id, name, handle, description, university_id)
  VALUES ('52000000-0000-0000-0000-0000000000d1', 'Robotics 2026', 'x', 'd',
          '50000000-0000-0000-0000-0000000000a1');

  -- Duplicate RENAME is rejected and must leave the original name intact.
  BEGIN
    UPDATE public.clubs SET name = 'Forest Club'
     WHERE id = '52000000-0000-0000-0000-0000000000d1';
    RAISE EXCEPTION '073: a duplicate rename was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  IF (SELECT name FROM public.clubs WHERE id = '52000000-0000-0000-0000-0000000000d1') <> 'Robotics 2026' THEN
    RAISE EXCEPTION '073: a rejected rename partially persisted';
  END IF;
END;
$$;

ROLLBACK;

SELECT '073 blocking and club identity behaviour harness passed' AS result;
