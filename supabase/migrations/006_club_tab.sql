-- ============================================================
-- We Glue – Club Tab
-- Migration: 006_club_tab.sql
-- ============================================================

-- ============================================================
-- 1. EXTEND NOTIFICATION TYPES (add club_inactive)
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'follow_request', 'follow_accepted', 'event_rsvp',
    'new_event', 'new_message', 'gluemate', 'like', 'comment', 'club_inactive'
  ));

-- ============================================================
-- 2. EXTEND clubs TABLE
-- ============================================================

ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS is_active          BOOLEAN    NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_activity_at   TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS inactivity_warned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_clubs_is_active ON clubs(is_active);

-- ============================================================
-- 3. EXTEND club_photos TABLE
-- Existing column is `url` — we keep it to avoid breaking app code.
-- We add the new columns the club tab needs.
-- ============================================================

ALTER TABLE club_photos
  ADD COLUMN IF NOT EXISTS caption    TEXT,
  ADD COLUMN IF NOT EXISTS source     TEXT CHECK (source IN ('officer_upload', 'tagged_post')),
  ADD COLUMN IF NOT EXISTS post_id    UUID REFERENCES posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_club_photos_is_visible ON club_photos(is_visible);

-- ============================================================
-- 4. HELPER FUNCTIONS
-- ============================================================

-- Is the current user a member (or officer) of a club?
CREATE OR REPLACE FUNCTION is_club_member(p_club_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id = p_club_id
      AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 5. club_channels  (Discord-style sub-channels)
-- ============================================================

CREATE TABLE IF NOT EXISTS club_channels (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       UUID        NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  created_by    UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  is_restricted BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_club_channels_club_id ON club_channels(club_id);

ALTER TABLE club_channels ENABLE ROW LEVEL SECURITY;

-- Is the current user an officer of the club that owns a channel?
CREATE OR REPLACE FUNCTION is_channel_club_officer(p_channel_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM club_channels cc
    JOIN club_members cm ON cm.club_id = cc.club_id
    WHERE cc.id = p_channel_id
      AND cm.user_id = auth.uid()
      AND cm.role = 'officer'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Members (and officers) can read channels for their clubs
CREATE POLICY "club_channels: members can read"
  ON club_channels FOR SELECT
  TO authenticated
  USING (is_club_member(club_id));

-- Officers can create channels
CREATE POLICY "club_channels: officers can insert"
  ON club_channels FOR INSERT
  TO authenticated
  WITH CHECK (is_club_officer(club_id));

-- Officers can update channels (rename, toggle restricted)
CREATE POLICY "club_channels: officers can update"
  ON club_channels FOR UPDATE
  TO authenticated
  USING (is_club_officer(club_id));

-- Officers can delete channels
CREATE POLICY "club_channels: officers can delete"
  ON club_channels FOR DELETE
  TO authenticated
  USING (is_club_officer(club_id));

-- ============================================================
-- 6. club_polls  (independent of the DM/message polls system)
-- ============================================================

CREATE TABLE IF NOT EXISTS club_polls (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        UUID        NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  channel_id     UUID        REFERENCES club_channels(id) ON DELETE CASCADE,
  created_by     UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question       TEXT        NOT NULL,
  allow_multiple BOOLEAN     NOT NULL DEFAULT false,
  start_date     TIMESTAMPTZ,
  end_date       TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_club_polls_club_id    ON club_polls(club_id);
CREATE INDEX IF NOT EXISTS idx_club_polls_channel_id ON club_polls(channel_id);
CREATE INDEX IF NOT EXISTS idx_club_polls_created_at ON club_polls(created_at);

ALTER TABLE club_polls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "club_polls: members can read"
  ON club_polls FOR SELECT
  TO authenticated
  USING (is_club_member(club_id));

CREATE POLICY "club_polls: members can insert"
  ON club_polls FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND is_club_member(club_id)
  );

CREATE POLICY "club_polls: creator or officer can delete"
  ON club_polls FOR DELETE
  TO authenticated
  USING (created_by = auth.uid() OR is_club_officer(club_id));

-- ============================================================
-- 7. club_poll_options
-- ============================================================

CREATE TABLE IF NOT EXISTS club_poll_options (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id     UUID    NOT NULL REFERENCES club_polls(id) ON DELETE CASCADE,
  option_text TEXT    NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_club_poll_options_poll_id ON club_poll_options(poll_id);

ALTER TABLE club_poll_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "club_poll_options: members can read"
  ON club_poll_options FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM club_polls cp
      WHERE cp.id = club_poll_options.poll_id
        AND is_club_member(cp.club_id)
    )
  );

CREATE POLICY "club_poll_options: poll creator can insert"
  ON club_poll_options FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM club_polls cp
      WHERE cp.id = club_poll_options.poll_id
        AND cp.created_by = auth.uid()
    )
  );

