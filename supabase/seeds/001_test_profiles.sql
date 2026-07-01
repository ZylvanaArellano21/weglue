-- ============================================================
-- We Glue — Test Profile Seed Data
-- 8 realistic fake student profiles for testing
-- Password for all: TestUser2026!
-- Run via: supabase db query --linked --file supabase/seeds/001_test_profiles.sql
-- ============================================================

DO $$
DECLARE
  -- Fixed UUIDs for reproducibility
  uid1 UUID := '00000001-0000-4000-a000-000000000001'; -- Marcus Rivera
  uid2 UUID := '00000002-0000-4000-a000-000000000002'; -- Sofia Chen
  uid3 UUID := '00000003-0000-4000-a000-000000000003'; -- Jordan Williams
  uid4 UUID := '00000004-0000-4000-a000-000000000004'; -- Diego Morales
  uid5 UUID := '00000005-0000-4000-a000-000000000005'; -- Priya Patel
  uid6 UUID := '00000006-0000-4000-a000-000000000006'; -- Aisha Thompson
  uid7 UUID := '00000007-0000-4000-a000-000000000007'; -- Liam OBrien
  uid8 UUID := '00000008-0000-4000-a000-000000000008'; -- Camila Vega

  -- Club IDs (ordered by created_at)
  club_number   UUID := 'e7e87bee-6b82-4230-946b-9493691d0de5'; -- Number Club (1st)
  club_nature   UUID := '06590e47-b389-469e-a8bf-447a1e31e1d6'; -- Nature Club (2nd)
  club_dog      UUID := '46906f64-35cb-45be-80e3-a8a5dbe4c7e5'; -- Dog Club
  club_stock    UUID := 'e87b15ef-f7d7-444b-990d-6708ea0bef7d'; -- Stock Market Club
  club_business UUID := '2e7f7aa6-9794-4253-a0a8-ae455fc6c87c'; -- Business Club
  club_clay     UUID := '925e7a84-eb0b-4c98-9460-65ee4667c611'; -- Clay Club

  -- Event ID
  event_pumpkin UUID := 'a949c32a-f335-4be0-ae9e-59d07f82e921'; -- Pumpkin smash (Clay Club)

  hashed_pw TEXT;
