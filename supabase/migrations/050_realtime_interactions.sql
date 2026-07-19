-- ============================================================
-- We Glue – Realtime for event/post interactions (cross-user live updates)
-- Migration: 050_realtime_interactions.sql
--
-- The web event overlay and Club Media overlay need cross-user LIVE updates for:
--   • event RSVPs   → attendee count + attendee avatars on the open event
--   • post likes    → like count on the open media post
--   • post comments → new/deleted comments + comment count on the open post
--
-- These are delivered via precisely-scoped postgres_changes subscriptions:
--   event_rsvps  filtered by event_id = <the open event>
--   post_likes   filtered by post_id  = <the open post>
--   post_comments filtered by post_id = <the open post>
-- i.e. one bounded channel per open item — never a firehose over all rows.
-- Row-level visibility is still governed by each table's existing RLS SELECT
-- policy (event_rsvps: "read respecting hide_events"; post_likes/post_comments:
-- "anyone authenticated can read"), so a subscriber only receives changes to
-- rows it is already allowed to read.
--
-- For those subscriptions to fire, the three tables must be members of the
-- supabase_realtime publication. This migration adds exactly those three.
-- Additive and non-breaking (only widens what realtime broadcasts; access is
-- unchanged). Benefits mobile too. Same idempotent guard as 010/031/041/049.
-- ============================================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE event_rsvps;    EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE post_likes;      EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE post_comments;   EXCEPTION WHEN others THEN NULL; END $$;
