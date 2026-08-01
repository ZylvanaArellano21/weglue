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

-- ── Reproduce Supabase's DEFAULT PRIVILEGES ────────────────────────────────
--
-- Supabase configures ALTER DEFAULT PRIVILEGES so every new function in
-- `public` receives an EXPLICIT EXECUTE grant for anon, authenticated and
-- service_role. A plain postgres database does not, which made a real Day 10B2
-- defect invisible here: `REVOKE ... FROM PUBLIC` looked sufficient in the
-- shadow database while leaving an explicit `authenticated` grant intact in
-- production, so students could enumerate any account's restriction state.
--
-- Reproducing it means a migration that forgets to name `authenticated` now
-- fails the SECDEF coverage test locally, before it can reach production.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

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
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Used only by check_club_inactivity() (migration 006, grants fixed in 060).
  last_activity_at     timestamptz,
  inactivity_warned_at timestamptz
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
  -- Full production shape: migration 056's officer snapshot reads
  -- display_name / avatar_url / display_order, so a trimmed fixture would make
  -- the real 056 file fail to apply here.
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  display_name  text,
  role_title    text,
  avatar_url    text,
  display_order integer,
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

-- Poll tables, column-for-column as production defines them. create_poll()
-- writes to messages + polls + poll_options in one transaction, so the harness
-- needs all three to prove the write is atomic under a guard failure.
CREATE TABLE polls (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  question       text NOT NULL,
  allow_multiple boolean NOT NULL DEFAULT false,
  start_at       timestamptz,
  end_at         timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE poll_options (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id       uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_text   text NOT NULL,
  display_order integer NOT NULL
);

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

CREATE TABLE deletion_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  reason       text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed    boolean NOT NULL DEFAULT false
);

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

