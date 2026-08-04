-- Minimal bridge from the existing 057 production-shaped security fixture to
-- the 063 content-lifecycle baseline. Used only by the local 067 harness; it
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

-- The production base schema enables RLS on these event tables. The compact
-- 057 fixture deliberately omits unrelated pre-057 policies, so reproduce the
-- toggle here before the 067 policies are exercised under `authenticated`.
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_events ENABLE ROW LEVEL SECURITY;
