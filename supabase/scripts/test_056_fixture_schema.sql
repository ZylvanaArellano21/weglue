-- ===========================================================================
-- Minimal production-shaped schema fixture for the migration 056 harness.
--
-- Only the tables and columns the admin_tx_* functions actually touch, with the
-- SAME names and types as production (verified against the live PostgREST
-- schema). This exists so migrations 054, 055 and 056 can be applied for real —
-- migration 054's last-officer protection runs unmodified against it, so the
-- "054 is preserved" claim is genuinely exercised rather than stubbed.
--
-- NOT a substitute for production: no RLS policies, no triggers beyond those
-- 054 installs, no realtime. This harness tests transactional atomicity and
-- audit coupling, nothing else.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS universities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY,
  username      TEXT,
  full_name     TEXT,
  avatar_url    TEXT,
  university_id UUID REFERENCES universities(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clubs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  handle        TEXT,
  description   TEXT,
  university_id UUID REFERENCES universities(id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  member_count  INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS club_members (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id   UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (club_id, user_id)
);

CREATE TABLE IF NOT EXISTS club_officers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  display_name  TEXT,
  role_title    TEXT NOT NULL DEFAULT 'Officer',
  avatar_url    TEXT,
  display_order INT
);

-- Migration 036 shape: a PARTIAL unique index, which is what migration 054's
-- `ON CONFLICT (club_id, user_id) WHERE user_id IS NOT NULL` requires. A plain
-- UNIQUE constraint does not satisfy that clause.
CREATE UNIQUE INDEX IF NOT EXISTS club_officers_club_user_uniq
  ON club_officers (club_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS follows (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'accepted',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     UUID REFERENCES clubs(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  emoji       TEXT,
  description TEXT,
  event_date  DATE,
  start_time  TIME,
  end_time    TIME,
  location    TEXT,
  building    TEXT,
  room        TEXT,
  visibility  TEXT NOT NULL DEFAULT 'club',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID REFERENCES profiles(id) ON DELETE CASCADE,
  club_id         UUID REFERENCES clubs(id) ON DELETE SET NULL,
  post_type       TEXT NOT NULL DEFAULT 'photo',
  image_url       TEXT,
  caption         TEXT,
  linked_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_club_tags (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  UNIQUE (post_id, club_id)
);

CREATE TABLE IF NOT EXISTS club_photos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  url        TEXT,
  post_id    UUID REFERENCES posts(id) ON DELETE CASCADE,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_rsvps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'going',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL DEFAULT 'club',
  club_id    UUID REFERENCES clubs(id) ON DELETE CASCADE,
  name       TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversation_channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  display_order   INT,
  is_restricted   BOOLEAN NOT NULL DEFAULT FALSE,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  kind            TEXT NOT NULL DEFAULT 'topic',
  post_permission TEXT NOT NULL DEFAULT 'everyone',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id      UUID REFERENCES conversation_channels(id) ON DELETE CASCADE,
  sender_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  content         TEXT,
  message_type    TEXT NOT NULL DEFAULT 'text',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID
);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'generic',
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  entity_type         TEXT NOT NULL DEFAULT 'post',
  entity_id           UUID,
  club_id             UUID REFERENCES clubs(id) ON DELETE SET NULL,
  reason              TEXT,
  details             TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  content_snapshot    TEXT,
  attachment_snapshot JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_config (
  id                  INT PRIMARY KEY DEFAULT 1,
  single_campus_mode  BOOLEAN NOT NULL DEFAULT TRUE,
  launch_university_id UUID REFERENCES universities(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Production grants: service_role has full table access (it is the server's
-- key). The audit tables deliberately do NOT follow this — migration 055
-- revokes them afterwards, and that revoke must win.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
