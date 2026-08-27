-- Add two clubs at Lone Star College and make zylvana21 their president.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE username = 'zylvana21') THEN
    RAISE EXCEPTION 'zylvana21 profile not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM universities WHERE name = 'Lone Star College') THEN
    RAISE EXCEPTION 'Lone Star College university not found';
  END IF;
END $$;

WITH v AS (
  SELECT id AS university_id FROM universities WHERE name = 'Lone Star College'
), president AS (
  SELECT id AS user_id FROM profiles WHERE username = 'zylvana21'
), club_seed (name, description) AS (
  VALUES
    ('Human Services Student Organization',
     'A community for students pursuing human services, social work, and counseling fields. Members connect with peers and mentors, take part in community service and volunteer opportunities, hear from guest speakers in the field, and build the skills needed for careers helping others.'),
    ('Mavericks in Recovery',
     'A peer-support community for students in or seeking recovery from substance use. Mavericks in Recovery offers a safe, judgment-free space with peer support meetings, sober social events, and resources to help members stay connected and succeed in college while in recovery.')
), new_clubs AS (
  INSERT INTO clubs (name, description, university_id, is_seed, claimed, is_active, member_count)
  SELECT club_seed.name, club_seed.description, v.university_id, false, false, true, 1
  FROM club_seed, v
  RETURNING id
), members AS (
  INSERT INTO club_members (club_id, user_id, role)
  SELECT new_clubs.id, president.user_id, 'officer'
  FROM new_clubs, president
  RETURNING club_id
)
INSERT INTO club_officers (club_id, user_id, display_name, role_title, display_order)
SELECT new_clubs.id, president.user_id, 'Zylvana Arellano', 'President', 0
FROM new_clubs, president;
