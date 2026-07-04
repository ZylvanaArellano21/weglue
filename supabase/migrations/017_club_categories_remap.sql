-- ============================================================
-- We Glue – Remap club_categories to exact onboarding interest values
-- Migration: 017_club_categories_remap.sql
--
-- ROOT CAUSE: migration 015 seeded club_categories with ad-hoc
-- values (Academic, Animals, Arts & Crafts, etc.) that don't
-- match the onboarding interest survey list. The recommendation
-- engine uses exact string equality between club_categories.category
-- and user_interests.interest, so mismatches mean the sort in
-- the Search "All Categories" view silently produces no matches
-- for almost every user.
--
-- REMAPPING DECISIONS (per-club, closest semantic fit):
--
--   Eich club (number-club):
--     Academic        → Numbers & Economics   (math/numbers focus)
--     Math & Science  → Strategy and Critical Thinking (competitions, problem-solving)
--
--   Business Club (business-club):
--     Business        → Finance & Business    (direct semantic match)
--     Professional Development → Strategy and Critical Thinking (case competitions)
--
--   Clay Club (clay-club):
--     Arts & Crafts   → Crafts               (direct semantic match)
--     Creative        → Art & Culture         (creativity / culture focus)
--
--   Dog Club (dog-club):
--     Animals         → Health & Wellness     (therapy dogs, responsible ownership)
--     Wellness        → Community Service     (therapy dog campus visits = community service)
--
--   Nature Club (nature-club):
--     Environment     → Environment           (exact match — unchanged)
--     Outdoors        → Community Service     (conservation projects, outdoor volunteering)
--
--   Stock Market Club (stock-market-club):
--     Finance         → Finance & Business    (direct semantic match)
--     Business        → Numbers & Economics   (market data, portfolio simulation)
-- ============================================================

-- Clear the old ad-hoc seed rows
DELETE FROM club_categories WHERE club_id IN (
  SELECT id FROM clubs WHERE is_seed = true
);

-- Re-insert with exact interest-list values
INSERT INTO club_categories (club_id, category)
SELECT c.id, seed.category
FROM clubs c
JOIN (VALUES
  ('number-club',       'Numbers & Economics'),
  ('number-club',       'Strategy and Critical Thinking'),
  ('business-club',     'Finance & Business'),
  ('business-club',     'Strategy and Critical Thinking'),
  ('clay-club',         'Crafts'),
  ('clay-club',         'Art & Culture'),
  ('dog-club',          'Health & Wellness'),
  ('dog-club',          'Community Service'),
  ('nature-club',       'Environment'),
  ('nature-club',       'Community Service'),
  ('stock-market-club', 'Finance & Business'),
  ('stock-market-club', 'Numbers & Economics')
) AS seed(handle, category) ON c.handle = seed.handle
ON CONFLICT (club_id, category) DO NOTHING;
