-- ===========================================================================
-- Disposable fixture schema for the migration 085 harness (student_joined
-- named copy + destination fix — correction 4, part 3, founder decisions on
-- the Fix 4 follow-up). Same disposable-fixture-family shape as
-- test_057_fixture_schema.sql, on a throwaway `docker run postgres:17`
-- container (not the shared stack17 stack).
-- ===========================================================================

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE anon NOLOGIN;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY, username TEXT, full_name TEXT, avatar_url TEXT, is_seed BOOLEAN DEFAULT false
);
CREATE TABLE public.clubs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);
CREATE TABLE public.posts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), club_id UUID, author_id UUID);
CREATE TABLE public.club_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), club_id UUID
);
CREATE TABLE public.events (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.club_members (club_id UUID, user_id UUID, role TEXT, PRIMARY KEY (club_id, user_id));

CREATE TABLE public.notification_types (
  type TEXT PRIMARY KEY, category TEXT, enabled BOOLEAN NOT NULL DEFAULT true,
  in_app BOOLEAN NOT NULL DEFAULT true, push BOOLEAN NOT NULL DEFAULT true,
  group_window_minutes INT NOT NULL DEFAULT 0, group_dedupe_actor BOOLEAN NOT NULL DEFAULT false,
  description TEXT, blockable BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO public.notification_types
  (type, category, in_app, push, group_window_minutes, group_dedupe_actor, description) VALUES
  ('student_joined', 'social_proof', true, false, 1440, true, 'A new student joined We Glue (grouped daily)'),
  ('chat_invite_joined', 'clubs', true, true, 0, false, 'Someone joined via your chat invite'),
  ('member_joined', 'social_proof', true, true, 1440, true, 'A student joined a club you are in (grouped daily)');

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL, actor_id UUID, type TEXT NOT NULL,
  entity_id UUID, entity_type TEXT, read BOOLEAN NOT NULL DEFAULT false, read_at TIMESTAMPTZ,
  message TEXT, route JSONB, dedupe_key TEXT,
  group_key TEXT, group_actors UUID[], group_count INT NOT NULL DEFAULT 1,
  seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_notifications_dedupe_key ON public.notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE public.social_proof_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL CHECK (kind IN ('student_joined')),
  actor_id   UUID NOT NULL,
  processed  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION public.notifications_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.read AND NOT COALESCE(OLD.read, false) THEN
    NEW.read_at := COALESCE(NEW.read_at, now());
  ELSIF NOT NEW.read THEN
    NEW.read_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notifications_touch
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_touch();

-- notification_route: current production body (083's version).
CREATE OR REPLACE FUNCTION public.notification_route(
  p_type TEXT, p_entity_id UUID, p_entity_type TEXT, p_actor_id UUID
) RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_type IN ('like','comment') AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','post','postId',p_entity_id)
    WHEN p_type = 'club_post' AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','post','postId',p_entity_id)
    WHEN p_type IN ('new_event','event_updated','event_reminder_tomorrow',
                    'event_reminder_hour','event_reminder_now','event_last_chance',
                    'event_rsvp') AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','event','eventId',p_entity_id)
    WHEN p_type IN ('club_joined','member_joined','officer_role','officer_removed',
                    'club_removed','club_inactive','event_canceled') AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','club','clubId',p_entity_id)
    WHEN p_type = 'club_photo' AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','club','clubId',
             (SELECT club_id FROM club_photos WHERE id = p_entity_id))
    WHEN p_type IN ('club_chat_added','officer_chat_added','group_chat_added',
                    'chat_invite_joined') AND p_entity_id IS NOT NULL
      THEN CASE WHEN p_entity_type = 'message'
                THEN jsonb_build_object('screen','chat','chatId',p_entity_id)
                ELSE jsonb_build_object('screen','club','clubId',p_entity_id) END
    WHEN p_actor_id IS NOT NULL
      THEN jsonb_build_object('screen','profile','userId',p_actor_id)
    ELSE jsonb_build_object('screen','notifications')
  END;
$$;
