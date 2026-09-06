-- ===========================================================================
-- reconcile_ledger_116.sql — restore the missing production ledger row for
-- version 116 (`seed_music_club`).  MANUAL FALLBACK ONLY.
-- ===========================================================================
--
-- CONTEXT
-- Production applied `116 = seed_music_club` on 2026-09-03 (Music Club is live),
-- then the ledger row was removed by hand, leaving version 116 as an
-- unexplained gap.  `supabase/migrations/116_seed_music_club.sql` is restored to
-- the repo BYTE-IDENTICAL to what production originally ran (commit c9d5f38a) —
-- it is NOT modified to be re-runnable.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PREFERRED MECHANISM — Supabase CLI  (use this, not the SQL below)
--
--     supabase migration repair --linked --status applied 116
--
--   • Reads supabase/migrations/116_seed_music_club.sql from the checkout.
--   • INSERTs the ledger row (version='116', name='seed_music_club',
--     statements = [<file text>]) WITHOUT executing the SQL.
--   • Verified 2026-09-05 against a disposable ledger DB: writes exactly the row
--     format Supabase expects (1-element `statements` array, trailing `;`
--     stripped so the element ends `END $$`, `created_by` NULL — matching the
--     existing prod rows for 115 / 120).
--
--   Run this ONCE, founder-authorized, BEFORE `supabase db push`.
--
-- WHY `db push` ALONE IS NOT ENOUGH (verified 2026-09-05, CLI 2.116.0)
--   • Plain `supabase db push` REFUSES to run when a local migration file sits
--     below the remote head that is not in the remote ledger:
--       "Found local migration files to be inserted before the last migration
--        on remote database."  → it exits, applying nothing.
--   • `supabase db push --include-all` WOULD attempt EVERY gap
--     (051, 099, 101, 103, 104, 105, 116 on prod) — several of which were
--     deliberately skipped.  DO NOT use --include-all against production.
--   • After `migration repair` records 116, version 116 is no longer a gap, and
--     a normal `supabase db push` then applies only 122+ (127 included).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- MANUAL FALLBACK — only if the Supabase CLI is unavailable.
-- Founder-authorized, run ONCE against production before `db push`.
-- ON CONFLICT (version) DO NOTHING — safe to re-run / no-op if the row exists.
-- The `statements` text mirrors supabase/migrations/116_seed_music_club.sql
-- with the trailing `;` removed (element ends `END $$`), matching how
-- `supabase migration repair` stores it.
-- ===========================================================================

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '116',
  'seed_music_club',
  ARRAY[
$SEED$-- Create the Music Club at Lone Star College with zylvana21 as President.
-- Same seed-club pattern as 095/096/106/107/115: plain INSERTs so the standard triggers
-- fire (handle_club_created builds the club_group + officer_chat conversations,
-- handle_club_join adds the officer to both chats, update_club_member_count keeps
-- member_count in sync, private.derive_club_handle derives the handle,
-- sync_university_name fills the denormalised university text column).

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

  SELECT id, COALESCE(NULLIF(btrim(full_name), ''), username)
    INTO v_zylvana, v_zylvana_name
    FROM profiles WHERE username = 'zylvana21';
  IF v_zylvana IS NULL THEN
    RAISE EXCEPTION 'zylvana21 profile not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM clubs
    WHERE lower(name) = 'music club' AND university_id = v_university_id
  ) THEN
    RAISE EXCEPTION 'Music Club already exists at Lone Star College';
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
END $$$SEED$
  ]
)
ON CONFLICT (version) DO NOTHING;

-- Verify:
--   SELECT version, name, array_length(statements,1) AS n
--   FROM supabase_migrations.schema_migrations
--   WHERE version IN ('115','116','117','120','121') ORDER BY version;