-- ============================================================
-- 8. club_poll_votes
-- ============================================================

CREATE TABLE IF NOT EXISTS club_poll_votes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id    UUID        NOT NULL REFERENCES club_polls(id) ON DELETE CASCADE,
  option_id  UUID        NOT NULL REFERENCES club_poll_options(id) ON DELETE CASCADE,
  voter_id   UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (poll_id, option_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_club_poll_votes_poll_id  ON club_poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_club_poll_votes_voter_id ON club_poll_votes(voter_id);

ALTER TABLE club_poll_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "club_poll_votes: members can read"
  ON club_poll_votes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM club_polls cp
      WHERE cp.id = club_poll_votes.poll_id
        AND is_club_member(cp.club_id)
    )
  );

CREATE POLICY "club_poll_votes: authenticated can vote own"
  ON club_poll_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    voter_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM club_polls cp
      WHERE cp.id = club_poll_votes.poll_id
        AND is_club_member(cp.club_id)
    )
  );

CREATE POLICY "club_poll_votes: voter can remove own vote"
  ON club_poll_votes FOR DELETE
  TO authenticated
  USING (voter_id = auth.uid());

-- ============================================================
-- 9. channel_messages
-- ============================================================

CREATE TABLE IF NOT EXISTS channel_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      UUID        NOT NULL REFERENCES club_channels(id) ON DELETE CASCADE,
  club_id         UUID        NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  sender_id       UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content         TEXT,
  attachment_url  TEXT,
  attachment_type TEXT        CHECK (attachment_type IN ('image', 'video', 'document', 'pdf', 'poll')),
  poll_id         UUID        REFERENCES club_polls(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_message_has_content
    CHECK (content IS NOT NULL OR attachment_url IS NOT NULL OR poll_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_id ON channel_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_club_id    ON channel_messages(club_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_sender_id  ON channel_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_created_at ON channel_messages(created_at);

ALTER TABLE channel_messages ENABLE ROW LEVEL SECURITY;

-- Members and officers can read messages in their clubs
CREATE POLICY "channel_messages: members can read"
  ON channel_messages FOR SELECT
  TO authenticated
  USING (is_club_member(club_id));

-- Members can send to non-restricted channels; officers can always send
CREATE POLICY "channel_messages: members can insert to open channels"
  ON channel_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND is_club_member(club_id)
    AND (
      is_club_officer(club_id)
      OR NOT EXISTS (
        SELECT 1 FROM club_channels cc
        WHERE cc.id = channel_messages.channel_id
          AND cc.is_restricted = true
      )
    )
  );

-- Sender can delete their own messages; officers can delete any
CREATE POLICY "channel_messages: sender can delete own"
  ON channel_messages FOR DELETE
  TO authenticated
  USING (
    sender_id = auth.uid()
    OR is_club_officer(club_id)
  );

-- ============================================================
-- 10. UPDATE club_photos RLS POLICIES
-- Drop old broad policies, replace with scoped ones.
-- ============================================================

DROP POLICY IF EXISTS "club_photos: anyone authenticated can read"   ON club_photos;
DROP POLICY IF EXISTS "club_photos: members can insert"              ON club_photos;
DROP POLICY IF EXISTS "club_photos: officers can delete"             ON club_photos;

-- Only visible photos are public
CREATE POLICY "club_photos: anyone can read visible"
  ON club_photos FOR SELECT
  TO authenticated
  USING (is_visible = true);

-- Officers upload directly; trigger handles tagged_post (SECURITY DEFINER bypasses RLS)
CREATE POLICY "club_photos: officers can insert"
  ON club_photos FOR INSERT
  TO authenticated
  WITH CHECK (is_club_officer(club_id));

-- Officers can hide photos (set is_visible = false)
CREATE POLICY "club_photos: officers can update"
  ON club_photos FOR UPDATE
  TO authenticated
  USING (is_club_officer(club_id));

-- Officers can permanently remove photos
CREATE POLICY "club_photos: officers can delete"
  ON club_photos FOR DELETE
  TO authenticated
  USING (is_club_officer(club_id));

-- ============================================================
-- 11. TRIGGERS
-- ============================================================

-- Auto-create 3 default channels when a club is created
CREATE OR REPLACE FUNCTION handle_club_created_channels()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO club_channels (club_id, name, is_restricted)
  VALUES
    (NEW.id, 'general',       false),
    (NEW.id, 'announcements', true),  -- officers post, members read
    (NEW.id, 'events',        false);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_club_created_channels ON clubs;
CREATE TRIGGER trg_club_created_channels
  AFTER INSERT ON clubs
  FOR EACH ROW EXECUTE FUNCTION handle_club_created_channels();

-- Update club last_activity_at when a channel message is sent
-- Also reset inactivity warning so the 2-day countdown resets on new activity
CREATE OR REPLACE FUNCTION update_club_activity_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE clubs
  SET last_activity_at    = NOW(),
      inactivity_warned_at = NULL
  WHERE id = NEW.club_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_channel_message_club_activity ON channel_messages;
CREATE TRIGGER trg_channel_message_club_activity
  AFTER INSERT ON channel_messages
  FOR EACH ROW EXECUTE FUNCTION update_club_activity_on_message();

-- Update club last_activity_at when a new event is created
CREATE OR REPLACE FUNCTION update_club_activity_on_event()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE clubs
  SET last_activity_at    = NOW(),
      inactivity_warned_at = NULL
  WHERE id = NEW.club_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_event_club_activity ON events;
CREATE TRIGGER trg_event_club_activity
  AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION update_club_activity_on_event();

-- Auto-add tagged post photo to club_photos when a post has club_id + image_url
CREATE OR REPLACE FUNCTION handle_post_tagged_club_photo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.club_id IS NOT NULL AND NEW.image_url IS NOT NULL THEN
    INSERT INTO club_photos (club_id, url, uploaded_by, source, post_id, is_visible)
    VALUES (NEW.club_id, NEW.image_url, NEW.author_id, 'tagged_post', NEW.id, true)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_post_tagged_club_photo ON posts;
CREATE TRIGGER trg_post_tagged_club_photo
  AFTER INSERT ON posts
  FOR EACH ROW EXECUTE FUNCTION handle_post_tagged_club_photo();

-- ============================================================
-- 12. INACTIVITY CHECK FUNCTION (called by pg_cron)
-- ============================================================

CREATE OR REPLACE FUNCTION check_club_inactivity()
RETURNS void AS $$
DECLARE
  v_month INT;
  v_club  RECORD;
  v_off   RECORD;
BEGIN
  v_month := EXTRACT(MONTH FROM NOW())::INT;
  -- Do not run during June (6), July (7), or December (12)
  IF v_month IN (6, 7, 12) THEN
    RETURN;
  END IF;

  -- Step 1: Warn clubs inactive for 30+ days with no prior warning
  FOR v_club IN
    SELECT id, name
    FROM clubs
    WHERE is_active = true
      AND (last_activity_at IS NULL OR last_activity_at < NOW() - INTERVAL '30 days')
      AND inactivity_warned_at IS NULL
  LOOP
    UPDATE clubs SET inactivity_warned_at = NOW() WHERE id = v_club.id;

    -- Notify every officer of the inactive club
    FOR v_off IN
      SELECT user_id FROM club_members
      WHERE club_id = v_club.id AND role = 'officer'
    LOOP
      INSERT INTO notifications (user_id, type, entity_id, entity_type)
      VALUES (v_off.user_id, 'club_inactive', v_club.id, 'club');
    END LOOP;
  END LOOP;

  -- Step 2: Soft-delete clubs still inactive 2+ days after warning
  UPDATE clubs
  SET is_active = false
  WHERE is_active = true
    AND inactivity_warned_at IS NOT NULL
    AND inactivity_warned_at < NOW() - INTERVAL '2 days'
    AND (last_activity_at IS NULL OR last_activity_at < inactivity_warned_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule pg_cron (best-effort: silently skips if extension is unavailable)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule('check-club-inactivity');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'check-club-inactivity',
    '0 9 * * *',
    'SELECT check_club_inactivity()'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ============================================================
-- 13. STORAGE BUCKETS
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'club-covers', 'club-covers', true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'club-avatars', 'club-avatars', true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'club-photos', 'club-photos', true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
) ON CONFLICT (id) DO NOTHING;

-- Private bucket for chat attachments — paths must start with {club_id}/
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments', 'chat-attachments', false,
  52428800,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
) ON CONFLICT (id) DO NOTHING;

-- Storage policies — public buckets: authenticated officers can write
DROP POLICY IF EXISTS "club-covers: public read" ON storage.objects;
CREATE POLICY "club-covers: public read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'club-covers');

DROP POLICY IF EXISTS "club-covers: officers can upload" ON storage.objects;
CREATE POLICY "club-covers: officers can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'club-covers'
    AND is_club_officer((storage.foldername(name))[1]::UUID)
  );

