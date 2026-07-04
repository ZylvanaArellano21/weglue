-- ============================================================
-- We Glue – Seed club_categories for all existing seed clubs
-- Migration: 015_seed_club_categories.sql
--
-- Root cause: club_categories table was created in 012 but
-- never populated. getDistinctCategories() returns [] which
-- causes the CategoryPillRow to be silently hidden in the
-- Search tab (conditional: categories.length > 0).
-- ============================================================

INSERT INTO club_categories (club_id, category)
SELECT c.id, seed.category
FROM clubs c
JOIN (VALUES
  ('business-club',     'Business'),
  ('business-club',     'Professional Development'),
  ('clay-club',         'Arts & Crafts'),
  ('clay-club',         'Creative'),
  ('dog-club',          'Animals'),
  ('dog-club',          'Wellness'),
  ('number-club',       'Academic'),
  ('number-club',       'Math & Science'),
  ('nature-club',       'Environment'),
  ('nature-club',       'Outdoors'),
  ('stock-market-club', 'Finance'),
  ('stock-market-club', 'Business')
) AS seed(handle, category) ON c.handle = seed.handle
ON CONFLICT (club_id, category) DO NOTHING;
