-- ============================================================
-- We Glue – Personalized discovery for Search tab
-- Migration: 018_personalized_discovery.sql
--
-- Changes:
--   1. Update get_discovery_clubs: when p_category IS NULL,
--      order by interest-overlap count (user's interests vs
--      club_categories) DESC, then by name ASC.
--      Individual category filters are untouched.
--   2. Add get_discovery_events: sorted by interest+activity
--      overlap for the Search tab's All-Categories view.
--      Single flat sorted array (no matched/unmatched split).
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. Update get_discovery_clubs with personalized sort
-- ──────────────────────────────────────────────────────────────

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
  ORDER BY
    -- Personalized sort: only active in All-Categories view
    -- When a specific category is filtered, sort stays alphabetical
    CASE WHEN p_category IS NULL THEN
      (
        SELECT COUNT(*)
        FROM   club_categories cc
        JOIN   user_interests ui
               ON ui.interest = cc.category AND ui.user_id = p_user_id
        WHERE  cc.club_id = c.id
      )
    ELSE 0
    END DESC,
    c.name ASC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

-- ──────────────────────────────────────────────────────────────
-- 2. get_discovery_events for Search tab
--
--    Returns upcoming events sorted by interest+activity overlap
--    count (binary match, no weighting). Single flat array —
--    matched and unmatched events are interleaved by score.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_discovery_events(
  p_user_id UUID,
  p_limit   INT DEFAULT 20,
  p_offset  INT DEFAULT 0
)
RETURNS TABLE(
  id               UUID,
  title            TEXT,
  emoji            TEXT,
  event_date       DATE,
  start_time       TIME,
  end_time         TIME,
  location         TEXT,
  cover_image_url  TEXT,
  club_id          UUID,
  club_name        TEXT,
  club_avatar_url  TEXT,
  member_count     INT,
  is_saved         BOOLEAN,
  user_rsvp_status TEXT,
  match_count      INT
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    e.id,
    e.title,
    e.emoji,
    e.event_date,
    e.start_time,
    e.end_time,
    e.location,
    e.cover_image_url,
    e.club_id,
    c.name  AS club_name,
    c.avatar_url AS club_avatar_url,
    c.member_count,
    EXISTS(
      SELECT 1 FROM saved_events se
      WHERE se.user_id = p_user_id AND se.event_id = e.id
    ) AS is_saved,
    (
      SELECT status::TEXT FROM event_rsvps er
      WHERE er.user_id = p_user_id AND er.event_id = e.id
      LIMIT 1
    ) AS user_rsvp_status,
    -- Count distinct matched interest OR activity tags (binary, no weight)
    (
      SELECT COUNT(DISTINCT tag)::INT
      FROM (
        SELECT ei.interest AS tag
        FROM   event_interests ei
        WHERE  ei.event_id = e.id
          AND  EXISTS (
            SELECT 1 FROM user_interests ui
            WHERE  ui.user_id = p_user_id AND ui.interest = ei.interest
          )
        UNION ALL
        SELECT ea.activity AS tag
        FROM   event_activities ea
        WHERE  ea.event_id = e.id
          AND  EXISTS (
            SELECT 1 FROM user_activities ua
            WHERE  ua.user_id = p_user_id AND ua.activity = ea.activity
          )
      ) matched_tags
    ) AS match_count
  FROM  events e
  JOIN  clubs  c ON c.id = e.club_id
  WHERE e.event_date >= CURRENT_DATE
    AND c.is_active = true
    -- Visibility gate
    AND (
      e.visibility = 'everyone'
      OR (
        e.visibility = 'members'
        AND EXISTS (
          SELECT 1 FROM club_members cm
          WHERE cm.club_id = e.club_id AND cm.user_id = p_user_id
        )
      )
      OR (
        e.visibility = 'specific'
        AND p_user_id = ANY(e.specific_user_ids)
      )
    )
  ORDER BY
    match_count DESC,
    e.event_date  ASC,
    e.start_time  ASC
  LIMIT  p_limit
  OFFSET p_offset;
$$;