DROP POLICY IF EXISTS "club-covers: officers can delete" ON storage.objects;
CREATE POLICY "club-covers: officers can delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'club-covers'
    AND is_club_officer((storage.foldername(name))[1]::UUID)
  );

DROP POLICY IF EXISTS "club-avatars: public read" ON storage.objects;
CREATE POLICY "club-avatars: public read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'club-avatars');

DROP POLICY IF EXISTS "club-avatars: officers can upload" ON storage.objects;
CREATE POLICY "club-avatars: officers can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'club-avatars'
    AND is_club_officer((storage.foldername(name))[1]::UUID)
  );

DROP POLICY IF EXISTS "club-avatars: officers can delete" ON storage.objects;
CREATE POLICY "club-avatars: officers can delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'club-avatars'
    AND is_club_officer((storage.foldername(name))[1]::UUID)
  );

DROP POLICY IF EXISTS "club-photos: public read" ON storage.objects;
CREATE POLICY "club-photos: public read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'club-photos');

DROP POLICY IF EXISTS "club-photos: officers can upload" ON storage.objects;
CREATE POLICY "club-photos: officers can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'club-photos'
    AND is_club_officer((storage.foldername(name))[1]::UUID)
  );

DROP POLICY IF EXISTS "club-photos: officers can delete" ON storage.objects;
CREATE POLICY "club-photos: officers can delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'club-photos'
    AND is_club_officer((storage.foldername(name))[1]::UUID)
  );

-- Private chat-attachments: only club members can read or write
-- File paths must be: {club_id}/{channel_id}/{filename}
DROP POLICY IF EXISTS "chat-attachments: members can read" ON storage.objects;
CREATE POLICY "chat-attachments: members can read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND is_club_member((storage.foldername(name))[1]::UUID)
  );

DROP POLICY IF EXISTS "chat-attachments: members can upload" ON storage.objects;
CREATE POLICY "chat-attachments: members can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND is_club_member((storage.foldername(name))[1]::UUID)
  );

DROP POLICY IF EXISTS "chat-attachments: uploader can delete" ON storage.objects;
CREATE POLICY "chat-attachments: uploader can delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND owner = auth.uid()
  );
