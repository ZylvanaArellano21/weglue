-- ===========================================================================
-- reconcile_ledger_116.sql — restore the missing production ledger row for
-- version 116 (`seed_music_club`).
-- ===========================================================================
--
-- CONTEXT
-- Production applied `116 = seed_music_club` on 2026-09-03 (Music Club is live),
-- then the ledger row was removed by hand, leaving version 116 as an
-- unexplained gap. `supabase/migrations/116_seed_music_club.sql` restores the
-- authentic migration file (idempotent skip-if-exists).
--
-- HOW THE ROW GETS RESTORED
--   • PREFERRED: run `supabase db push --linked` during rollout Step 2. Push
--     sees version 116 missing from the remote ledger, applies
--     116_seed_music_club.sql (a clean no-op — Music Club already exists), and
--     records the ledger row automatically. No need to run this script.
--
--   • MANUAL PATH (only if 122–126 are applied via the Management API instead
--     of `db push`): run this script ONCE, before applying 122, under explicit
--     founder authorization. It is a ledger INSERT to match reality — it does
--     NOT rewrite history and does NOT delete any existing row.
--
-- SAFETY
--   • ON CONFLICT (version) DO NOTHING — running it when the row already exists
--     (e.g. after a `db push`) is a no-op.
--   • Does not touch the `clubs` table or any other migration row.
--   • The `statements` text mirrors supabase/migrations/116_seed_music_club.sql.
-- ===========================================================================

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '116',
  'seed_music_club',
  ARRAY[
$SEED$DO $$
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
END $$;$SEED$
  ]
)
ON CONFLICT (version) DO NOTHING;

-- Verify:
--   SELECT version, name FROM supabase_migrations.schema_migrations
--   WHERE version IN ('115','116','117','120','121') ORDER BY version;
