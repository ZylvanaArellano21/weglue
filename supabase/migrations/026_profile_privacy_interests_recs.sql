-- ============================================================
-- We Glue – Profile privacy enforcement + recommendation tuning
-- Migration: 026_profile_privacy_interests_recs.sql
--
-- Changes:
--   1. user_privacy: allow authenticated users to READ all rows.
--      The app already queries other users' privacy flags
--      (is_private in followService/postService) but the old
--      "read own" policy silently returned nothing, so private
--      accounts and hide flags read as false for viewers.
--      The flags themselves are not sensitive — they only tell
--      the client which sections to render as private/hidden.
--   2. event_rsvps: SELECT policy now respects hide_events.
--      A user whose privacy has hide_events = true is no longer
--      visible in other users' RSVP reads (profile weekly events,
--      attendee counts/previews). Owner always sees own rows.
--   3. posts: authors can UPDATE their own posts (edit caption).
--   4. get_discovery_clubs: personalized sort now scores BOTH
--      interest overlap (club_categories) AND activity overlap
--      (activity tags on the club's upcoming events).
--   5. get_discovery_events: match_count now counts ACTIVITY
--      overlap only (events are recommended by activities).
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. user_privacy readable by all authenticated users
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "user_privacy: read own" ON user_privacy;
DROP POLICY IF EXISTS "user_privacy: read all authenticated" ON user_privacy;

CREATE POLICY "user_privacy: read all authenticated"
  ON user_privacy FOR SELECT
  TO authenticated
  USING (true);

-- ──────────────────────────────────────────────────────────────
-- 2. event_rsvps SELECT respects hide_events
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "event_rsvps: anyone authenticated can read" ON event_rsvps;
DROP POLICY IF EXISTS "event_rsvps: read respecting hide_events" ON event_rsvps;

CREATE POLICY "event_rsvps: read respecting hide_events"
  ON event_rsvps FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR NOT EXISTS (
      SELECT 1 FROM user_privacy up
      WHERE up.user_id = event_rsvps.user_id
        AND up.hide_events = true
    )
  );

-- ──────────────────────────────────────────────────────────────
-- 3. posts: authors can update their own posts
-- ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "posts: authors can update" ON posts;

CREATE POLICY "posts: authors can update"
  ON posts FOR UPDATE
  TO authenticated
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- ──────────────────────────────────────────────────────────────
-- 4. get_discovery_clubs — interests + activities matching
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
    -- Personalized sort: only active in All-Categories view.
    -- Score = user-interest overlap with the club's categories
    --       + user-activity overlap with the club's events' activity tags.
    CASE WHEN p_category IS NULL THEN
      (
        SELECT COUNT(*)
        FROM   club_categories cc
        JOIN   user_interests ui
               ON ui.interest = cc.category AND ui.user_id = p_user_id
        WHERE  cc.club_id = c.id
      )
      +
      (
        SELECT COUNT(DISTINCT ea.activity)
        FROM   events e
        JOIN   event_activities ea ON ea.event_id = e.id
        JOIN   user_activities  ua
               ON ua.activity = ea.activity AND ua.user_id = p_user_id
        WHERE  e.club_id = c.id
      )
    ELSE 0
    END DESC,
    c.name ASC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. get_discovery_events — activity-only matching
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
    -- Events are recommended by ACTIVITY overlap only
    (
      SELECT COUNT(DISTINCT ea.activity)::INT
      FROM   event_activities ea
      WHERE  ea.event_id = e.id
        AND  EXISTS (
          SELECT 1 FROM user_activities ua
          WHERE  ua.user_id = p_user_id AND ua.activity = ea.activity
        )
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
