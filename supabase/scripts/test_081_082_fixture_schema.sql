-- ===========================================================================
-- Disposable fixture schema for the migration 081/082 harness (corrections
-- 1 and 5). Same disposable-fixture-family shape as test_057_fixture_schema.sql
-- (docker run postgres:17 + pgowner + a hand-built schema + an ordered
-- migration set) — NOT a full 001->082 ledger replay, which requires the
-- real local Supabase stack (auth/storage/realtime provisioned by the CLI).
--
-- Only what 081 (first-login push permission flag) and 082 (conversation-
-- read realtime sync) actually read or write is reproduced: profiles + the
-- signup-trigger dependencies, notification_preferences, and just enough of
-- the messaging schema for mark_conversation_read/mark_channel_read.
-- ===========================================================================

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE anon NOLOGIN;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  raw_app_meta_data JSONB DEFAULT '{}'::jsonb
);
-- Supabase's real auth.uid() reads the request.jwt.claim.sub GUC; this is the
-- same shim test_057_fixture_schema.sql documents using for the same reason.
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE SCHEMA realtime;
CREATE TABLE public.realtime_send_log (id SERIAL PRIMARY KEY, topic TEXT, event TEXT, at TIMESTAMPTZ DEFAULT now());
-- Real realtime.send() ships a Broadcast frame to Supabase Realtime; here it
-- just records what WOULD have been sent, which is exactly what 082's tests
-- need to assert on (that the call happened, on the right topic).
CREATE FUNCTION realtime.send(payload JSONB, event TEXT, topic TEXT, private BOOLEAN)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.realtime_send_log(topic, event) VALUES (topic, event);
END;
$$;

CREATE TABLE public.universities (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);

-- profiles: only the columns handle_new_user()/ensure_profile() actually
-- touch (081's CREATE OR REPLACE bodies are the current production bodies
-- verbatim, per 053_platform_admin_accounts.sql, plus the one new field).
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  major TEXT,
  bio TEXT,
  is_seed BOOLEAN DEFAULT false,
  university_id UUID,
  email_domain TEXT,
  picture_prompt_status TEXT NOT NULL DEFAULT 'hidden',
  onboarding_completed BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.user_interests (user_id UUID, interest TEXT);
CREATE TABLE public.user_activities (user_id UUID, activity TEXT);

-- Dependencies handle_new_user()/ensure_profile() call but 081 does not
-- change — stubbed with production-equivalent signatures, same rationale
-- test_057_fixture_schema.sql documents for its own stubs.
CREATE FUNCTION public.resolve_signup_university_id(p_email TEXT) RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT NULL::UUID; $$;

CREATE FUNCTION public.is_platform_admin_auth(p_app_meta JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$ SELECT COALESCE(p_app_meta->>'account_type','') = 'platform_admin'; $$;

CREATE FUNCTION public.generate_club_recommendation_batch(p_user UUID, p_source TEXT) RETURNS VOID
LANGUAGE sql AS $$ SELECT NULL; $$;

-- Just enough of the messaging schema (011/041/046 shape) for
-- mark_conversation_read()/mark_channel_read().
CREATE TABLE public.conversations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), type TEXT, deleted_at TIMESTAMPTZ, created_by UUID);
CREATE TABLE public.conversation_participants (
  conversation_id UUID, user_id UUID, last_read_at TIMESTAMPTZ, joined_at TIMESTAMPTZ DEFAULT now(),
  hidden_at TIMESTAMPTZ, cleared_before TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE public.conversation_channels (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID);
CREATE TABLE public.channel_reads (channel_id UUID, user_id UUID, last_read_at TIMESTAMPTZ, PRIMARY KEY (channel_id, user_id));
CREATE FUNCTION public.is_conversation_participant(p_conv UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM public.conversation_participants WHERE conversation_id = p_conv AND user_id = auth.uid());
$$;

-- notification_preferences (046 shape) — not written by 081/082, but
-- consume_push_permission_prompt/mark_*_read share the fixture database.
CREATE TABLE public.notification_preferences (
  user_id UUID PRIMARY KEY,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  push_messages BOOLEAN NOT NULL DEFAULT true,
  push_social BOOLEAN NOT NULL DEFAULT true,
  push_clubs BOOLEAN NOT NULL DEFAULT true,
  push_events BOOLEAN NOT NULL DEFAULT true,
  push_social_proof BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
