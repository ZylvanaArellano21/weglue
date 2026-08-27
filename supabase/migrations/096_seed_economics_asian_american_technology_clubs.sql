-- Add three clubs at Lone Star College and make zylvana21 their president.

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
    ('Economics Club',
     'A community for students interested in economics, markets, and policy. Members discuss current events through an economic lens, hear from guest speakers, explore career paths in finance and public policy, and build analytical skills together.'),
    ('Asian American Association',
     'A community celebrating Asian American culture, heritage, and identity. The association hosts cultural events, discussions, and social gatherings, offering a welcoming space for students to connect, share traditions, and build community.'),
    ('Technology Club',
     'A community for students interested in technology, software, and innovation. Members collaborate on projects, hear from guest speakers in the tech industry, explore career paths in tech, and build technical skills together.')
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
