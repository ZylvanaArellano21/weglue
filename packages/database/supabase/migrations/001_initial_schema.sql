-- ============================================================
-- We Glue – Initial Schema
-- Migration: 001_initial_schema.sql
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- UTILITY: updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT UNIQUE NOT NULL,
  full_name   TEXT NOT NULL,
  avatar_url  TEXT,
  major       TEXT,
  bio         TEXT,
  is_seed     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_created_at ON profiles(created_at);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-create profile on sign-up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, username, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::text, 8)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ----

CREATE TABLE user_interests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  interest   TEXT NOT NULL CHECK (interest IN (
    'Finance & Business', 'Social Events', 'Music', 'Fashion',
    'Art & Culture', 'Social Justice & Activism', 'Numbers & Economics',
    'Gaming', 'Health & Wellness', 'Environment', 'Sports & Athletics',
    'Community Service', 'Crafts', 'Religion', 'Technology and Computer',
    'Film & Media', 'Photography', 'Strategy and Critical Thinking',
    'Writing', 'Theater', 'Travel & Languages', 'Debate & Politics'
  ))
);

CREATE INDEX idx_user_interests_user_id ON user_interests(user_id);

-- ----

CREATE TABLE user_activities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity   TEXT NOT NULL CHECK (activity IN (
    'Projects', 'Volunteering', 'Workshops', 'Campus Fairs',
    'Trips', 'Study Groups', 'Networking', 'Tournaments',
    'Social Events', 'Campus Tours'
  ))
);

CREATE INDEX idx_user_activities_user_id ON user_activities(user_id);

-- ----

CREATE TABLE user_privacy (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  is_private      BOOLEAN NOT NULL DEFAULT false,
  hide_interests  BOOLEAN NOT NULL DEFAULT false,
  hide_events     BOOLEAN NOT NULL DEFAULT false
);

-- ============================================================
-- FOLLOWS / GLUEMATES
-- ============================================================

CREATE TABLE follows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (follower_id, following_id)
);

CREATE INDEX idx_follows_follower_id  ON follows(follower_id);
CREATE INDEX idx_follows_following_id ON follows(following_id);
CREATE INDEX idx_follows_created_at   ON follows(created_at);

-- ============================================================
-- CLUBS
-- ============================================================

CREATE TABLE clubs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  handle             TEXT NOT NULL UNIQUE,
  description        TEXT NOT NULL,
  avatar_url         TEXT,
  banner_url         TEXT,
  meeting_day        TEXT,
  meeting_time_start TIME,
  meeting_time_end   TIME,
  meeting_location   TEXT,
  meeting_building   TEXT,
  meeting_room       TEXT,
  is_seed            BOOLEAN NOT NULL DEFAULT false,
  claimed            BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clubs_created_at ON clubs(created_at);

CREATE TRIGGER trg_clubs_updated_at
  BEFORE UPDATE ON clubs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----

CREATE TABLE club_goals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  goal_text     TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_club_goals_club_id ON club_goals(club_id);

-- ----

CREATE TABLE club_interests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  interest   TEXT NOT NULL CHECK (interest IN (
    'Finance & Business', 'Social Events', 'Music', 'Fashion',
    'Art & Culture', 'Social Justice & Activism', 'Numbers & Economics',
    'Gaming', 'Health & Wellness', 'Environment', 'Sports & Athletics',
    'Community Service', 'Crafts', 'Religion', 'Technology and Computer',
    'Film & Media', 'Photography', 'Strategy and Critical Thinking',
    'Writing', 'Theater', 'Travel & Languages', 'Debate & Politics'
  ))
);

CREATE INDEX idx_club_interests_club_id ON club_interests(club_id);

-- ----

CREATE TABLE club_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id   UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('member', 'officer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, user_id)
);

CREATE INDEX idx_club_members_club_id ON club_members(club_id);
CREATE INDEX idx_club_members_user_id ON club_members(user_id);

-- ----

CREATE TABLE club_officers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  display_name  TEXT NOT NULL,
  role_title    TEXT NOT NULL,
  avatar_url    TEXT,
  display_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_club_officers_club_id ON club_officers(club_id);

-- ----

CREATE TABLE club_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  uploaded_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_club_photos_club_id    ON club_photos(club_id);
CREATE INDEX idx_club_photos_created_at ON club_photos(created_at);

