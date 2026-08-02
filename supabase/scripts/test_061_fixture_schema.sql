-- ===========================================================================
-- Production-shaped fixture SUPPLEMENT for the migration 061 harness.
--
-- Applied immediately AFTER test_057_fixture_schema.sql and BEFORE 055, so the
-- real chain 055 → 056 → 057 → 058 → 060 → 061 runs against it unmodified.
-- In particular, the officer RPCs below must exist before 058 so that 058's
-- rename-and-wrap pass wraps them for real, exactly as it did in production.
--
-- Every shape here was copied from the LIVE production database on 2026-08-01
-- (information_schema.columns, pg_constraint, pg_policies, pg_proc.prosrc) —
-- not from migration files, and not invented.
--
-- WHAT IS REAL
--   • post_club_tags / club_photos / event_interests exact column lists + FKs
--   • the exact production RLS policies 061 drops and replaces
--   • storage_path_from_public_url with its production body
--   • the realtime private-broadcast authorizers 050 created
--   • process_event_reminders with its production body
--
-- WHAT IS STUBBED (and why that is honest)
--   • remove_post_from_club__inner / delete_club_photo_everywhere__inner keep
--     production SEMANTICS but a trimmed body: 061 only guards their WRAPPERS,
--     so the inner logic is a dependency, not the subject under test.
--   • process_social_proof_events is a no-op counter — 061 does not touch it.
--   • no realtime transport, no storage backend, no GoTrue.
-- ===========================================================================

-- ── post_club_tags ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.post_club_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, club_id)
);
ALTER TABLE public.post_club_tags ENABLE ROW LEVEL SECURITY;

-- The production policy 061 narrows: role `public` (which includes anon).
DROP POLICY IF EXISTS post_club_tags_select_public ON public.post_club_tags;
CREATE POLICY post_club_tags_select_public
  ON public.post_club_tags FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS post_club_tags_insert_own ON public.post_club_tags;
CREATE POLICY post_club_tags_insert_own
  ON public.post_club_tags FOR INSERT TO public
  WITH CHECK (EXISTS (SELECT 1 FROM public.posts p
                       WHERE p.id = post_club_tags.post_id AND p.author_id = auth.uid()));
DROP POLICY IF EXISTS post_club_tags_delete_own ON public.post_club_tags;
CREATE POLICY post_club_tags_delete_own
  ON public.post_club_tags FOR DELETE TO public
  USING (EXISTS (SELECT 1 FROM public.posts p
                  WHERE p.id = post_club_tags.post_id AND p.author_id = auth.uid()));

GRANT SELECT, INSERT, DELETE ON public.post_club_tags TO authenticated;
GRANT SELECT ON public.post_club_tags TO anon;
GRANT ALL ON public.post_club_tags TO service_role;

-- ── club_photos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  url         text NOT NULL,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  caption     text,
  source      text,
  post_id     uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  is_visible  boolean NOT NULL DEFAULT true
);
ALTER TABLE public.club_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "club_photos: authenticated read" ON public.club_photos;
CREATE POLICY "club_photos: authenticated read"
  ON public.club_photos FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.club_photos TO authenticated;
GRANT ALL ON public.club_photos TO service_role;

-- ── event_interests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_interests (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  interest text NOT NULL
);
ALTER TABLE public.event_interests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_interests: authenticated read" ON public.event_interests;
CREATE POLICY "event_interests: authenticated read"
  ON public.event_interests FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.event_interests TO authenticated;
GRANT ALL ON public.event_interests TO service_role;

-- ── reports evidence columns (production shape) ────────────────────────────
-- content_snapshot / attachment_snapshot exist in production but are populated
-- ONLY for message reports. 061's purge-block predicate reads content_snapshot,
-- so the column must be real here or the test would be vacuous.
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS content_snapshot    text;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS attachment_snapshot jsonb;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS message_id          uuid;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS message_sender_id   uuid;

-- ── messages.shared_post_id / shared_event_id ──────────────────────────────
-- The 057 fixture creates `messages`; production also carries the two shared
-- content references that 061 nulls out on purge.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS shared_post_id  uuid REFERENCES public.posts(id)  ON DELETE SET NULL;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS shared_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

