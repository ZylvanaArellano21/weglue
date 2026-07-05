-- ============================================================================
-- We Glue – Share Messages & Club Leave RSVP Cleanup
-- Migration: 023_share_messages_and_club_leave_cleanup.sql
-- ============================================================================
--
-- 1. Adds shared_event_id / shared_post_id to messages so a DM can carry a
--    rich "shared event" / "shared post" preview card, extends the
--    message_type check constraint, and adds a consistency check tying the
--    type to the correct FK.
-- 2. Adds an AFTER DELETE trigger on club_members that automatically cancels
--    RSVPs (and therefore removes the event from Calendar / Weekly Events,
--    both of which are pure queries over event_rsvps) for members-only
--    events belonging to the club the user just left. Public ('everyone')
--    event RSVPs are left untouched (Option A permissions rule).
-- ============================================================================

-- 1. Share message columns ---------------------------------------------------

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS shared_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shared_post_id UUID REFERENCES posts(id) ON DELETE SET NULL;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'image', 'poll', 'file', 'shared_event', 'shared_post'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_shared_content_check;
ALTER TABLE messages ADD CONSTRAINT messages_shared_content_check
  CHECK (
    (message_type = 'shared_event' AND shared_event_id IS NOT NULL)
    OR (message_type = 'shared_post' AND shared_post_id IS NOT NULL)
    OR (message_type NOT IN ('shared_event', 'shared_post'))
  );

CREATE INDEX IF NOT EXISTS idx_messages_shared_event_id ON messages(shared_event_id) WHERE shared_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_shared_post_id ON messages(shared_post_id) WHERE shared_post_id IS NOT NULL;

-- 2. Club leave → members-only RSVP/calendar/weekly-events cleanup ----------
-- Calendar (calendarService.ts) and Weekly Events (profileService.ts) are
-- both derived purely from event_rsvps where status='going', so deleting the
-- row here is sufficient to remove the event from both surfaces — no
-- separate cleanup needed.

CREATE OR REPLACE FUNCTION handle_club_leave_rsvp_cleanup()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM event_rsvps
  WHERE user_id = OLD.user_id
    AND event_id IN (
      SELECT id FROM events
      WHERE club_id = OLD.club_id
        AND visibility = 'members'
    );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_club_leave_rsvp_cleanup ON club_members;
CREATE TRIGGER trg_club_leave_rsvp_cleanup
  AFTER DELETE ON club_members
  FOR EACH ROW
  EXECUTE FUNCTION handle_club_leave_rsvp_cleanup();
