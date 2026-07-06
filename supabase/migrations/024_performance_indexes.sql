-- 024_performance_indexes.sql
-- Composite/partial indexes for the hottest mobile queries, matching the exact
-- filter + order shapes used by the app's services. All IF NOT EXISTS so this
-- is safe to run on any environment.

-- Chat list & DM thread: messages filtered by conversation, DMs additionally
-- filter channel_id IS NULL and order by created_at DESC.
CREATE INDEX IF NOT EXISTS idx_messages_conv_dm_created
  ON messages(conversation_id, created_at DESC)
  WHERE channel_id IS NULL;

-- Club profile "Upcoming Events": events by club from today forward.
CREATE INDEX IF NOT EXISTS idx_events_club_date
  ON events(club_id, event_date);

-- Home posts feed: author's posts newest-first.
CREATE INDEX IF NOT EXISTS idx_posts_author_created
  ON posts(author_id, created_at DESC);

-- Attendee lists / RSVP counts: rsvps for an event filtered by status.
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event_status
  ON event_rsvps(event_id, status);

-- Club photos grid: visible photos for a club, newest-first.
CREATE INDEX IF NOT EXISTS idx_club_photos_club_visible_created
  ON club_photos(club_id, is_visible, created_at DESC);

-- Notifications screen: a user's notifications newest-first.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- Gluemates (mutual follows): both directions filter on status='accepted'.
CREATE INDEX IF NOT EXISTS idx_follows_follower_status
  ON follows(follower_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following_status
  ON follows(following_id, status);

-- Channel threads: messages in a channel newest-first (channel threads live
-- in the unified messages table, filtered by channel_id).
CREATE INDEX IF NOT EXISTS idx_messages_channel_created
  ON messages(channel_id, created_at DESC)
  WHERE channel_id IS NOT NULL;

-- People/user search uses ILIKE '%q%' on profiles; trigram GIN indexes make
-- those substring searches indexable instead of sequential scans.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_profiles_username_trgm
  ON profiles USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm
  ON profiles USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clubs_name_trgm
  ON clubs USING gin (name gin_trgm_ops);
