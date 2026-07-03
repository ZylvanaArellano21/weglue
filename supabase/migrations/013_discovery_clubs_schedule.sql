-- ============================================================
-- We Glue – Discovery Clubs: add schedule + cover_image fields
-- Migration: 013_discovery_clubs_schedule.sql
-- ============================================================

-- Drop and recreate get_discovery_clubs so the RETURNS TABLE shape
-- expands to include meeting schedule fields and cover_image_url.
-- All columns already exist on the clubs table (001 + 002).

DROP FUNCTION IF EXISTS get_discovery_clubs(UUID, TEXT, INT, INT);

CREATE FUNCTION get_discovery_clubs(
  p_user_id  UUID,
  p_category TEXT    DEFAULT NULL,
  p_limit    INT     DEFAULT 20,
  p_offset   INT     DEFAULT 0
)
RETURNS TABLE(
  id                  UUID,
  name                TEXT,
  avatar_url          TEXT,
  cover_image_url     TEXT,
  member_count        INT,
  is_member           BOOLEAN,
  categories          TEXT[],
  meeting_day         TEXT,
  meeting_time_start  TEXT,
  meeting_time_end    TEXT,
  meeting_building    TEXT,
  meeting_room        TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    c.id,
    c.name,
    c.avatar_url,
    c.cover_image_url,
    c.member_count,
    EXISTS(
      SELECT 1 FROM club_members cm
      WHERE cm.club_id = c.id AND cm.user_id = p_user_id
    ) AS is_member,
    ARRAY(
      SELECT cc.category FROM club_categories cc
      WHERE cc.club_id = c.id
      ORDER BY cc.category
    ) AS categories,
    c.meeting_day,
    c.meeting_time_start::TEXT,
    c.meeting_time_end::TEXT,
    c.meeting_building,
    c.meeting_room
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
