-- ===========================================================================
-- Production-shaped schema fixture for the migration 057 harness.
--
-- Every table shape, CHECK constraint, foreign key and RLS POLICY below was
-- copied from the LIVE production database (information_schema.columns,
-- pg_constraint, pg_policies) — not from migration files. Migration 057 is then
-- applied to it unmodified, so the policy rewrites, predicates, RPCs and
-- triggers are exercised for real rather than stubbed.
--
-- WHAT IS REAL HERE
--   • the exact production column list for every table 057 reads or writes
--   • the exact production RLS policies that 057 drops and replaces
--   • the roles production actually uses (authenticated / anon / service_role,
--     with an owner that is NOSUPERUSER BYPASSRLS, matching prod `postgres`)
--   • auth.uid() driven by a session GUC, exactly like Supabase
--
-- WHAT IS STUBBED (and why that is honest)
--   • helper functions 057 CALLS but does not change (is_conversation_participant,
--     can_post_in_channel, user_wants_push, notification_route, …) are recreated
--     with their production semantics. They are dependencies, not the subject.
--   • no realtime, no storage, no GoTrue.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── auth schema (Supabase shape) ────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY,
  email              text,
  raw_app_meta_data  jsonb,
  banned_until       timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Supabase resolves auth.uid() from the request JWT claims GUC. Tests set
-- `request.jwt.claims` to impersonate a student.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('request.jwt.claim.sub', true),
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid;
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;

-- ── core student tables ─────────────────────────────────────────────────────
CREATE TABLE universities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id                    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username              text NOT NULL UNIQUE,
  full_name             text NOT NULL,
  avatar_url            text,
  major                 text,
  bio                   text,
  is_seed               boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  avatar_type           text,
  university            text,
  email_verified        boolean NOT NULL DEFAULT false,
  onboarding_complete   boolean NOT NULL DEFAULT false,
  agreed_to_terms       boolean NOT NULL DEFAULT false,
  agreed_at             timestamptz,
  year                  text,
  username_changed_at   timestamptz,
  email_changed_at      timestamptz,
  onboarding_completed  boolean NOT NULL DEFAULT false,
  university_id         uuid REFERENCES universities(id),
  email_domain          text,
  picture_prompt_status text NOT NULL DEFAULT 'hidden'
);
CREATE INDEX idx_profiles_username_trgm  ON profiles USING gin (username  gin_trgm_ops);
CREATE INDEX idx_profiles_full_name_trgm ON profiles USING gin (full_name gin_trgm_ops);
CREATE INDEX idx_profiles_created_at     ON profiles (created_at);

CREATE TABLE user_privacy (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_private     boolean NOT NULL DEFAULT false,
  hide_interests boolean NOT NULL DEFAULT false,
  hide_events    boolean NOT NULL DEFAULT false
);

CREATE TABLE user_interests (
  user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  interest text NOT NULL,
  PRIMARY KEY (user_id, interest)
);

CREATE TABLE user_activities (
  user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity text NOT NULL,
  PRIMARY KEY (user_id, activity)
);

CREATE TABLE follows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status       text NOT NULL CHECK (status IN ('pending','accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_id, following_id)
);
CREATE INDEX idx_follows_follower_id     ON follows (follower_id);
CREATE INDEX idx_follows_following_id    ON follows (following_id);
CREATE INDEX idx_follows_follower_status ON follows (follower_id, status);
CREATE INDEX idx_follows_following_status ON follows (following_id, status);

CREATE TABLE clubs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  handle          text,
  avatar_url      text,
  cover_image_url text,
  university      text,
  university_id   uuid REFERENCES universities(id),
  is_active       boolean NOT NULL DEFAULT true,
  member_count    integer NOT NULL DEFAULT 0,
  meeting_day     text,
  meeting_time_start time,
  meeting_time_end   time,
  meeting_building   text,
  meeting_room       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE club_categories (
  club_id  uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  category text NOT NULL,
  PRIMARY KEY (club_id, category)
);

CREATE TABLE club_members (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id   uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, user_id)
);

CREATE TABLE club_officers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_title text,
  UNIQUE (club_id, user_id)
);

CREATE TABLE posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  club_id         uuid REFERENCES clubs(id) ON DELETE CASCADE,
  caption         text,
  image_url       text,
  post_type       text,
  linked_event_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_posts_author_id      ON posts (author_id);
