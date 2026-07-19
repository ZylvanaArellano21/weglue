-- ============================================================
-- We Glue – Realtime for club content (web Club Profile cross-user sync)
-- Migration: 049_realtime_club_content.sql
--
-- Migration 041 already published clubs, club_members, club_officers to the
-- supabase_realtime publication (membership joins/leaves, officer changes,
-- profile/banner/avatar/meeting-schedule/name/description edits all fire).
--
-- The web Club Profile also needs cross-user realtime for a club's EVENTS,
-- LEARNING OUTCOMES, and MEDIA so that an event created/edited/deleted, a
-- learning-outcome edit, or a media add/hide/remove/delete made by ANOTHER
-- officer/member appears live without a page reload. This adds exactly those
-- three tables to the publication.
--
-- Additive and non-breaking: it only widens what realtime broadcasts (row-level
-- access is still governed by each table's RLS). It benefits mobile too — any
-- screen that wants to observe these tables now can. RSVP counts and per-post
-- likes/comments are deliberately NOT published here: they have no club_id to
-- scope a subscription and would be a firehose; those surfaces reconcile on
-- refetch instead.
--
-- Each ADD is guarded so re-running the migration is a no-op if the table is
-- already a publication member (same idempotent pattern as 010/031/041).
-- ============================================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE events;       EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE club_goals;   EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE club_photos;  EXCEPTION WHEN others THEN NULL; END $$;