-- ── events: production-only columns the 057 fixture omitted ───────────────
-- Verified against the live Production information_schema: events carries
-- building, room, is_seed and updated_at. 061's purge redaction nulls building
-- and room, so leaving them out of the fixture would make the purge test
-- vacuous (it would silently never exercise the real redaction statement).
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS building   text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS room       text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS is_seed    boolean NOT NULL DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ── posts.linked_event_id FK (production has it; fixture declared the column) ─
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_linked_event_id_fkey'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_linked_event_id_fkey
      FOREIGN KEY (linked_event_id) REFERENCES public.events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── is_club_officer (production semantics) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_club_officer(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.club_officers o
                  WHERE o.club_id = p_club_id AND o.user_id = (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.club_members m
                  WHERE m.club_id = p_club_id AND m.user_id = (SELECT auth.uid())
                    AND m.role = 'officer');
$$;

-- ── storage_path_from_public_url — VERBATIM production semantics ───────────
-- Returns the object path inside `p_bucket`, or NULL when the URL is not a
-- Supabase public object for that bucket (production holds picsum.photos URLs).
CREATE OR REPLACE FUNCTION public.storage_path_from_public_url(p_url text, p_bucket text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    regexp_replace(p_url, '^.*/storage/v1/object/public/' || p_bucket || '/', ''),
    p_url
  );
$$;

-- ── event / notification helpers used by process_event_reminders ──────────
CREATE OR REPLACE FUNCTION public.event_start_ts(p_date date, p_time time without time zone)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$ SELECT (p_date + p_time) AT TIME ZONE 'America/Chicago'; $$;

CREATE OR REPLACE FUNCTION public.notification_config_int(p_key text, p_default integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT c.value::int FROM public.notification_config c
                    WHERE c.key = p_key), p_default);
$$;

CREATE OR REPLACE FUNCTION public.process_social_proof_events()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT 0; $$;

-- ── process_event_reminders — production body (pre-061, unfiltered) ────────
-- 061 replaces this with the same body plus the lifecycle predicate, so the
-- harness proves the REPLACEMENT works rather than assuming it.
CREATE OR REPLACE FUNCTION public.process_event_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_catchup  INT := notification_config_int('reminder.catchup_window_minutes', 30);
  v_inserted INT := 0;
  v_n        INT;
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('event_reminder_tomorrow', notification_config_int('reminder.tomorrow_lead_minutes', 1440)),
      ('event_reminder_hour',     notification_config_int('reminder.hour_lead_minutes', 60)),
      ('event_reminder_now',      notification_config_int('reminder.now_lead_minutes', 0))
    ) AS k(kind, lead_minutes)
  LOOP
    INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key)
    SELECT
      rv.user_id, e.created_by, r.kind, e.id, 'event', false,
      CASE r.kind
        WHEN 'event_reminder_tomorrow' THEN e.title || ' is tomorrow.'
        WHEN 'event_reminder_hour'     THEN e.title || ' starts in one hour.'
        ELSE e.title || ' is starting now.'
      END,
      r.kind || ':' || e.id || ':' ||
        extract(epoch FROM event_start_ts(e.event_date, e.start_time))::bigint || ':' || rv.user_id
    FROM events e
    JOIN event_rsvps rv ON rv.event_id = e.id AND rv.status = 'going'
    WHERE now() >= event_start_ts(e.event_date, e.start_time) - make_interval(mins => r.lead_minutes)
      AND now() <  event_start_ts(e.event_date, e.start_time) - make_interval(mins => r.lead_minutes)
                   + make_interval(mins => v_catchup)
      AND event_start_ts(e.event_date, e.start_time) > now() - interval '5 minutes'
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_inserted := v_inserted + v_n;
  END LOOP;

  PERFORM process_social_proof_events();
  RETURN v_inserted;
END;
$$;

