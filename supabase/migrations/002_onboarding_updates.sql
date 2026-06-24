-- ============================================================
-- We Glue – Onboarding Updates
-- Migration: 002_onboarding_updates.sql
-- ============================================================

-- ============================================================
-- ADD MISSING COLUMNS TO profiles
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_type TEXT CHECK (avatar_type IN ('photo', 'camera', 'text', 'preset')),
  ADD COLUMN IF NOT EXISTS university TEXT,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- ADD MISSING COLUMNS TO clubs
-- ============================================================

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS member_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS university TEXT,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

-- ============================================================
-- TRIGGER: keep clubs.member_count in sync
-- ============================================================

CREATE OR REPLACE FUNCTION update_club_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE clubs SET member_count = member_count + 1 WHERE id = NEW.club_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE clubs SET member_count = GREATEST(member_count - 1, 0) WHERE id = OLD.club_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_club_members_count ON club_members;
CREATE TRIGGER trg_club_members_count
  AFTER INSERT OR DELETE ON club_members
  FOR EACH ROW EXECUTE FUNCTION update_club_member_count();

-- ============================================================
-- SEED: 6 sample clubs (Lone Star College)
-- ============================================================

INSERT INTO clubs (name, handle, description, meeting_day, meeting_time_start, meeting_time_end, meeting_location, meeting_building, meeting_room, is_seed, university)
VALUES
  ('Number Club',       'number-club',       'Explore mathematics, statistics, and the beauty of numbers through problem-solving and competitions.',        'Wednesday', '13:00', '14:00', 'Building F, Room 219', 'F', '219', true, 'Lone Star College'),
  ('Business Club',     'business-club',     'Network with future entrepreneurs, learn business fundamentals, and compete in case competitions.',            'Monday',    '13:00', '14:00', 'Building F, Room 219', 'F', '219', true, 'Lone Star College'),
  ('Clay Club',         'clay-club',         'Express your creativity through pottery, sculpting, and ceramic arts in a welcoming studio environment.',      'Thursday',  '13:00', '14:00', 'Building F, Room 219', 'F', '219', true, 'Lone Star College'),
  ('Nature Club',       'nature-club',       'Connect with the environment through hiking, conservation projects, and outdoor exploration.',                  'Tuesday',   '13:00', '14:00', 'Building F, Room 219', 'F', '219', true, 'Lone Star College'),
  ('Dog Club',          'dog-club',          'Unite dog lovers on campus for therapy dog visits, community events, and responsible pet ownership.',          'Wednesday', '13:00', '14:00', 'Building F, Room 219', 'F', '219', true, 'Lone Star College'),
  ('Stock Market Club', 'stock-market-club', 'Learn investment strategies, analyze markets, and simulate portfolio management with real market data.',       'Friday',    '13:00', '14:00', 'Building F, Room 219', 'F', '219', true, 'Lone Star College')
ON CONFLICT (handle) DO NOTHING;

-- ============================================================
-- SEED: club interests (must match CHECK constraint values)
-- ============================================================

INSERT INTO club_interests (club_id, interest)
SELECT c.id, seed.interest
FROM clubs c
JOIN (VALUES
  ('number-club',       'Numbers & Economics'),
  ('number-club',       'Strategy and Critical Thinking'),
  ('business-club',     'Finance & Business'),
  ('business-club',     'Numbers & Economics'),
  ('clay-club',         'Crafts'),
  ('clay-club',         'Art & Culture'),
  ('nature-club',       'Environment'),
  ('nature-club',       'Community Service'),
  ('dog-club',          'Community Service'),
  ('dog-club',          'Health & Wellness'),
  ('stock-market-club', 'Finance & Business'),
  ('stock-market-club', 'Strategy and Critical Thinking')
) AS seed(handle, interest) ON c.handle = seed.handle
ON CONFLICT DO NOTHING;

-- ============================================================
-- RLS: ensure new columns are covered by existing policies
-- ============================================================

-- profiles RLS already exists — no new policies needed for additional columns
-- clubs is already readable by everyone (public seed data)

-- Ensure club_members RLS allows users to insert their own membership
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'club_members' AND policyname = 'club_members_insert_own'
  ) THEN
    CREATE POLICY club_members_insert_own
      ON club_members FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'club_members' AND policyname = 'club_members_select_all'
  ) THEN
    CREATE POLICY club_members_select_all
      ON club_members FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;