CREATE INDEX idx_posts_club_id        ON posts (club_id);
CREATE INDEX idx_posts_created_at     ON posts (created_at);
CREATE INDEX idx_posts_author_created ON posts (author_id, created_at DESC);

CREATE TABLE post_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_post_comments_post_id ON post_comments (post_id);

CREATE TABLE post_likes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

CREATE TABLE events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  title            text NOT NULL,
  emoji            text,
  description      text,
  event_date       date,
  start_time       time,
  end_time         time,
  location         text,
  cover_image_url  text,
  visibility       text NOT NULL DEFAULT 'everyone',
  specific_user_ids uuid[],
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_activities (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  activity text NOT NULL,
  PRIMARY KEY (event_id, activity)
);

CREATE TABLE event_rsvps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE saved_events (
  user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, event_id)
);

-- ── conversations / messaging ───────────────────────────────────────────────
CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL CHECK (type IN ('direct','group','club_group','officer_chat')),
  club_id    uuid REFERENCES clubs(id) ON DELETE CASCADE,
  name       text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at timestamptz
);

CREATE TABLE conversation_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_read_at    timestamptz,
  hidden_at       timestamptz,
  cleared_before  timestamptz,
  muted_at        timestamptz,
  archived_at     timestamptz,
  UNIQUE (conversation_id, user_id)
);
CREATE INDEX idx_conv_participants_conv_id ON conversation_participants (conversation_id);
CREATE INDEX idx_conv_participants_user_id ON conversation_participants (user_id);

