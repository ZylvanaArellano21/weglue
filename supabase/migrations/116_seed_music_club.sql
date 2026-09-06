-- 116 — Seed the Music Club at Lone Star College (ledger reconciliation).
--
-- WHAT THIS IS
-- Production's migration ledger recorded version 116 as `seed_music_club` on
-- 2026-09-03, run directly against production from an out-of-sync worktree (the
-- file lived only on the unmerged PR #93 branch `chore/seed-math-society-club`,
-- commit c9d5f38a). The ledger row for 116 was later removed by hand, leaving an
-- unexplained gap while the Music Club row itself stayed live.
--
-- This commits the authentic migration back into the repository so version 116
-- has a real file again. The body is byte-for-byte the c9d5f38a original EXCEPT
-- the "already exists" guard, which is changed from RAISE EXCEPTION to a clean
-- skip so re-applying this on production (where Music Club already exists, now
-- with a different claimed officer) is a safe no-op and simply re-records the
-- missing ledger row. No production history is rewritten and no existing
-- migration row is deleted.
--
-- See docs/audits/migration-ledger-reconciliation.md.

DO $$
DECLARE
  v_university_id UUID;
  v_zylvana       UUID;
  v_zylvana_name  TEXT;
  v_music         UUID;
BEGIN
  SELECT id INTO v_university_id FROM universities WHERE name = 'Lone Star College';
  IF v_university_id IS NULL THEN
    RAISE EXCEPTION 'Lone Star College university not found';
  END IF;

  -- Idempotent: if the Music Club already exists at this university (it does, in
  -- production), this migration is a no-op — it exists to reconcile the ledger,
  -- not to duplicate the club.
  IF EXISTS (
    SELECT 1 FROM clubs
    WHERE lower(name) = 'music club' AND university_id = v_university_id
  ) THEN
    RAISE NOTICE 'Music Club already present at Lone Star College — skipping seed (ledger reconciliation only)';
    RETURN;
  END IF;

  SELECT id, COALESCE(NULLIF(btrim(full_name), ''), username)
    INTO v_zylvana, v_zylvana_name
    FROM profiles WHERE username = 'zylvana21';
  IF v_zylvana IS NULL THEN
    RAISE EXCEPTION 'zylvana21 profile not found';
  END IF;

  -- member_count starts at 0; the club_members INSERT trigger (update_club_member_count)
  -- increments it to 1 when zylvana21 is added below.
  INSERT INTO clubs (name, description, university_id, is_seed, claimed, is_active, member_count)
  VALUES (
    'Music Club',
    'A community for students who love making and sharing music. Members jam together, '
    || 'form ensembles and bands, run open-mic nights and showcases, swap gear and technique, '
    || 'and explore how music connects to careers in performance, production, and the arts.',
    v_university_id, false, false, true, 0
  )
  RETURNING id INTO v_music;

  INSERT INTO club_members (club_id, user_id, role)
  VALUES (v_music, v_zylvana, 'officer');

  INSERT INTO club_officers (club_id, user_id, display_name, role_title, display_order)
  VALUES (v_music, v_zylvana, v_zylvana_name, 'President', 0);

  RAISE NOTICE 'Music Club club id=%', v_music;
END $$;
