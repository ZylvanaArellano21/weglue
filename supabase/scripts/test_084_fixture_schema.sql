-- ===========================================================================
-- Disposable fixture schema for the migration 084 harness ("exactly one
-- notification per add" fixes — correction 4, part 2). Superset of
-- test_083_fixture_schema.sql (adds chat_invitations, conversation_channels,
-- messages, club_joined/member_joined/officer_chat_added registry rows, and
-- blocked_user_ids()/users_have_block_relationship() stubs join_chat_
-- invitation's sibling RPCs need). Same disposable-fixture-family shape as
-- test_057_fixture_schema.sql, on a throwaway `docker run postgres:17`
-- container (not the shared stack17 stack).
-- ===========================================================================

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE anon NOLOGIN;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE SCHEMA private;
CREATE FUNCTION private.user_pair_lock_key(a UUID, b UUID) RETURNS BIGINT
LANGUAGE sql IMMUTABLE AS $$ SELECT hashtextextended(LEAST(a,b)::text || ':' || GREATEST(a,b)::text, 0); $$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY, username TEXT, full_name TEXT, avatar_url TEXT, university TEXT
);

CREATE TABLE public.clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, university TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_activity_at TIMESTAMPTZ, inactivity_warned_at TIMESTAMPTZ
);

CREATE TABLE public.club_members (
  club_id UUID, user_id UUID, role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (club_id, user_id)
);

CREATE TABLE public.club_officers (
  club_id UUID, user_id UUID, role_title TEXT, display_name TEXT, avatar_url TEXT,
  PRIMARY KEY (club_id, user_id)
);
CREATE UNIQUE INDEX uq_club_officers_club_user ON public.club_officers (club_id, user_id) WHERE user_id IS NOT NULL;

CREATE FUNCTION public.is_club_officer(p_club_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM public.club_members WHERE club_id = p_club_id AND user_id = auth.uid() AND role = 'officer');
$$;

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), type TEXT, club_id UUID, name TEXT,
  created_by UUID, deleted_at TIMESTAMPTZ
);
CREATE TABLE public.conversation_participants (
  conversation_id UUID, user_id UUID, hidden_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE public.conversation_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID,
  is_default BOOLEAN NOT NULL DEFAULT true, display_order INT NOT NULL DEFAULT 0
);
CREATE TABLE public.chat_invitations (
  token TEXT PRIMARY KEY, conversation_id UUID, created_by UUID, revoked_at TIMESTAMPTZ
);
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID, sender_id UUID,
  content TEXT, message_type TEXT, client_tag UUID
);

CREATE FUNCTION public.blocked_user_ids() RETURNS UUID[]
LANGUAGE sql STABLE AS $$ SELECT ARRAY[]::UUID[]; $$;
CREATE FUNCTION public.users_have_block_relationship(a UUID, b UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT false; $$;

-- notifications (046 shape, the subset 083/084 touch).
CREATE TABLE public.notification_types (
  type TEXT PRIMARY KEY, category TEXT, enabled BOOLEAN NOT NULL DEFAULT true,
  in_app BOOLEAN NOT NULL DEFAULT true, push BOOLEAN NOT NULL DEFAULT true,
  group_window_minutes INT NOT NULL DEFAULT 0, group_dedupe_actor BOOLEAN NOT NULL DEFAULT false,
  description TEXT, blockable BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO public.notification_types (type, category) VALUES
  ('officer_role','clubs'), ('club_chat_added','clubs'), ('group_chat_added','clubs'),
  ('club_inactive','clubs'), ('club_post','clubs'), ('club_joined','clubs'), ('member_joined','clubs'),
  ('officer_chat_added','clubs');

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL, actor_id UUID, type TEXT NOT NULL,
  entity_id UUID, entity_type TEXT, read BOOLEAN NOT NULL DEFAULT false,
  message TEXT, dedupe_key TEXT, group_count INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_notifications_dedupe_key ON public.notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE public.posts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), club_id UUID, author_id UUID);
CREATE TABLE public.club_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL, url TEXT, uploaded_by UUID,
  source TEXT CHECK (source IN ('officer_upload','tagged_post')),
  post_id UUID, is_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