BEGIN
  hashed_pw := crypt('TestUser2026!', gen_salt('bf'));

  -- ── Create auth.users ──────────────────────────────────────

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, created_at, updated_at, is_sso_user
  ) VALUES
  (
    '00000000-0000-0000-0000-000000000000', uid1,
    'authenticated', 'authenticated',
    'marcus.rivera@my.lonestar.edu', hashed_pw,
    NOW(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"username":"marcus.rivera","full_name":"Marcus Rivera"}',
    FALSE, NOW(), NOW(), FALSE
  ),
  (
    '00000000-0000-0000-0000-000000000000', uid2,
    'authenticated', 'authenticated',
    'sofia.chen@my.lonestar.edu', hashed_pw,
    NOW(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"username":"sofia.chen","full_name":"Sofia Chen"}',
    FALSE, NOW(), NOW(), FALSE
  ),
  (
    '00000000-0000-0000-0000-000000000000', uid3,
    'authenticated', 'authenticated',
    'jordan.williams@my.lonestar.edu', hashed_pw,
    NOW(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"username":"jordan.williams","full_name":"Jordan Williams"}',
    FALSE, NOW(), NOW(), FALSE
  ),
  (
    '00000000-0000-0000-0000-000000000000', uid4,
    'authenticated', 'authenticated',
    'diego.morales@my.lonestar.edu', hashed_pw,
    NOW(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"username":"diego.morales","full_name":"Diego Morales"}',
    FALSE, NOW(), NOW(), FALSE
  ),
  (
    '00000000-0000-0000-0000-000000000000', uid5,
    'authenticated', 'authenticated',
    'priya.patel@my.lonestar.edu', hashed_pw,
    NOW(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"username":"priya.patel","full_name":"Priya Patel"}',
    FALSE, NOW(), NOW(), FALSE
  ),
  (
    '00000000-0000-0000-0000-000000000000', uid6,
    'authenticated', 'authenticated',
    'aisha.t@my.lonestar.edu', hashed_pw,
    NOW(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"username":"aisha.t","full_name":"Aisha Thompson"}',
    FALSE, NOW(), NOW(), FALSE
  ),
  (
    '00000000-0000-0000-0000-000000000000', uid7,
    'authenticated', 'authenticated',
    'liam.obrien@my.lonestar.edu', hashed_pw,
    NOW(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"username":"liam.obrien","full_name":"Liam O''Brien"}',
    FALSE, NOW(), NOW(), FALSE
  ),
  (
    '00000000-0000-0000-0000-000000000000', uid8,
    'authenticated', 'authenticated',
    'camila.vega@my.lonestar.edu', hashed_pw,
    NOW(), '', '', '', '',
    '{"provider":"email","providers":["email"]}',
    '{"username":"camila.vega","full_name":"Camila Vega"}',
    FALSE, NOW(), NOW(), FALSE
  )
  ON CONFLICT (id) DO NOTHING;

  -- ── Enrich profiles (trigger already created rows) ──────────

  UPDATE profiles SET
    bio = 'Business junior with a passion for entrepreneurship and networking. Always looking for the next opportunity.',
    major = 'Business',
    year = 'Junior',
    avatar_url = 'https://i.pravatar.cc/150?img=1',
    is_seed = TRUE,
    university = 'Lonestar College',
    onboarding_complete = TRUE,
    agreed_to_terms = TRUE,
    agreed_at = NOW()
  WHERE id = uid1;

  UPDATE profiles SET
    bio = 'CS sophomore who loves building things. Currently obsessed with AI and mobile apps.',
    major = 'Computer Science',
    year = 'Sophomore',
    avatar_url = 'https://i.pravatar.cc/150?img=2',
    is_seed = TRUE,
    university = 'Lonestar College',
    onboarding_complete = TRUE,
    agreed_to_terms = TRUE,
    agreed_at = NOW()
  WHERE id = uid2;

  UPDATE profiles SET
    bio = 'Biology junior exploring pre-med options. Science nerd by day, campus events enthusiast by night.',
    major = 'Biology',
    year = 'Junior',
    avatar_url = 'https://i.pravatar.cc/150?img=3',
    is_seed = TRUE,
    university = 'Lonestar College',
    onboarding_complete = TRUE,
    agreed_to_terms = TRUE,
    agreed_at = NOW()
  WHERE id = uid3;

  UPDATE profiles SET
    bio = 'Engineering junior with a love for robotics and sustainability. Building the future one project at a time.',
    major = 'Engineering',
    year = 'Junior',
    avatar_url = 'https://i.pravatar.cc/150?img=4',
    is_seed = TRUE,
    university = 'Lonestar College',
    onboarding_complete = TRUE,
    agreed_to_terms = TRUE,
    agreed_at = NOW()
  WHERE id = uid4;

  UPDATE profiles SET
    bio = 'Psychology junior fascinated by behavior and mental wellness. Peer counselor and club organizer.',
    major = 'Psychology',
    year = 'Junior',
    avatar_url = 'https://i.pravatar.cc/150?img=5',
    is_seed = TRUE,
    university = 'Lonestar College',
    onboarding_complete = TRUE,
    agreed_to_terms = TRUE,
    agreed_at = NOW()
  WHERE id = uid5;

  UPDATE profiles SET
    bio = 'Comm sophomore who loves storytelling, social media, and connecting communities on campus.',
    major = 'Communications',
    year = 'Sophomore',
    avatar_url = 'https://i.pravatar.cc/150?img=6',
    is_seed = TRUE,
    university = 'Lonestar College',
    onboarding_complete = TRUE,
    agreed_to_terms = TRUE,
    agreed_at = NOW()
  WHERE id = uid6;

  UPDATE profiles SET
    bio = 'Poli Sci senior gearing up for law school. Debate team captain and campus policy nerd.',
    major = 'Political Science',
    year = 'Senior',
    avatar_url = 'https://i.pravatar.cc/150?img=7',
    is_seed = TRUE,
    university = 'Lonestar College',
    onboarding_complete = TRUE,
    agreed_to_terms = TRUE,
    agreed_at = NOW()
  WHERE id = uid7;

  UPDATE profiles SET
    bio = 'Art junior finding beauty in everything. Muralist, illustrator, and ceramics enthusiast.',
    major = 'Art',
    year = 'Junior',
    avatar_url = 'https://i.pravatar.cc/150?img=8',
    is_seed = TRUE,
    university = 'Lonestar College',
    onboarding_complete = TRUE,
    agreed_to_terms = TRUE,
    agreed_at = NOW()
  WHERE id = uid8;

  -- ── Club memberships ──────────────────────────────────────
  -- All members of Clay Club so they can RSVP to Pumpkin smash (members-only event)

  INSERT INTO club_members (club_id, user_id, role) VALUES
    -- Marcus: Number Club (officer), Stock Market Club, Clay Club
    (club_number,   uid1, 'officer'),
    (club_stock,    uid1, 'member'),
    (club_clay,     uid1, 'member'),
    -- Sofia: Nature Club (officer), Dog Club, Clay Club
    (club_nature,   uid2, 'officer'),
    (club_dog,      uid2, 'member'),
    (club_clay,     uid2, 'member'),
    -- Jordan: Business Club, Clay Club
    (club_business, uid3, 'member'),
    (club_clay,     uid3, 'member'),
    -- Diego: Stock Market Club, Clay Club
    (club_stock,    uid4, 'member'),
    (club_clay,     uid4, 'member'),
    -- Priya: Dog Club, Clay Club
    (club_dog,      uid5, 'member'),
    (club_clay,     uid5, 'member'),
    -- Aisha: Business Club, Clay Club
    (club_business, uid6, 'member'),
    (club_clay,     uid6, 'member'),
    -- Liam: Number Club, Business Club, Clay Club
    (club_number,   uid7, 'member'),
    (club_business, uid7, 'member'),
    (club_clay,     uid7, 'member'),
    -- Camila: Nature Club, Clay Club
    (club_nature,   uid8, 'member'),
    (club_clay,     uid8, 'member')
  ON CONFLICT (club_id, user_id) DO NOTHING;

  -- ── Club officers display entries ──────────────────────────
  -- Marcus → President of Number Club
  INSERT INTO club_officers (club_id, user_id, display_name, role_title, avatar_url, display_order)
  VALUES
    (club_number, uid1, 'Marcus Rivera', 'President', 'https://i.pravatar.cc/150?img=1', 1),
    (club_nature, uid2, 'Sofia Chen',    'President', 'https://i.pravatar.cc/150?img=2', 1)
  ON CONFLICT DO NOTHING;

  -- ── Event RSVPs ──────────────────────────────────────────
  -- All 8 users RSVP "going" to Pumpkin smash
  INSERT INTO event_rsvps (event_id, user_id, status) VALUES
    (event_pumpkin, uid1, 'going'),
    (event_pumpkin, uid2, 'going'),
    (event_pumpkin, uid3, 'going'),
    (event_pumpkin, uid4, 'going'),
    (event_pumpkin, uid5, 'going'),
    (event_pumpkin, uid6, 'going'),
    (event_pumpkin, uid7, 'going'),
    (event_pumpkin, uid8, 'going')
  ON CONFLICT (event_id, user_id) DO NOTHING;

  -- ── Posts (2-3 per profile) ────────────────────────────────

  INSERT INTO posts (author_id, club_id, post_type, image_url, caption, created_at) VALUES
    -- Marcus Rivera
    (uid1, club_number,   'picture', 'https://picsum.photos/seed/marcus1/400/500', 'Meeting day! The Number Club is doing big things this semester 📊', NOW() - INTERVAL '2 days'),
    (uid1, NULL,          'picture', 'https://picsum.photos/seed/marcus2/400/500', 'Campus life hits different when the sun is out ☀️', NOW() - INTERVAL '5 days'),
    (uid1, club_business, 'picture', 'https://picsum.photos/seed/marcus3/400/500', 'Networking event recap — met so many future CEOs tonight 🤝', NOW() - INTERVAL '8 days'),

    -- Sofia Chen
    (uid2, NULL,          'picture', 'https://picsum.photos/seed/sofia1/400/500', 'Late night coding session with my favorite playlist on 🎧💻', NOW() - INTERVAL '1 day'),
    (uid2, club_nature,   'picture', 'https://picsum.photos/seed/sofia2/400/500', 'Nature Club clean-up day was such a vibe 🌿', NOW() - INTERVAL '4 days'),
    (uid2, NULL,          'picture', 'https://picsum.photos/seed/sofia3/400/500', 'Pulled off a full-stack feature this week — ship it! 🚀', NOW() - INTERVAL '10 days'),

    -- Jordan Williams
    (uid3, NULL,          'picture', 'https://picsum.photos/seed/jordan1/400/500', 'Lab day! Bio never gets old when your professor is this passionate 🔬', NOW() - INTERVAL '3 days'),
    (uid3, club_clay,     'picture', 'https://picsum.photos/seed/jordan2/400/500', 'Made my first bowl in clay class today. Crooked but I love it 😂🏺', NOW() - INTERVAL '7 days'),

    -- Diego Morales
    (uid4, NULL,          'picture', 'https://picsum.photos/seed/diego1/400/500', 'Workshop project coming together nicely. Engineering is life 🔧', NOW() - INTERVAL '2 days'),
    (uid4, club_stock,    'picture', 'https://picsum.photos/seed/diego2/400/500', 'Stock market simulation workshop with the crew 📈 Learned so much today', NOW() - INTERVAL '6 days'),
    (uid4, NULL,          'picture', 'https://picsum.photos/seed/diego3/400/500', 'Study grind. Finals season is no joke but we''re built for this 💪', NOW() - INTERVAL '11 days'),

    -- Priya Patel
    (uid5, NULL,          'picture', 'https://picsum.photos/seed/priya1/400/500', 'Mental health matters. Take a break, breathe, and look at this sunset 🌅', NOW() - INTERVAL '1 day'),
    (uid5, club_dog,      'picture', 'https://picsum.photos/seed/priya2/400/500', 'Dog Club therapy session with the most adorable goldens 🐕💛', NOW() - INTERVAL '5 days'),

    -- Aisha Thompson
    (uid6, NULL,          'picture', 'https://picsum.photos/seed/aisha1/400/500', 'Finally dropped my podcast episode on campus culture 🎙️ Link in bio!', NOW() - INTERVAL '2 days'),
    (uid6, club_business, 'picture', 'https://picsum.photos/seed/aisha2/400/500', 'Business panel recap — women in leadership showing up strong 💼✨', NOW() - INTERVAL '9 days'),
    (uid6, NULL,          'picture', 'https://picsum.photos/seed/aisha3/400/500', 'Coffee + notes + good vibes. Sophomore year is hitting different 📝☕', NOW() - INTERVAL '14 days'),

    -- Liam O''Brien
    (uid7, NULL,          'picture', 'https://picsum.photos/seed/liam1/400/500', 'Debate team took the W tonight. Four years and still going strong 🏆', NOW() - INTERVAL '3 days'),
    (uid7, club_number,   'picture', 'https://picsum.photos/seed/liam2/400/500', 'Number Club x Politics Club crossover event — the overlap is real 📊🗳️', NOW() - INTERVAL '8 days'),

    -- Camila Vega
    (uid8, club_clay,     'picture', 'https://picsum.photos/seed/camila1/400/500', 'New mural sketch in progress. Can''t wait to see this on the campus wall 🎨', NOW() - INTERVAL '1 day'),
    (uid8, NULL,          'picture', 'https://picsum.photos/seed/camila2/400/500', 'Golden hour is the best hour for inspiration 🌇✏️', NOW() - INTERVAL '4 days'),
    (uid8, club_nature,   'picture', 'https://picsum.photos/seed/camila3/400/500', 'Nature Club + art collab. We painted what we love about this campus 🌿🖌️', NOW() - INTERVAL '9 days')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Seed complete! 8 profiles, clubs, RSVPs, and posts created.';
END $$;