-- ============================================================
-- EVENTS
-- ============================================================

CREATE TABLE events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  created_by       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  emoji            TEXT,
  description      TEXT,
  cover_image_url  TEXT,
  event_date       DATE NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  location         TEXT,
  building         TEXT,
  room             TEXT,
  visibility       TEXT NOT NULL DEFAULT 'everyone' CHECK (visibility IN ('everyone', 'members', 'specific')),
  is_seed          BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_club_id    ON events(club_id);
CREATE INDEX idx_events_created_by ON events(created_by);
CREATE INDEX idx_events_event_date ON events(event_date);
CREATE INDEX idx_events_created_at ON events(created_at);

CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----

CREATE TABLE event_interests (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  interest  TEXT NOT NULL
);

CREATE INDEX idx_event_interests_event_id ON event_interests(event_id);

-- ----

CREATE TABLE event_activities (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  activity  TEXT NOT NULL
);

CREATE INDEX idx_event_activities_event_id ON event_activities(event_id);

-- ----

CREATE TABLE event_rsvps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('going', 'cant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX idx_event_rsvps_event_id ON event_rsvps(event_id);
CREATE INDEX idx_event_rsvps_user_id  ON event_rsvps(user_id);

-- ----

CREATE TABLE saved_events (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, event_id)
);

CREATE INDEX idx_saved_events_user_id  ON saved_events(user_id);
CREATE INDEX idx_saved_events_event_id ON saved_events(event_id);

-- ============================================================
-- POSTS / FEED
-- ============================================================

CREATE TABLE posts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  club_id          UUID REFERENCES clubs(id) ON DELETE CASCADE,
  post_type        TEXT NOT NULL CHECK (post_type IN ('picture', 'event')),
  image_url        TEXT,
  caption          TEXT,
  linked_event_id  UUID REFERENCES events(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_posts_author_id  ON posts(author_id);
CREATE INDEX idx_posts_club_id    ON posts(club_id);
CREATE INDEX idx_posts_created_at ON posts(created_at);

-- ============================================================
-- MESSAGING
-- ============================================================

CREATE TABLE conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL CHECK (type IN ('direct', 'group', 'club_group', 'officer_chat')),
  club_id    UUID REFERENCES clubs(id) ON DELETE CASCADE,
  name       TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_club_id    ON conversations(club_id);
CREATE INDEX idx_conversations_created_at ON conversations(created_at);

-- ----

CREATE TABLE conversation_participants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX idx_conv_participants_conv_id ON conversation_participants(conversation_id);
CREATE INDEX idx_conv_participants_user_id ON conversation_participants(user_id);

-- ----

CREATE TABLE conversation_channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  display_order   INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_conv_channels_conv_id ON conversation_channels(conversation_id);

-- ----

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id      UUID REFERENCES conversation_channels(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content         TEXT,
  message_type    TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'poll')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_sender_id       ON messages(sender_id);
CREATE INDEX idx_messages_created_at      ON messages(created_at);

-- ----

CREATE TABLE polls (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  question       TEXT NOT NULL,
  allow_multiple BOOLEAN NOT NULL DEFAULT false,
  start_at       TIMESTAMPTZ,
  end_at         TIMESTAMPTZ
);

CREATE INDEX idx_polls_message_id ON polls(message_id);

-- ----

CREATE TABLE poll_options (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id       UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_text   TEXT NOT NULL,
  display_order INT NOT NULL
);

CREATE INDEX idx_poll_options_poll_id ON poll_options(poll_id);

-- ----

CREATE TABLE poll_votes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id   UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  UNIQUE (poll_id, user_id, option_id)
);

CREATE INDEX idx_poll_votes_poll_id ON poll_votes(poll_id);
CREATE INDEX idx_poll_votes_user_id ON poll_votes(user_id);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
    'follow_request', 'follow_accepted', 'event_rsvp',
    'new_event', 'new_message', 'gluemate'
  )),
  actor_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  entity_id   UUID,
  entity_type TEXT CHECK (entity_type IN ('event', 'club', 'message')),
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id    ON notifications(user_id);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_interests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_privacy              ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE clubs                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_goals                ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_interests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_members              ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_officers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_photos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE events                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_interests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_activities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_rsvps               ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_channels     ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE polls                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_options              ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications             ENABLE ROW LEVEL SECURITY;