-- ---------------------------------------------------------------------------
-- create_poll() — reproduced VERBATIM from production (pg_proc.prosrc), with
-- production's exact 8-parameter signature, DEFAULTs and grant posture.
--
-- This is deliberately the DEFECTIVE pre-060 state: migration 058 tried to wrap
-- `create_poll(uuid,uuid,text,text[],boolean)` — five parameters — which never
-- resolved against this eight-parameter reality, and 058's
-- `EXCEPTION WHEN undefined_function ... CONTINUE` swallowed the miss. The
-- fixture must reproduce that miss, or the 060 negative control proves nothing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_poll(
  p_conversation_id uuid,
  p_channel_id      uuid,
  p_question        text,
  p_options         text[],
  p_allow_multiple  boolean DEFAULT false,
  p_start_at        timestamptz DEFAULT NULL,
  p_end_at          timestamptz DEFAULT NULL,
  p_client_tag      uuid DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_message_id UUID;
  v_poll_id UUID;
  v_opt TEXT;
  v_idx INT := 0;
  v_channel RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT is_conversation_participant(p_conversation_id) THEN
    RAISE EXCEPTION 'not_a_participant';
  END IF;
  IF btrim(COALESCE(p_question,'')) = '' THEN RAISE EXCEPTION 'question_required'; END IF;
  IF p_options IS NULL OR array_length(array_remove(ARRAY(SELECT btrim(o) FROM unnest(p_options) o WHERE btrim(o) <> ''), NULL), 1) < 2 THEN
    RAISE EXCEPTION 'need_two_options';
  END IF;
  IF p_start_at IS NOT NULL AND p_end_at IS NOT NULL AND p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'end_before_start';
  END IF;

  IF p_channel_id IS NOT NULL THEN
    SELECT cc.conversation_id INTO v_channel
    FROM conversation_channels cc WHERE cc.id = p_channel_id;
    IF NOT FOUND OR v_channel.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION 'channel_mismatch';
    END IF;
    IF NOT can_post_in_channel(p_channel_id) THEN
      RAISE EXCEPTION 'channel_restricted';
    END IF;
  END IF;

  IF p_client_tag IS NOT NULL THEN
    SELECT m.id, p.id INTO v_message_id, v_poll_id
    FROM messages m JOIN polls p ON p.message_id = m.id
    WHERE m.sender_id = auth.uid() AND m.client_tag = p_client_tag;
    IF FOUND THEN
      RETURN json_build_object('message_id', v_message_id, 'poll_id', v_poll_id);
    END IF;
  END IF;

  INSERT INTO messages (conversation_id, channel_id, sender_id, content, message_type, client_tag)
  VALUES (p_conversation_id, p_channel_id, auth.uid(), NULL, 'poll', p_client_tag)
  RETURNING id INTO v_message_id;

  INSERT INTO polls (message_id, question, allow_multiple, start_at, end_at)
  VALUES (v_message_id, btrim(p_question), COALESCE(p_allow_multiple,false), p_start_at, p_end_at)
  RETURNING id INTO v_poll_id;

  FOREACH v_opt IN ARRAY p_options LOOP
    IF btrim(v_opt) <> '' THEN
      INSERT INTO poll_options (poll_id, option_text, display_order)
      VALUES (v_poll_id, btrim(v_opt), v_idx);
      v_idx := v_idx + 1;
    END IF;
  END LOOP;

  RETURN json_build_object('message_id', v_message_id, 'poll_id', v_poll_id);
END;
$$;

-- Production ACL, exactly: =X/ (explicit PUBLIC) + authenticated + service_role.
-- ALTER DEFAULT PRIVILEGES above would also hand this to anon, which production
-- does NOT have, so the grantee set is stated explicitly rather than inherited.
REVOKE ALL ON FUNCTION public.create_poll(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_poll(uuid,uuid,text,text[],boolean,timestamptz,timestamptz,uuid)
  TO PUBLIC, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- check_club_inactivity() — reproduced verbatim from production (migration 006).
-- Pre-059 grant posture: PUBLIC + anon + authenticated + service_role, i.e.
-- any unauthenticated caller can drive club warning and soft-deletion.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_club_inactivity()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month INT;
  v_club  RECORD;
  v_off   RECORD;
BEGIN
  v_month := EXTRACT(MONTH FROM NOW())::INT;
  IF v_month IN (6, 7, 12) THEN
    RETURN;
  END IF;

  FOR v_club IN
    SELECT id, name
    FROM clubs
    WHERE is_active = true
      AND (last_activity_at IS NULL OR last_activity_at < NOW() - INTERVAL '30 days')
      AND inactivity_warned_at IS NULL
  LOOP
    UPDATE clubs SET inactivity_warned_at = NOW() WHERE id = v_club.id;

    FOR v_off IN
      SELECT user_id FROM club_members
      WHERE club_id = v_club.id AND role = 'officer'
    LOOP
      INSERT INTO notifications (user_id, type, entity_id, entity_type)
      VALUES (v_off.user_id, 'club_inactive', v_club.id, 'club');
    END LOOP;
  END LOOP;

  UPDATE clubs
  SET is_active = false
  WHERE is_active = true
    AND inactivity_warned_at IS NOT NULL
    AND inactivity_warned_at < NOW() - INTERVAL '2 days'
    AND (last_activity_at IS NULL OR last_activity_at < inactivity_warned_at);
END;
$$;

REVOKE ALL ON FUNCTION public.check_club_inactivity() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_club_inactivity() TO PUBLIC, anon, authenticated, service_role;

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

-- ── delete_own_account_atomic — the REAL production definition ─────────────
--
-- Copied verbatim from the live database (pg_get_functiondef). Migration 058's
-- harness asserts that this function carries NO access predicate and that
-- `authenticated` keeps EXECUTE on it, because a restricted student must still
-- be able to delete their account. Testing a stub would make both assertions
-- meaningless, so the genuine body is used.
CREATE OR REPLACE FUNCTION public.delete_own_account_atomic()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_uid    UUID := auth.uid();
  v_email  TEXT;
  v_avatars      TEXT[] := ARRAY[]::TEXT[];
  v_posts        TEXT[] := ARRAY[]::TEXT[];
  v_club_photos  TEXT[] := ARRAY[]::TEXT[];
  v_attachments  TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;

  -- ── 1. Collect Storage object keys while the rows still point at them ──────
  -- Read-only; everything below is computed from rows that are about to be
  -- destroyed in this same transaction, so the list can neither race a
  -- concurrent write nor miss a row.

  -- Avatar. avatar_type = 'text' means an initials avatar — no object exists.
  SELECT COALESCE(
           array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL),
           ARRAY[]::TEXT[]
         )
    INTO v_avatars
    FROM (
      SELECT public.storage_path_from_public_url(pr.avatar_url, 'avatars') AS p
      FROM   public.profiles pr
      WHERE  pr.id = v_uid
        AND  pr.avatar_url IS NOT NULL
        AND  COALESCE(pr.avatar_type, '') <> 'text'
    ) s;

  -- Post images (posts cascade from the profile).
  SELECT COALESCE(
           array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL),
           ARRAY[]::TEXT[]
         )
    INTO v_posts
    FROM (
      SELECT public.storage_path_from_public_url(po.image_url, 'posts') AS p
      FROM   public.posts po
      WHERE  po.author_id = v_uid
        AND  po.image_url IS NOT NULL
    ) s;

  -- Club-gallery photos the user uploaded. The bucket filter is what separates
  -- the two kinds: a gallery upload lives in `club-photos`, while a photo
  -- materialized from a post still points at the `posts` object and therefore
  -- returns NULL here — its key is already in v_posts, so it is never listed
  -- twice or swept from the wrong bucket.
  SELECT COALESCE(
           array_agg(DISTINCT p) FILTER (WHERE p IS NOT NULL),
           ARRAY[]::TEXT[]
         )
    INTO v_club_photos
    FROM (
      SELECT public.storage_path_from_public_url(cp.url, 'club-photos') AS p
      FROM   public.club_photos cp
      WHERE  cp.uploaded_by = v_uid
        AND  cp.url IS NOT NULL
    ) s;

  -- Attachments on messages that are about to be HARD-deleted (solo threads).
  -- Attachments on messages that survive anonymized stay, exactly like their
  -- message text — removing them would punch holes in other people's history.
  -- attachment_url is already a bucket-relative key, not a public URL.
  SELECT COALESCE(
           array_agg(DISTINCT m.attachment_url),
           ARRAY[]::TEXT[]
         )
    INTO v_attachments
    FROM public.messages m
    WHERE m.sender_id = v_uid
      AND m.attachment_url IS NOT NULL
      AND NOT EXISTS (
            SELECT 1
            FROM   public.conversation_participants cp
            WHERE  cp.conversation_id = m.conversation_id
              AND  cp.user_id <> v_uid
          );

  -- ── 2. Residues with no FK: scrub the uuid out of other users' rows ───────
  UPDATE public.events
  SET    specific_user_ids = array_remove(specific_user_ids, v_uid)
  WHERE  specific_user_ids IS NOT NULL
    AND  v_uid = ANY (specific_user_ids);

  UPDATE public.notifications
  SET    group_actors = array_remove(group_actors, v_uid),
         group_count  = GREATEST(
                          COALESCE(array_length(array_remove(group_actors, v_uid), 1), 0),
                          0
                        )
  WHERE  group_actors IS NOT NULL
    AND  v_uid = ANY (group_actors);

  -- The deletion request the user may have filed from the public web form.
  IF v_email IS NOT NULL THEN
    DELETE FROM public.deletion_requests dr
    WHERE  lower(dr.email) = lower(v_email);
  END IF;

  -- ── 3. Moderation evidence: keep the report, drop the reporter's identity ─
  -- reporter_id is nulled here rather than left to the FK's SET NULL, for the
  -- ordering reason documented at step 6.
  UPDATE public.reports r
  SET    reporter_id       = NULL,
         reporter_email    = NULL,
         reporter_username = NULL
  WHERE  r.reporter_id = v_uid;

  -- ── 4. Rows the FK would have left dangling with a NULL owner ─────────────
  -- An officer grant with no user, a live invite token with no creator, and a
  -- post-permission grant for a user who no longer exists are not "anonymized
  -- shared content" — they are orphans. Delete them.
  DELETE FROM public.club_officers    WHERE user_id    = v_uid;
  DELETE FROM public.chat_invitations WHERE created_by = v_uid;
  DELETE FROM public.channel_posters  WHERE user_id    = v_uid;

  -- Every club-gallery photo connected to this user: the ones they uploaded
  -- straight into the gallery AND the ones materialized from their own posts.
  DELETE FROM public.club_photos cp
  WHERE  cp.uploaded_by = v_uid
     OR  cp.post_id IN (SELECT p.id FROM public.posts p WHERE p.author_id = v_uid);

  -- ── 5. Solo-thread messages (044, unchanged) ──────────────────────────────
  -- Nobody else is in the thread, so hard-delete rather than leave anonymized
  -- orphans. Must run BEFORE the SET NULL sweep below, while sender_id still
  -- points at this user.
  DELETE FROM public.messages m
  WHERE  m.sender_id = v_uid
    AND  NOT EXISTS (
           SELECT 1
           FROM   public.conversation_participants cp
           WHERE  cp.conversation_id = m.conversation_id
             AND  cp.user_id <> v_uid
         );

  -- ── 6. Pre-empt EVERY ON DELETE SET NULL back-reference ───────────────────
  --
  -- THIS IS A BUG FIX, not tidiness. Deleting the profile fires two kinds of
  -- referential action at once: CASCADE deletes (posts, events, …) and SET NULL
  -- updates (club_photos.uploaded_by, messages.sender_id, …). Postgres does not
  -- order them relative to each other, and a SET NULL update re-validates the
  -- OTHER foreign keys on the row it rewrites. When the row it rewrites also
  -- points at something the cascade has already removed, that re-validation
  -- fails and the whole deletion aborts.
  --
  -- Reproduced on the live schema: a user with a single club post could not be
  -- deleted at all —
  --   ERROR 23503: insert or update on table "club_photos" violates foreign key
  --   constraint "club_photos_post_id_fkey" … CONTEXT: DELETE FROM auth.users
  -- because club_photos.uploaded_by SET NULL rewrote a row whose post_id had
  -- just been cascade-deleted. messages carries the same shape via
  -- shared_post_id / shared_event_id.
  --
  -- 044's transaction was doing its job perfectly here: it rolled the failure
  -- back and left the account intact. The user simply saw "Could not delete
  -- your account" every single time — which is exactly the App Store 5.1.1(v)
  -- symptom, an in-app deletion option that does not actually delete.
  --
  -- Performing every SET NULL explicitly, first, means no referential UPDATE is
  -- still in flight when the cascade runs, so nothing can be re-validated
  -- against a half-removed graph. The end state is identical to what the FKs
  -- would have produced; only the ordering is now deterministic.
  UPDATE public.messages SET sender_id  = NULL WHERE sender_id  = v_uid;
  UPDATE public.messages SET deleted_by = NULL WHERE deleted_by = v_uid;
  UPDATE public.messages m SET shared_post_id = NULL
   WHERE m.shared_post_id IN (SELECT p.id FROM public.posts p WHERE p.author_id = v_uid);
  UPDATE public.messages m SET shared_event_id = NULL
   WHERE m.shared_event_id IN (SELECT e.id FROM public.events e WHERE e.created_by = v_uid);
  UPDATE public.conversations         SET created_by = NULL WHERE created_by = v_uid;
  UPDATE public.conversation_channels SET created_by = NULL WHERE created_by = v_uid;
  UPDATE public.channel_posters       SET added_by   = NULL WHERE added_by   = v_uid;

  -- ── 7. The whole account, in one statement, in this transaction ───────────
  -- Cascades to profiles and every user-owned table. Every SET NULL it would
  -- have performed has already been applied above, so this is now pure deletes.
  DELETE FROM auth.users WHERE id = v_uid;

  RETURN jsonb_build_object(
    'avatars',          to_jsonb(v_avatars),
    'posts',            to_jsonb(v_posts),
    'club-photos',      to_jsonb(v_club_photos),
    'chat-attachments', to_jsonb(v_attachments)
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.delete_own_account_atomic() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_own_account_atomic() TO authenticated;

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

ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deletion_requests: anyone can insert"
  ON deletion_requests FOR INSERT TO authenticated WITH CHECK (true);

-- Reporting must survive a block. This policy is NOT modified by 057.
CREATE POLICY "reports: users insert own"
  ON reports FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "reports: users read own"
  ON reports FOR SELECT TO authenticated USING (reporter_id = auth.uid());

-- Production grants: students reach tables through PostgREST as `authenticated`.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
REVOKE ALL ON push_queue FROM authenticated;

-- Production grants: these SECURITY DEFINER internals are service_role ONLY in
-- the live database (verified against pg_proc.proacl). A fixture that leaves
-- them on PUBLIC would make the Day 10B2 SECDEF coverage test fail here while
-- passing in production, which is the wrong way round — the fixture must be at
-- least as locked down as production, never looser.
REVOKE ALL ON FUNCTION public.user_wants_push(uuid, text)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insert_notification_once(uuid, uuid, text, uuid, text)
                                                               FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_wants_push(uuid, text)   TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_notification_once(uuid, uuid, text, uuid, text) TO service_role;

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
