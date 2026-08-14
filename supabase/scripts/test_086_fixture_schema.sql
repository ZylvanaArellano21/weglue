-- ===========================================================================
-- Disposable fixture schema for the migration 086 harness (members-only
-- chat invitation authorization). Superset of test_084_fixture_schema.sql:
-- adds auth.users (id, email_confirmed_at) for the new email-verification
-- gate join_chat_invitation now enforces. Same disposable-fixture-family
-- shape as test_057/084, on a throwaway `docker run postgres:17` container
-- (not the shared stack17 stack, not supabase_db_weglue).
-- ===========================================================================

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE anon NOLOGIN;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY,
  email_confirmed_at TIMESTAMPTZ
);

CREATE SCHEMA extensions;
CREATE FUNCTION extensions.gen_random_bytes(int) RETURNS BYTEA
LANGUAGE sql AS $$ SELECT decode(md5(random()::text || clock_timestamp()::text), 'hex'); $$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY, username TEXT, full_name TEXT, avatar_url TEXT, university TEXT
);

CREATE TABLE public.clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, university TEXT, avatar_url TEXT,
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  conversation_id UUID NOT NULL,
  club_id UUID,
  created_by UUID,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID, sender_id UUID,
  content TEXT, message_type TEXT, client_tag UUID
);

CREATE FUNCTION public.blocked_user_ids() RETURNS UUID[]
LANGUAGE sql STABLE AS $$ SELECT ARRAY[]::UUID[]; $$;
CREATE FUNCTION public.users_have_block_relationship(a UUID, b UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$ SELECT false; $$;

-- notifications (046 shape, the subset join_chat_invitation's trigger touches).
CREATE TABLE public.notification_types (
  type TEXT PRIMARY KEY, category TEXT, enabled BOOLEAN NOT NULL DEFAULT true,
  in_app BOOLEAN NOT NULL DEFAULT true, push BOOLEAN NOT NULL DEFAULT true,
  group_window_minutes INT NOT NULL DEFAULT 0, group_dedupe_actor BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, actor_id UUID, type TEXT, entity_id UUID, entity_type TEXT,
  read BOOLEAN NOT NULL DEFAULT false, message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- club_joined / club_chat_added / member_joined fan-out trigger (004/010
-- shape, unchanged by 086 — only exercised here so join_chat_invitation's
-- club_group branch runs against a realistic INSERT ... trigger fan-out).
CREATE FUNCTION public.handle_club_join() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_conv_id UUID;
BEGIN
  SELECT id INTO v_conv_id FROM public.conversations WHERE club_id = NEW.club_id AND type = 'club_group' LIMIT 1;
  IF v_conv_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id)
    VALUES (v_conv_id, NEW.user_id) ON CONFLICT DO NOTHING;
  END IF;
  IF NEW.user_id = auth.uid() THEN
    INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, message)
    VALUES (NEW.user_id, NEW.user_id, 'club_joined', NEW.club_id, 'club', 'joined');
  ELSE
    INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, message)
    VALUES (NEW.user_id, auth.uid(), 'club_chat_added', NEW.club_id, 'club', 'added');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_club_join_add_to_gc
  AFTER INSERT ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_club_join();

-- Pre-existing custom-group invitation, minted before 086 under the old
-- (broader) authorization rule. Seeded here — committed, not inside a test
-- transaction — so migration 086's own retroactive data-fix UPDATE runs
-- against it when applied, and TEST J can prove that fix worked.
INSERT INTO public.profiles (id, username) VALUES
  ('01010101-0101-0101-0101-010101010101','pre086_group_creator');
INSERT INTO public.conversations (id, type, created_by) VALUES
  ('02020202-0202-0202-0202-020202020202','group','01010101-0101-0101-0101-010101010101');
INSERT INTO public.chat_invitations (token, conversation_id, created_by) VALUES
  ('tok-group-1','02020202-0202-0202-0202-020202020202','01010101-0101-0101-0101-010101010101');

-- preview_chat_invitation, verbatim from 040 — untouched by 086, only
-- present here so TEST K (invalid token leaks no data) has something to
-- call; this fixture doesn't replay the rest of 040's unrelated tables.
CREATE FUNCTION public.preview_chat_invitation(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
BEGIN
  SELECT ci.conversation_id, ci.revoked_at, c.type, c.name, c.club_id, c.deleted_at,
         cl.name AS club_name, cl.avatar_url AS club_avatar, cl.university AS club_university,
         p.university AS creator_university,
         COALESCE(NULLIF(btrim(p.full_name),''), p.username) AS creator_name
  INTO v
  FROM public.chat_invitations ci
  JOIN public.conversations c ON c.id = ci.conversation_id
  LEFT JOIN public.clubs cl ON cl.id = c.club_id
  LEFT JOIN public.profiles p ON p.id = ci.created_by
  WHERE ci.token = p_token;

  IF NOT FOUND OR v.revoked_at IS NOT NULL OR v.deleted_at IS NOT NULL THEN
    RETURN json_build_object('valid', false);
  END IF;

  RETURN json_build_object(
    'valid', true,
    'type', v.type,
    'club_name', v.club_name,
    'club_avatar', v.club_avatar,
    'group_name', v.name,
    'creator_name', v.creator_name,
    'university', COALESCE(v.club_university, v.creator_university)
  );
END;
$$;
