-- Create the Philosophy Club at Lone Star College with zylvana21 as President.
-- Same seed-club pattern as 095/096/106/107: plain INSERTs so the standard triggers
-- fire (handle_club_created builds the club_group + officer_chat conversations,
-- handle_club_join adds the officer to both chats, update_club_member_count keeps
-- member_count in sync, private.derive_club_handle derives the handle,
-- sync_university_name fills the denormalised university text column).

DO $$
DECLARE
  v_university_id UUID;
  v_zylvana       UUID;
  v_zylvana_name  TEXT;
  v_philosophy    UUID;
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
    WHERE lower(name) = 'philosophy club' AND university_id = v_university_id
  ) THEN
    RAISE EXCEPTION 'Philosophy Club already exists at Lone Star College';
  END IF;

  -- member_count starts at 0; the club_members INSERT trigger (update_club_member_count)
  -- increments it to 1 when zylvana21 is added below.
  INSERT INTO clubs (name, description, university_id, is_seed, claimed, is_active, member_count)
  VALUES (
    'Philosophy Club',
    'A community for students who love big questions -- ethics, logic, metaphysics, and more. '
    || 'Members hold discussions, debates, and reading groups exploring philosophical ideas together.',
    v_university_id, false, false, true, 0
  )
  RETURNING id INTO v_philosophy;

  INSERT INTO club_members (club_id, user_id, role)
  VALUES (v_philosophy, v_zylvana, 'officer');

  INSERT INTO club_officers (club_id, user_id, display_name, role_title, display_order)
  VALUES (v_philosophy, v_zylvana, v_zylvana_name, 'President', 0);

  RAISE NOTICE 'Philosophy Club id=%', v_philosophy;
END $$;