-- ---- HELPER: is user an officer of a club?
CREATE OR REPLACE FUNCTION is_club_officer(p_club_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id = p_club_id
      AND user_id = auth.uid()
      AND role = 'officer'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---- HELPER: is user a conversation participant?
CREATE OR REPLACE FUNCTION is_conversation_participant(p_conv_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = p_conv_id
      AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---- profiles
CREATE POLICY "profiles: anyone authenticated can read"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "profiles: users update own"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles: users insert own"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- ---- user_interests
CREATE POLICY "user_interests: read own or public"
  ON user_interests FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR NOT EXISTS (
      SELECT 1 FROM user_privacy
      WHERE user_id = user_interests.user_id AND hide_interests = true
    )
  );

CREATE POLICY "user_interests: manage own"
  ON user_interests FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---- user_activities
CREATE POLICY "user_activities: read all authenticated"
  ON user_activities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "user_activities: manage own"
  ON user_activities FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---- user_privacy
CREATE POLICY "user_privacy: read own"
  ON user_privacy FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_privacy: manage own"
  ON user_privacy FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---- follows
CREATE POLICY "follows: anyone authenticated can read"
  ON follows FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "follows: authenticated can insert"
  ON follows FOR INSERT
  TO authenticated
  WITH CHECK (follower_id = auth.uid());

CREATE POLICY "follows: owner can update (accept/reject)"
  ON follows FOR UPDATE
  TO authenticated
  USING (following_id = auth.uid());

CREATE POLICY "follows: owner can delete"
  ON follows FOR DELETE
  TO authenticated
  USING (follower_id = auth.uid() OR following_id = auth.uid());

-- ---- clubs
CREATE POLICY "clubs: anyone authenticated can read"
  ON clubs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "clubs: officers can update"
  ON clubs FOR UPDATE
  TO authenticated
  USING (is_club_officer(id));

CREATE POLICY "clubs: officers can insert"
  ON clubs FOR INSERT
  TO authenticated
  WITH CHECK (true); -- creation gated at app layer; RLS keeps read open

-- ---- club_goals
CREATE POLICY "club_goals: anyone authenticated can read"
  ON club_goals FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "club_goals: officers can manage"
  ON club_goals FOR ALL
  TO authenticated
  USING (is_club_officer(club_id))
  WITH CHECK (is_club_officer(club_id));

-- ---- club_interests
CREATE POLICY "club_interests: anyone authenticated can read"
  ON club_interests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "club_interests: officers can manage"
  ON club_interests FOR ALL
  TO authenticated
  USING (is_club_officer(club_id))
  WITH CHECK (is_club_officer(club_id));

-- ---- club_members
CREATE POLICY "club_members: anyone authenticated can read"
  ON club_members FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "club_members: officers can insert/delete"
  ON club_members FOR INSERT
  TO authenticated
  WITH CHECK (is_club_officer(club_id) OR user_id = auth.uid());

CREATE POLICY "club_members: officers can delete others, members delete self"
  ON club_members FOR DELETE
  TO authenticated
  USING (is_club_officer(club_id) OR user_id = auth.uid());

-- ---- club_officers
CREATE POLICY "club_officers: anyone authenticated can read"
  ON club_officers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "club_officers: officers can manage"
  ON club_officers FOR ALL
  TO authenticated
  USING (is_club_officer(club_id))
  WITH CHECK (is_club_officer(club_id));

-- ---- club_photos
CREATE POLICY "club_photos: anyone authenticated can read"
  ON club_photos FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "club_photos: members can insert"
  ON club_photos FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM club_members
      WHERE club_id = club_photos.club_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "club_photos: officers can delete"
  ON club_photos FOR DELETE
  TO authenticated
  USING (is_club_officer(club_id) OR uploaded_by = auth.uid());

-- ---- events
CREATE POLICY "events: everyone can read public events"
  ON events FOR SELECT
  TO authenticated
  USING (
    visibility = 'everyone'
    OR created_by = auth.uid()
    OR (
      visibility = 'members'
      AND EXISTS (
        SELECT 1 FROM club_members
        WHERE club_id = events.club_id AND user_id = auth.uid()
      )
    )
  );

CREATE POLICY "events: officers can insert"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (is_club_officer(club_id));

CREATE POLICY "events: officers can update/delete"
  ON events FOR UPDATE
  TO authenticated
  USING (is_club_officer(club_id));

CREATE POLICY "events: officers can delete"
  ON events FOR DELETE
  TO authenticated
  USING (is_club_officer(club_id));

-- ---- event_interests
CREATE POLICY "event_interests: anyone authenticated can read"
  ON event_interests FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "event_interests: officers can manage"
  ON event_interests FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_interests.event_id AND is_club_officer(e.club_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_interests.event_id AND is_club_officer(e.club_id)
    )
  );

