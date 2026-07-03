-- ============================================================
-- We Glue – Search Tab
-- Migration: 012_search_tab.sql
-- ============================================================

-- ============================================================
-- 1. club_categories (many-to-many junction)
-- ============================================================

CREATE TABLE IF NOT EXISTS club_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  CONSTRAINT club_categories_unique UNIQUE (club_id, category)
);

CREATE INDEX IF NOT EXISTS idx_club_categories_club_id  ON club_categories(club_id);
CREATE INDEX IF NOT EXISTS idx_club_categories_category ON club_categories(category);

ALTER TABLE club_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "club_categories: authenticated can read"
  ON club_categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "club_categories: officers can insert"
  ON club_categories FOR INSERT
  TO authenticated
  WITH CHECK (is_club_officer(club_id));

CREATE POLICY "club_categories: officers can delete"
  ON club_categories FOR DELETE
  TO authenticated
  USING (is_club_officer(club_id));

-- ============================================================
-- 2. get_discovery_clubs — paginated club grid with membership
-- ============================================================

CREATE OR REPLACE FUNCTION get_discovery_clubs(
  p_user_id  UUID,
  p_category TEXT    DEFAULT NULL,
  p_limit    INT     DEFAULT 20,
  p_offset   INT     DEFAULT 0
)
RETURNS TABLE(
  id           UUID,
  name         TEXT,
  avatar_url   TEXT,
  member_count INT,
  is_member    BOOLEAN,
  categories   TEXT[]
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    c.id,
    c.name,
    c.avatar_url,
    c.member_count,
    EXISTS(
      SELECT 1 FROM club_members cm
      WHERE cm.club_id = c.id AND cm.user_id = p_user_id
    ) AS is_member,
    ARRAY(
      SELECT cc.category FROM club_categories cc
      WHERE cc.club_id = c.id
      ORDER BY cc.category
    ) AS categories
  FROM clubs c
  WHERE c.is_active = true
    AND (
      p_category IS NULL
      OR EXISTS (
        SELECT 1 FROM club_categories cc
        WHERE cc.club_id = c.id AND cc.category = p_category
      )
    )
  ORDER BY c.name
  LIMIT p_limit
  OFFSET p_offset;
$$;

-- ============================================================
-- 3. get_discovery_people — people with most-active-club tag
--    Priority: officer role → most recent channel message → most recent join
-- ============================================================

CREATE OR REPLACE FUNCTION get_discovery_people(p_user_id UUID)
RETURNS TABLE(
  user_id    UUID,
  username   TEXT,
  full_name  TEXT,
  avatar_url TEXT,
  club_name  TEXT,
  club_id    UUID
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    p.id AS user_id,
    p.username,
    p.full_name,
    p.avatar_url,
    COALESCE(
      -- Priority 1: officer role in any active club
      (SELECT c.name
       FROM club_officers co
       JOIN clubs c ON c.id = co.club_id
       WHERE co.user_id = p.id AND c.is_active = true
       LIMIT 1),
      -- Priority 2: club of their most recent post (proxy for recent activity)
      (SELECT c.name
       FROM posts pt
       JOIN clubs c ON c.id = pt.club_id
       WHERE pt.author_id = p.id AND pt.club_id IS NOT NULL AND c.is_active = true
       ORDER BY pt.created_at DESC
       LIMIT 1),
      -- Priority 3: most recently joined club
      (SELECT c.name
       FROM club_members clm
       JOIN clubs c ON c.id = clm.club_id
       WHERE clm.user_id = p.id AND c.is_active = true
       ORDER BY clm.joined_at DESC
       LIMIT 1)
    ) AS club_name,
    COALESCE(
      (SELECT co.club_id
       FROM club_officers co
       JOIN clubs c ON c.id = co.club_id
       WHERE co.user_id = p.id AND c.is_active = true
       LIMIT 1),
      (SELECT pt.club_id
       FROM posts pt
       JOIN clubs c ON c.id = pt.club_id
       WHERE pt.author_id = p.id AND pt.club_id IS NOT NULL AND c.is_active = true
       ORDER BY pt.created_at DESC
       LIMIT 1),
      (SELECT clm.club_id
       FROM club_members clm
       JOIN clubs c ON c.id = clm.club_id
       WHERE clm.user_id = p.id AND c.is_active = true
       ORDER BY clm.joined_at DESC
       LIMIT 1)
    ) AS club_id
  FROM profiles p
  WHERE p.id != p_user_id
  ORDER BY RANDOM()
  LIMIT 20;
$$;

-- ============================================================
-- 4. search_discovery — simultaneous people + club search
-- ============================================================

CREATE OR REPLACE FUNCTION search_discovery(
  p_user_id UUID,
  p_query   TEXT
)
RETURNS TABLE(
  result_type  TEXT,
  id           UUID,
  name         TEXT,
  avatar_url   TEXT,
  sub          TEXT,
  is_member    BOOLEAN
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT * FROM (
    SELECT
      'person'::TEXT AS result_type,
      p.id,
      COALESCE(p.full_name, p.username) AS name,
      p.avatar_url,
      p.username AS sub,
      false AS is_member
    FROM profiles p
    WHERE p.id != p_user_id
      AND (
        p.username ILIKE '%' || p_query || '%'
        OR p.full_name ILIKE '%' || p_query || '%'
      )
    LIMIT 20
  ) people

  UNION ALL

  SELECT * FROM (
    SELECT
      'club'::TEXT AS result_type,
      c.id,
      c.name,
      c.avatar_url,
      c.member_count::TEXT AS sub,
      EXISTS(
        SELECT 1 FROM club_members cm
        WHERE cm.club_id = c.id AND cm.user_id = p_user_id
      ) AS is_member
    FROM clubs c
    WHERE c.is_active = true
      AND c.name ILIKE '%' || p_query || '%'
    LIMIT 20
  ) clubs_res;
$$;