CREATE TABLE conversation_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  name            text,
  is_default      boolean NOT NULL DEFAULT false,
  display_order   integer NOT NULL DEFAULT 0,
  post_permission text NOT NULL DEFAULT 'everyone',
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id      uuid REFERENCES conversation_channels(id) ON DELETE CASCADE,
  sender_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  content         text,
  message_type    text NOT NULL DEFAULT 'text',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  attachment_url  text,
  shared_event_id uuid,
  shared_post_id  uuid,
  deleted_at      timestamptz,
  deleted_by      uuid,
  client_tag      uuid
);
CREATE INDEX idx_messages_conv_created ON messages (conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender_id    ON messages (sender_id);
CREATE UNIQUE INDEX uq_messages_sender_client_tag
  ON messages (sender_id, client_tag) WHERE client_tag IS NOT NULL;

CREATE TABLE chat_invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text NOT NULL UNIQUE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  club_id         uuid REFERENCES clubs(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── notifications / push ────────────────────────────────────────────────────
CREATE TABLE notification_types (
  type                 text PRIMARY KEY,
  category             text NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  in_app               boolean NOT NULL DEFAULT true,
  push                 boolean NOT NULL DEFAULT true,
  group_window_minutes integer NOT NULL DEFAULT 0,
  group_dedupe_actor   boolean NOT NULL DEFAULT false,
  description          text
);

CREATE TABLE notification_preferences (
  user_id           uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  push_enabled      boolean NOT NULL DEFAULT true,
  push_messages     boolean NOT NULL DEFAULT true,
  push_social       boolean NOT NULL DEFAULT true,
  push_clubs        boolean NOT NULL DEFAULT true,
  push_events       boolean NOT NULL DEFAULT true,
  push_social_proof boolean NOT NULL DEFAULT true
);

CREATE TABLE notification_config (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type         text NOT NULL REFERENCES notification_types(type) ON UPDATE CASCADE,
  actor_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  entity_id    uuid,
  entity_type  text CHECK (entity_type IN ('event','club','message','post')),
  read         boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  message      text,
  route        jsonb,
  group_key    text,
  dedupe_key   text,
  group_count  integer NOT NULL DEFAULT 1,
  group_actors uuid[],
  read_at      timestamptz,
  seen_at      timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX uq_notifications_dedupe_key
  ON notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE push_tokens (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token    text NOT NULL UNIQUE,
  platform text,
  status   text NOT NULL DEFAULT 'active'
);

CREATE TABLE push_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES notifications(id) ON DELETE CASCADE,
  category        text NOT NULL,
  title           text,
  body            text,
  route           jsonb NOT NULL DEFAULT '{}'::jsonb,
  collapse_key    text,
  dedupe_key      text UNIQUE,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','sent','suppressed','failed','skipped')),
  attempts        integer NOT NULL DEFAULT 0,
  scheduled_for   timestamptz NOT NULL DEFAULT now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_queue_pending ON push_queue (scheduled_for) WHERE status = 'pending';

CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  reason      text,
  details     text,
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- Helper functions 057 CALLS but does not modify — production semantics.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.is_platform_admin_auth(p_app_meta jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = 'public' AS $$
  SELECT COALESCE(p_app_meta->>'account_type', '') = 'platform_admin';
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conv_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM conversation_participants
                  WHERE conversation_id = p_conv_id AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.can_post_in_channel(p_channel_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS $$
  SELECT TRUE;
$$;

CREATE OR REPLACE FUNCTION public.user_wants_push(p_user uuid, p_category text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE prefs notification_preferences%ROWTYPE;
BEGIN
  IF p_category = 'account' THEN RETURN true; END IF;
  SELECT * INTO prefs FROM notification_preferences WHERE user_id = p_user;
  IF NOT FOUND THEN RETURN p_category <> 'social_proof'; END IF;
  IF NOT prefs.push_enabled THEN RETURN false; END IF;
  RETURN CASE p_category
    WHEN 'messages' THEN prefs.push_messages
    WHEN 'social'   THEN prefs.push_social
    WHEN 'clubs'    THEN prefs.push_clubs
    WHEN 'events'   THEN prefs.push_events
    WHEN 'social_proof' THEN prefs.push_social_proof
    ELSE true END;
END;
$$;

CREATE OR REPLACE FUNCTION public.notification_route(
  p_type text, p_entity_id uuid, p_entity_type text, p_actor_id uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = 'public' AS $$
  SELECT jsonb_build_object('type', p_type, 'entity', p_entity_id);
$$;

-- Production's BEFORE INSERT preparer. Included because trigger ORDER is part
-- of what the harness must prove: the 057 guard must fire BEFORE this one, so a
-- suppressed notification can never be merged into an existing group row.
CREATE OR REPLACE FUNCTION public.notifications_prepare()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE v_reg notification_types%ROWTYPE;
BEGIN
  SELECT * INTO v_reg FROM notification_types WHERE type = NEW.type;
  IF FOUND AND NOT v_reg.enabled THEN RETURN NULL; END IF;
  IF FOUND AND NOT v_reg.in_app THEN RETURN NULL; END IF;
  IF NEW.route IS NULL THEN
    NEW.route := notification_route(NEW.type, NEW.entity_id, NEW.entity_type, NEW.actor_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notifications_prepare
  BEFORE INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION notifications_prepare();

-- Production's follow notification triggers, so the harness proves that
-- block_user()'s DELETE FROM follows discloses nothing.
CREATE OR REPLACE FUNCTION public.insert_notification_once(
  p_user_id uuid, p_actor_id uuid, p_type text,
  p_entity_id uuid DEFAULT NULL, p_entity_type text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  IF p_user_id IS NULL OR p_actor_id IS NULL OR p_user_id = p_actor_id THEN RETURN; END IF;
  INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read)
  SELECT p_user_id, p_actor_id, p_type, p_entity_id, p_entity_type, false
  WHERE NOT EXISTS (
    SELECT 1 FROM notifications n
     WHERE n.user_id = p_user_id AND n.actor_id = p_actor_id
       AND n.type = p_type AND n.entity_id IS NOT DISTINCT FROM p_entity_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_follow_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM insert_notification_once(NEW.following_id, NEW.follower_id, 'follow_request');
  ELSIF NEW.status = 'accepted' THEN
    PERFORM insert_notification_once(NEW.following_id, NEW.follower_id, 'new_follower');
    IF EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = NEW.following_id
                AND f.following_id = NEW.follower_id AND f.status = 'accepted') THEN
      PERFORM insert_notification_once(NEW.following_id, NEW.follower_id, 'gluemate');
      PERFORM insert_notification_once(NEW.follower_id, NEW.following_id, 'gluemate');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_follow_insert_notify AFTER INSERT ON follows
  FOR EACH ROW EXECUTE FUNCTION handle_follow_insert();

CREATE OR REPLACE FUNCTION public.handle_follow_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  IF OLD.status = 'pending' THEN
    DELETE FROM notifications
     WHERE user_id = OLD.following_id AND actor_id = OLD.follower_id
       AND type = 'follow_request';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER trg_follow_delete_notify AFTER DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION handle_follow_delete();

-- ===========================================================================
-- PRODUCTION RLS POLICIES — verbatim from pg_policies, so migration 057's
-- DROP POLICY / CREATE POLICY statements operate on the real prior state.
-- ===========================================================================

ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_privacy  ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_rsvps   ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_queue    ENABLE ROW LEVEL SECURITY;   -- RLS on, zero policies

CREATE POLICY "profiles: anyone authenticated can read"
  ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles: users update own"
  ON profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "posts: anyone authenticated can read"
  ON posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "posts: authors can insert"
  ON posts FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "posts: authors can update"
  ON posts FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "posts: authors can delete"
  ON posts FOR DELETE TO authenticated USING (author_id = auth.uid());

CREATE POLICY "post_comments: anyone authenticated can read"
  ON post_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "post_comments: users insert own"
  ON post_comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "post_comments: users delete own"
  ON post_comments FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "post_likes: anyone authenticated can read"
  ON post_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "post_likes: users manage own"
  ON post_likes FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "follows: anyone authenticated can read"
  ON follows FOR SELECT TO authenticated USING (true);
CREATE POLICY "follows: authenticated can insert"
  ON follows FOR INSERT TO authenticated WITH CHECK (follower_id = auth.uid());
CREATE POLICY "follows: owner can update (accept/reject)"
  ON follows FOR UPDATE TO authenticated USING (following_id = auth.uid());
CREATE POLICY "follows: owner can delete"
  ON follows FOR DELETE TO authenticated
  USING (follower_id = auth.uid() OR following_id = auth.uid());

CREATE POLICY "messages: participants can read"
  ON messages FOR SELECT TO authenticated USING (is_conversation_participant(conversation_id));
CREATE POLICY "messages: participants can insert"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid()
              AND is_conversation_participant(conversation_id)
              AND (channel_id IS NULL OR can_post_in_channel(channel_id)));
CREATE POLICY "messages: senders can update own"
  ON messages FOR UPDATE TO authenticated USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());

CREATE POLICY "conversations: participants can read"
  ON conversations FOR SELECT TO authenticated USING (is_conversation_participant(id));
CREATE POLICY "conversations: non-members see club group chats"
  ON conversations FOR SELECT TO authenticated USING (type = 'club_group');

CREATE POLICY "conv_participants: participants can read"
  ON conversation_participants FOR SELECT TO authenticated
  USING (is_conversation_participant(conversation_id));
CREATE POLICY "conv_participants: users update own state"
  ON conversation_participants FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications: users read own"
  ON notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications: users update own (mark read)"
  ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_privacy: read all authenticated"
  ON user_privacy FOR SELECT TO authenticated USING (true);

CREATE POLICY "event_rsvps: users manage own"
  ON event_rsvps FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Reporting must survive a block. This policy is NOT modified by 057.
CREATE POLICY "reports: users insert own"
  ON reports FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "reports: users read own"
  ON reports FOR SELECT TO authenticated USING (reporter_id = auth.uid());

-- Production grants: students reach tables through PostgREST as `authenticated`.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
REVOKE ALL ON push_queue FROM authenticated;

-- ── Seed the notification type registry exactly as production has it ────────
INSERT INTO notification_types (type, category, enabled, in_app, push) VALUES
  ('follow_request','social',true,true,true),
  ('new_follower','social',true,true,true),
  ('follow_accepted','social',true,true,true),
  ('gluemate','social',true,true,true),
  ('like','social',true,true,true),
  ('comment','social',true,true,true),
  ('dm_message','messages',true,true,true),
  ('group_message','messages',true,true,true),
  ('club_chat_message','messages',true,true,true),
  ('new_message','messages',false,true,false),
  ('club_post','clubs',true,true,true),
  ('club_joined','clubs',true,true,false),
  ('club_removed','clubs',true,true,true),
  ('club_inactive','clubs',true,true,false),
  ('officer_role','clubs',true,true,true),
  ('officer_removed','clubs',true,true,true),
  ('club_chat_added','clubs',true,true,true),
  ('officer_chat_added','clubs',true,true,true),
  ('group_chat_added','clubs',true,true,true),
  ('chat_invite_joined','clubs',true,true,true),
  ('new_event','clubs',true,true,true),
  ('event_canceled','events',true,true,true),
  ('event_updated','events',true,true,true),
  ('event_rsvp','events',true,true,true),
  ('event_reminder_hour','events',true,true,true),
  ('event_reminder_now','events',true,true,true),
  ('event_reminder_tomorrow','events',true,true,true),
  ('event_last_chance','events',true,true,true),
  ('member_joined','social_proof',true,true,false),
  ('student_joined','social_proof',true,true,false);

INSERT INTO notification_config (key, value)
VALUES ('push.hourly_caps', '{"social":30,"messages":30,"clubs":30,"events":30,"social_proof":10}'::jsonb);