-- ---- event_activities
CREATE POLICY "event_activities: anyone authenticated can read"
  ON event_activities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "event_activities: officers can manage"
  ON event_activities FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_activities.event_id AND is_club_officer(e.club_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_activities.event_id AND is_club_officer(e.club_id)
    )
  );

-- ---- event_rsvps
CREATE POLICY "event_rsvps: anyone authenticated can read"
  ON event_rsvps FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "event_rsvps: users manage own"
  ON event_rsvps FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---- saved_events
CREATE POLICY "saved_events: users manage own"
  ON saved_events FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---- posts
CREATE POLICY "posts: anyone authenticated can read"
  ON posts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "posts: authors can insert"
  ON posts FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid());

CREATE POLICY "posts: authors can delete"
  ON posts FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());

-- ---- conversations
CREATE POLICY "conversations: participants can read"
  ON conversations FOR SELECT
  TO authenticated
  USING (is_conversation_participant(id));

CREATE POLICY "conversations: authenticated can create"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ---- conversation_participants
CREATE POLICY "conv_participants: participants can read"
  ON conversation_participants FOR SELECT
  TO authenticated
  USING (is_conversation_participant(conversation_id));

CREATE POLICY "conv_participants: authenticated can insert"
  ON conversation_participants FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "conv_participants: users remove self"
  ON conversation_participants FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ---- conversation_channels
CREATE POLICY "conv_channels: participants can read"
  ON conversation_channels FOR SELECT
  TO authenticated
  USING (is_conversation_participant(conversation_id));

CREATE POLICY "conv_channels: participants can manage"
  ON conversation_channels FOR ALL
  TO authenticated
  USING (is_conversation_participant(conversation_id))
  WITH CHECK (is_conversation_participant(conversation_id));

-- ---- messages
CREATE POLICY "messages: participants can read"
  ON messages FOR SELECT
  TO authenticated
  USING (is_conversation_participant(conversation_id));

CREATE POLICY "messages: participants can insert"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND is_conversation_participant(conversation_id)
  );

CREATE POLICY "messages: senders can update"
  ON messages FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid());

-- ---- polls
CREATE POLICY "polls: conversation participants can read"
  ON polls FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = polls.message_id
        AND is_conversation_participant(m.conversation_id)
    )
  );

CREATE POLICY "polls: message senders can manage"
  ON polls FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = polls.message_id AND m.sender_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = polls.message_id AND m.sender_id = auth.uid()
    )
  );

-- ---- poll_options
CREATE POLICY "poll_options: participants can read"
  ON poll_options FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM polls p
      JOIN messages m ON m.id = p.message_id
      WHERE p.id = poll_options.poll_id
        AND is_conversation_participant(m.conversation_id)
    )
  );

CREATE POLICY "poll_options: poll creator can manage"
  ON poll_options FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM polls p
      JOIN messages m ON m.id = p.message_id
      WHERE p.id = poll_options.poll_id AND m.sender_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM polls p
      JOIN messages m ON m.id = p.message_id
      WHERE p.id = poll_options.poll_id AND m.sender_id = auth.uid()
    )
  );

-- ---- poll_votes
CREATE POLICY "poll_votes: participants can read"
  ON poll_votes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM polls p
      JOIN messages m ON m.id = p.message_id
      WHERE p.id = poll_votes.poll_id
        AND is_conversation_participant(m.conversation_id)
    )
  );

CREATE POLICY "poll_votes: authenticated can vote"
  ON poll_votes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "poll_votes: users can remove own vote"
  ON poll_votes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ---- notifications
CREATE POLICY "notifications: users read own"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications: users update own (mark read)"
  ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "notifications: service can insert"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);
