-- ============================================================
-- We Glue – Calendar Tab Indexes
-- Migration: 014_calendar_tab_indexes.sql
-- ============================================================
-- Composite index so the calendar can efficiently answer
-- "which events does this user have a going RSVP for?"
-- without scanning all event_rsvps rows.
-- The existing idx_event_rsvps_user_id covers user_id alone;
-- adding status to the index eliminates the post-filter scan.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_event_rsvps_user_status
  ON event_rsvps(user_id, status);