-- ── Realtime private-broadcast authorizers (migration 050 shape) ───────────
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.can_receive_post_interaction(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ '^post:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN EXISTS (SELECT 1 FROM public.posts p WHERE p.id = pg_catalog.substr(p_topic, 6)::uuid)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION private.can_receive_event_interaction(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ '^event:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN EXISTS (SELECT 1 FROM public.events e WHERE e.id = pg_catalog.substr(p_topic, 7)::uuid)
    ELSE false
  END;
$$;

-- ── Officer RPCs — MUST exist before 058 so its wrap pass is exercised ─────
-- Trimmed bodies with production semantics: 061 guards the WRAPPER, so the
-- inner logic is a dependency here, not the subject under test.
CREATE OR REPLACE FUNCTION public.remove_post_from_club(p_post_id uuid, p_club_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.posts SET club_id = NULL WHERE id = p_post_id AND club_id = p_club_id;
  DELETE FROM public.post_club_tags WHERE post_id = p_post_id AND club_id = p_club_id;
  DELETE FROM public.club_photos    WHERE post_id = p_post_id AND club_id = p_club_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_club_photo_everywhere(p_photo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.club_photos WHERE id = p_photo_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_post_from_club(uuid, uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_club_photo_everywhere(uuid)    TO authenticated, service_role;

-- Production ACL for the reminder job is service_role ONLY
-- (postgres=X/postgres,service_role=X/postgres). Reproducing the Supabase
-- default-privilege grant without this REVOKE made 060's coverage test fail
-- here — correctly, because an authenticated-callable SECDEF writer is exactly
-- what that test exists to catch.
REVOKE ALL ON FUNCTION public.process_event_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_event_reminders() TO service_role;

-- ── Production RLS policies that 061 replaces ─────────────────────────────
-- The 057 fixture ships the PRE-057 policy shapes; 057 and 058 then rewrite
-- them. These two are the post-058 production shapes for tables the 057 fixture
-- does not carry policies for, so 061's DROP/CREATE targets exist for real.
-- Production has RLS ENABLED on events and saved_events (verified against the
-- live pg_class). The 057 fixture created the tables without it, which would
-- have made every "removed event is invisible" assertion vacuously true.
ALTER TABLE public.events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events: visibility-aware read" ON public.events;
CREATE POLICY "events: visibility-aware read"
  ON public.events FOR SELECT TO authenticated
  USING (
        (visibility = 'everyone')
     OR (created_by = auth.uid())
     OR public.is_club_officer(club_id)
     OR (visibility = 'members' AND EXISTS (
           SELECT 1 FROM public.club_members cm
            WHERE cm.club_id = events.club_id AND cm.user_id = auth.uid()))
     OR (visibility = 'specific' AND specific_user_ids IS NOT NULL
         AND auth.uid() = ANY (specific_user_ids))
  );

DROP POLICY IF EXISTS "events: officers can insert" ON public.events;
CREATE POLICY "events: officers can insert"
  ON public.events FOR INSERT TO authenticated
  WITH CHECK (public.is_club_officer(club_id));

DROP POLICY IF EXISTS "events: officers can update/delete" ON public.events;
CREATE POLICY "events: officers can update/delete"
  ON public.events FOR UPDATE TO authenticated
  USING (public.is_club_officer(club_id));

DROP POLICY IF EXISTS "events: officers can delete" ON public.events;
CREATE POLICY "events: officers can delete"
  ON public.events FOR DELETE TO authenticated
  USING (public.is_club_officer(club_id));

DROP POLICY IF EXISTS "saved_events: users manage own" ON public.saved_events;
CREATE POLICY "saved_events: users manage own"
  ON public.saved_events FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.events        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_events  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_rsvps   TO authenticated;
GRANT ALL ON public.events TO service_role;

-- ── The event triggers whose ORDER-SENSITIVITY 061 depends on ──────────────
-- trg_event_updated_notify is the reason purge deletes RSVPs BEFORE redacting
-- an event. Reproducing it here is what makes that test meaningful.
CREATE OR REPLACE FUNCTION public.handle_event_updated_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_what TEXT;
BEGIN
  IF OLD.event_date IS DISTINCT FROM NEW.event_date
     OR OLD.start_time IS DISTINCT FROM NEW.start_time
     OR OLD.end_time IS DISTINCT FROM NEW.end_time THEN
    v_what := 'time';
  END IF;
  IF OLD.location IS DISTINCT FROM NEW.location
     OR OLD.building IS DISTINCT FROM NEW.building
     OR OLD.room IS DISTINCT FROM NEW.room THEN
    v_what := CASE WHEN v_what IS NULL THEN 'location' ELSE 'details' END;
  END IF;
  IF v_what IS NULL THEN RETURN NEW; END IF;

  INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message, group_key)
  SELECT r.user_id, NEW.created_by, 'event_updated', NEW.id, 'event', false,
         CASE v_what
           WHEN 'time'     THEN 'The time for ' || NEW.title || ' changed.'
           WHEN 'location' THEN 'The location for ' || NEW.title || ' changed.'
           ELSE NEW.title || ' was updated.'
         END,
         'event_updated:' || NEW.id
  FROM event_rsvps r
  WHERE r.event_id = NEW.id AND r.status = 'going'
    AND r.user_id <> COALESCE(NEW.created_by, r.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_updated_notify ON public.events;
CREATE TRIGGER trg_event_updated_notify
  AFTER UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.handle_event_updated_notify();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_events_updated_at ON public.events;
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
