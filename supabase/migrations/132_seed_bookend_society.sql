-- Create The Bookend Society at Lone Star College with KevinTS as Secretary.
-- Same seed-club pattern as 095/096/106/107/116/120: plain INSERTs so the standard triggers
-- fire (handle_club_created builds the club_group + officer_chat conversations,
-- handle_club_join adds the officer to both chats, update_club_member_count keeps
-- member_count in sync, private.derive_club_handle derives the handle,
-- sync_university_name fills the denormalised university text column).

DO $$
DECLARE
  v_university_id UUID;
  v_kevin         UUID;
  v_kevin_name    TEXT;
  v_bookend       UUID;
BEGIN
  SELECT id INTO v_university_id FROM universities WHERE name = 'Lone Star College';
  IF v_university_id IS NULL THEN
    RAISE EXCEPTION 'Lone Star College university not found';
  END IF;

  SELECT id, COALESCE(NULLIF(btrim(full_name), ''), username)
    INTO v_kevin, v_kevin_name
    FROM profiles WHERE username = 'KevinTS';
  IF v_kevin IS NULL THEN
    RAISE EXCEPTION 'KevinTS profile not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM clubs
    WHERE lower(name) = 'the bookend society' AND university_id = v_university_id
  ) THEN
    RAISE EXCEPTION 'The Bookend Society already exists at Lone Star College';
  END IF;

  -- member_count starts at 0; the club_members INSERT trigger (update_club_member_count)
  -- increments it to 1 when KevinTS is added below.
  INSERT INTO clubs (name, description, university_id, is_seed, claimed, is_active, member_count)
  VALUES (
    'The Bookend Society',
    'A club for readers and writers -- book discussions, reading challenges, and creative writing '
    || 'circles for students who love stories in every form.',
    v_university_id, false, false, true, 0
  )
  RETURNING id INTO v_bookend;

  INSERT INTO club_members (club_id, user_id, role)
  VALUES (v_bookend, v_kevin, 'officer');

  INSERT INTO club_officers (club_id, user_id, display_name, role_title, display_order)
  VALUES (v_bookend, v_kevin, v_kevin_name, 'Secretary', 0);

  RAISE NOTICE 'The Bookend Society id=%', v_bookend;
END $$;
