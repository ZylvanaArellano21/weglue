-- ===========================================================================
-- Disposable fixture schema for the migration 087 harness (club recommendation
-- pool was excluding launch-campus clubs with NULL university_id). Same
-- disposable-fixture-family shape as test_083/084/085/086, on a throwaway
-- `docker run postgres:17` container (not the shared stack17 stack, not
-- supabase_db_weglue).
-- ===========================================================================

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE anon NOLOGIN;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE public.universities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.app_config (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  single_campus_mode BOOLEAN NOT NULL DEFAULT true,
  launch_university_id UUID REFERENCES public.universities(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  university_id UUID REFERENCES public.universities(id)
);

CREATE TABLE public.clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  handle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  cover_image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  member_count INT NOT NULL DEFAULT 0,
  university_id UUID REFERENCES public.universities(id)
);

CREATE TABLE public.club_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  interest TEXT NOT NULL
);

CREATE TABLE public.club_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  UNIQUE (club_id, user_id)
);

CREATE TABLE public.user_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  interest TEXT NOT NULL,
  UNIQUE (user_id, interest)
);

CREATE TABLE public.club_recommendation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  club_ids UUID[] NOT NULL,
  match_count INT NOT NULL,
  source TEXT NOT NULL CHECK (source = ANY (ARRAY['onboarding','interest_update'])),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status = ANY (ARRAY['active','dismissed','completed','superseded'])),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX uniq_active_rec_batch_per_user
  ON public.club_recommendation_batches (user_id) WHERE status = 'active';

-- Verbatim real definition (unchanged by 087) — the target-count rule both
-- fixed functions still rely on: at least 2 when >=2 are eligible, never
-- more than the real eligible count (never fabricated).
CREATE FUNCTION public.club_match_target_count(p_natural INT, p_eligible INT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(GREATEST(p_natural, 2), p_eligible);
$$;

-- Real clubs/club_recommendation_batches RLS grants `authenticated` SELECT
-- (via "anyone authenticated can read" / "read own" policies); the
-- SECURITY DEFINER functions under test don't need this themselves, but
-- TEST D's own verification query (confirming nothing was fabricated) reads
-- clubs directly as authenticated, same as a real client would.
GRANT SELECT ON public.clubs, public.club_interests, public.club_members,
  public.user_interests, public.profiles, public.club_recommendation_batches,
  public.universities, public.app_config TO authenticated;

-- One launch campus, matching app_config's real single-campus-mode shape.
INSERT INTO public.universities (id, name, slug) VALUES
  ('a0870000-0000-4000-8000-000000000087', 'Harness Launch University', 'harness-launch-university-087');
INSERT INTO public.app_config (id, single_campus_mode, launch_university_id) VALUES
  (true, true, 'a0870000-0000-4000-8000-000000000087');
