-- Minimal bridge from the existing 057 production-shaped security fixture to
-- the 063 content-lifecycle baseline. Used only by the local 069 harness; it
-- does not replace migration testing on a fully reset Supabase stack.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS building text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS room text;

CREATE TABLE IF NOT EXISTS public.event_interests (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  interest text NOT NULL,
  PRIMARY KEY (event_id, interest)
);

CREATE TABLE IF NOT EXISTS public.post_club_tags (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, club_id)
);

CREATE OR REPLACE FUNCTION public.content_is_student_visible(p_type text, p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$ SELECT true $$;

-- The 057 fixture issues `GRANT ... ON ALL TABLES IN SCHEMA public` before this
-- bridge runs, so the tables created above start with no privileges at all. In
-- production they come from 001 and carry the ordinary authenticated grants.
-- Without this, `authenticated` fails on a table-level permission check and the
-- audience-aware RLS policy on event_interests is never actually exercised.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_interests TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_club_tags TO authenticated, service_role;

-- The production base schema enables RLS on these event tables. The compact
-- 057 fixture deliberately omits unrelated pre-057 policies, so reproduce the
-- toggle here before the 069 policies are exercised under `authenticated`.
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_events ENABLE ROW LEVEL SECURITY;
