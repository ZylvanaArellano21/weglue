-- Run only against a disposable local database after migrations through 068.
-- This is intentionally catalog-based as well as behavioural: RLS policy names
-- are a security boundary and a second permissive policy can silently undo a
-- correct-looking client implementation.

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_definition text;
  v_policy_count int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'events'
       AND column_name = 'event_end_at' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '067: events.event_end_at must be a non-null canonical timestamp';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_events_set_end_at'
  ) THEN
    RAISE EXCEPTION '067: event end timestamp trigger is missing';
  END IF;

  SELECT pg_get_functiondef('private.can_current_user_mutate_event_rsvp(uuid)'::regprocedure)
    INTO v_definition;
  IF position('event_end_at > now()' IN v_definition) = 0 THEN
    RAISE EXCEPTION '067: RSVP policy must reject event_end_at <= now()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'events'
       AND policyname = 'events: visibility-aware read'
       AND qual LIKE '%private.can_current_user_access_event%'
  ) THEN
    RAISE EXCEPTION '067: event reads must use the canonical audience predicate';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'event_rsvps'
       AND policyname = 'event_rsvps: users insert eligible'
       AND with_check LIKE '%private.can_current_user_mutate_event_rsvp%'
  ) THEN
    RAISE EXCEPTION '067: RSVP INSERT must be audience and expiry protected';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'saved_events'
       AND policyname = 'saved_events: users manage own'
       AND qual LIKE '%private.can_current_user_access_event%'
  ) THEN
    RAISE EXCEPTION '067: saved-event access must follow current event access';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'posts' AND cmd = 'SELECT';
  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION '067: posts must have exactly one permissive SELECT policy, found %', v_policy_count;
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.get_club_profile_events(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.search_event_audience_members(uuid,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'private.can_current_user_access_event(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'private.can_current_user_mutate_event_rsvp(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.can_access_event(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_club_profile_events(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.search_event_audience_members(uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '067: web event RPC grants are not least-privilege';
  END IF;
END;
$$;

SELECT '067 web permission parity schema/security harness passed' AS result;

-- ── Behavioural RLS checks ────────────────────────────────────────────────
-- Seed under the harness owner, then switch to the ordinary authenticated
-- role. The transaction rolls back so this remains a disposable test only.
BEGIN;

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('10000000-0000-0000-0000-000000000001', 'creator@example.test', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000002', 'member@example.test', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000003', 'outsider@example.test', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000004', 'selected@example.test', '{}'::jsonb);

INSERT INTO public.profiles (
  id, username, full_name, email_verified, onboarding_complete, onboarding_completed
) VALUES
  ('10000000-0000-0000-0000-000000000001', 'creator', 'Event Creator', true, true, true),
  ('10000000-0000-0000-0000-000000000002', 'member', 'Club Member', true, true, true),
  ('10000000-0000-0000-0000-000000000003', 'outsider', 'Club Outsider', true, true, true),
  ('10000000-0000-0000-0000-000000000004', 'selected', 'Selected Member', true, true, true);

INSERT INTO public.clubs (id, name, handle) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Parity Club', 'parity-club');

INSERT INTO public.club_members (club_id, user_id, role) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'officer'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'member'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'member');

INSERT INTO public.events (
  id, club_id, created_by, title, event_date, start_time, end_time, visibility, specific_user_ids
) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Everyone', '2099-01-01', '10:00', '12:00', 'everyone', NULL),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Members', '2099-01-01', '10:00', '12:00', 'members', NULL),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Selected', '2099-01-01', '10:00', '12:00', 'specific', ARRAY['10000000-0000-0000-0000-000000000004'::uuid]),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ended', '2099-01-01', '10:00', '12:00', 'members', NULL);

-- Derive an end instant at (just before) the current server time without
-- writing event_end_at directly; 068 deliberately overwrites direct attempts.
UPDATE public.events
   SET event_date = (now() AT TIME ZONE 'America/Chicago')::date,
       end_time = (now() AT TIME ZONE 'America/Chicago')::time
 WHERE id = '30000000-0000-0000-0000-000000000004';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);

DO $$
DECLARE
  v_visible int;
  v_preview int;
BEGIN
  SELECT count(*) INTO v_visible FROM public.events;
  IF v_visible <> 1 THEN
    RAISE EXCEPTION '067: outsider must see only everyone event, saw % rows', v_visible;
  END IF;

  SELECT count(*) INTO v_preview
    FROM public.get_club_profile_events('20000000-0000-0000-0000-000000000001') e
   WHERE e.visibility = 'members' AND e.can_open = false;
  IF v_preview <> 2 THEN
    RAISE EXCEPTION '067: outsider must receive exactly two members-only preview cards, saw %', v_preview;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.get_club_profile_events('20000000-0000-0000-0000-000000000001')
     WHERE visibility = 'specific'
  ) THEN
    RAISE EXCEPTION '067: selected event leaked through club profile RPC';
  END IF;

  BEGIN
    INSERT INTO public.event_rsvps (event_id, user_id, status)
    VALUES ('30000000-0000-0000-0000-000000000002', auth.uid(), 'going');
    RAISE EXCEPTION '067: outsider RSVP to members-only event unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.saved_events (event_id, user_id)
    VALUES ('30000000-0000-0000-0000-000000000003', auth.uid());
    RAISE EXCEPTION '067: outsider saved a selected event';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.events) <> 3 THEN
    RAISE EXCEPTION '067: ordinary member audience filtering failed';
  END IF;
  BEGIN
    INSERT INTO public.event_rsvps (event_id, user_id, status)
    VALUES ('30000000-0000-0000-0000-000000000004', auth.uid(), 'going');
    RAISE EXCEPTION '067: RSVP at exact event_end_at unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

-- Officer member picker: empty-query and partial display-name search are
-- club-scoped, exclude the creator, and enumerate current members only.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.search_event_audience_members('20000000-0000-0000-0000-000000000001', '', 50)) <> 2 THEN
    RAISE EXCEPTION '067: picker must return current members but not its creator';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.search_event_audience_members('20000000-0000-0000-0000-000000000001', 'club mem', 50)
     WHERE username = 'member'
  ) THEN
    RAISE EXCEPTION '067: picker must support partial current-member display names';
  END IF;
END;
$$;

-- Mobile keeps an already-selected recipient eligible after a later club
-- leave. The DB preserves that allow-list without allowing a stale creator
-- submission to add a former member in the first place.
RESET ROLE;
DELETE FROM public.club_members
 WHERE club_id = '20000000-0000-0000-0000-000000000001'
   AND user_id = '10000000-0000-0000-0000-000000000004';

DO $$
BEGIN
  BEGIN
    INSERT INTO public.events (
      id, club_id, created_by, title, event_date, start_time, end_time, visibility, specific_user_ids
    ) VALUES (
      '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001', 'Stale selected member', '2099-01-01', '10:00', '12:00',
      'specific', ARRAY['10000000-0000-0000-0000-000000000004'::uuid]
    );
    RAISE EXCEPTION '067: former member was accepted from a stale selected-member result';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = '30000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION '067: selected recipient lost the audited mobile exception after leaving';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;

SELECT '067 web permission parity RLS behaviour harness passed' AS result;
