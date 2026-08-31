-- Create the Accounting Club at Lone Star College with zylvana21 as President,
-- and add sofiaruiz as a President of the existing Chess Club.
--
-- Mirrors the 095/096 seed-club pattern: plain INSERTs so the standard triggers
-- fire (handle_club_created builds the club_group + officer_chat conversations,
-- handle_club_join adds the officer to both chats, update_club_member_count keeps
-- member_count in sync, private.derive_club_handle derives the handle,
-- sync_university_name fills the denormalised university text column).

DO $$
DECLARE
  v_university_id UUID;
  v_zylvana       UUID;
  v_sofia         UUID;
  v_zylvana_name  TEXT;
  v_sofia_name    TEXT;
  v_sofia_avatar  TEXT;
  v_accounting    UUID;
  v_chess         UUID := 'e87b15ef-f7d7-444b-990d-6708ea0bef7d';
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

  SELECT id, COALESCE(NULLIF(btrim(full_name), ''), username), avatar_url
    INTO v_sofia, v_sofia_name, v_sofia_avatar
    FROM profiles WHERE username = 'sofiaruiz';
  IF v_sofia IS NULL THEN
    RAISE EXCEPTION 'sofiaruiz profile not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id = v_chess) THEN
    RAISE EXCEPTION 'Chess Club (%) not found', v_chess;
  END IF;

  ------------------------------------------------------------------
  -- 1. Accounting Club
  ------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM clubs
    WHERE lower(name) = 'accounting club' AND university_id = v_university_id
  ) THEN
    RAISE EXCEPTION 'Accounting Club already exists at Lone Star College';
  END IF;

  -- member_count starts at 0; the club_members INSERT trigger (update_club_member_count)
  -- increments it to 1 when zylvana21 is added below.
  INSERT INTO clubs (name, description, university_id, is_seed, claimed, is_active, member_count)
  VALUES (
    'Accounting Club',
    'A community for students interested in accounting, auditing, and financial reporting. '
    || 'Members build practical skills, hear from guest speakers in the profession, explore '
    || 'career paths and certifications like the CPA, and prepare for internships and recruiting together.',
    v_university_id, false, false, true, 0
  )
  RETURNING id INTO v_accounting;

  INSERT INTO club_members (club_id, user_id, role)
  VALUES (v_accounting, v_zylvana, 'officer');

  INSERT INTO club_officers (club_id, user_id, display_name, role_title, display_order)
  VALUES (v_accounting, v_zylvana, v_zylvana_name, 'President', 0);

  ------------------------------------------------------------------
  -- 2. sofiaruiz -> President of the Chess Club
  ------------------------------------------------------------------
  -- Promote her existing membership (or add her as an officer if absent).
  INSERT INTO club_members (club_id, user_id, role)
  VALUES (v_chess, v_sofia, 'officer')
  ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'officer'
    WHERE club_members.role IS DISTINCT FROM 'officer';

  INSERT INTO club_officers (club_id, user_id, display_name, role_title, avatar_url, display_order)
  VALUES (
    v_chess, v_sofia, v_sofia_name, 'President', v_sofia_avatar,
    COALESCE((SELECT max(display_order) + 1 FROM club_officers WHERE club_id = v_chess), 0)
  )
  ON CONFLICT (club_id, user_id) WHERE user_id IS NOT NULL DO UPDATE
    SET role_title   = EXCLUDED.role_title,
        display_name = EXCLUDED.display_name,
        avatar_url   = EXCLUDED.avatar_url;

  RAISE NOTICE 'Accounting Club id=%, Chess Club president added for sofiaruiz', v_accounting;
END $$;
