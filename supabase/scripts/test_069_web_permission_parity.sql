-- Run only against a disposable local database after migrations through 070.
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
    RAISE EXCEPTION '069: events.event_end_at must be a non-null canonical timestamp';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_events_set_end_at'
  ) THEN
    RAISE EXCEPTION '069: event end timestamp trigger is missing';
  END IF;

  SELECT pg_get_functiondef('private.can_current_user_mutate_event_rsvp(uuid)'::regprocedure)
    INTO v_definition;
  IF position('event_end_at > now()' IN v_definition) = 0 THEN
    RAISE EXCEPTION '069: RSVP policy must reject event_end_at <= now()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'events'
       AND policyname = 'events: visibility-aware read'
       AND qual LIKE '%private.can_current_user_access_event%'
  ) THEN
    RAISE EXCEPTION '069: event reads must use the canonical audience predicate';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'event_rsvps'
       AND policyname = 'event_rsvps: users insert eligible'
       AND with_check LIKE '%private.can_current_user_mutate_event_rsvp%'
  ) THEN
    RAISE EXCEPTION '069: RSVP INSERT must be audience and expiry protected';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'saved_events'
       AND policyname = 'saved_events: users manage own'
       AND qual LIKE '%private.can_current_user_access_event%'
  ) THEN
    RAISE EXCEPTION '069: saved-event access must follow current event access';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'posts' AND cmd = 'SELECT';
  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION '069: posts must have exactly one permissive SELECT policy, found %', v_policy_count;
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.get_club_profile_events(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.search_event_audience_members(uuid,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'private.can_current_user_access_event(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'private.can_current_user_mutate_event_rsvp(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.can_access_event(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_club_profile_events(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.search_event_audience_members(uuid,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '069: web event RPC grants are not least-privilege';
  END IF;
END;
$$;

SELECT '069 web permission parity schema/security harness passed' AS result;

-- ── Behavioural RLS checks ────────────────────────────────────────────────
-- Seed under the harness owner, then switch to the ordinary authenticated
-- role. The transaction rolls back so this remains a disposable test only.
BEGIN;

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('10000000-0000-0000-0000-000000000001', 'creator@example.test', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000002', 'member@example.test', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000003', 'outsider@example.test', '{}'::jsonb),
  ('10000000-0000-0000-0000-000000000004', 'selected@example.test', '{}'::jsonb);

-- ON CONFLICT so this fixture runs on BOTH chains: the compact 057 fixture has
-- no auth trigger, while the full 001->073 chain's handle_new_user already
-- created a profile row for each auth.users insert above.
INSERT INTO public.profiles (
  id, username, full_name, email_verified, onboarding_complete, onboarding_completed
) VALUES
  ('10000000-0000-0000-0000-000000000001', 'creator', 'Event Creator', true, true, true),
  ('10000000-0000-0000-0000-000000000002', 'member', 'Club Member', true, true, true),
  ('10000000-0000-0000-0000-000000000003', 'outsider', 'Club Outsider', true, true, true),
  ('10000000-0000-0000-0000-000000000004', 'selected', 'Selected Member', true, true, true)
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username, full_name = EXCLUDED.full_name,
  email_verified = EXCLUDED.email_verified,
  onboarding_complete = EXCLUDED.onboarding_complete,
  onboarding_completed = EXCLUDED.onboarding_completed;

-- description is NOT NULL on the full chain; the handle column value is
-- deliberately left "wrong" here because 073's trigger re-derives it anyway.
INSERT INTO public.clubs (id, name, handle, description) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Parity Club', 'parity-club', 'parity fixture');

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
-- writing event_end_at directly; 070 deliberately overwrites direct attempts.
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
    RAISE EXCEPTION '069: outsider must see only everyone event, saw % rows', v_visible;
  END IF;

  SELECT count(*) INTO v_preview
    FROM public.get_club_profile_events('20000000-0000-0000-0000-000000000001') e
   WHERE e.visibility = 'members' AND e.can_open = false;
  IF v_preview <> 2 THEN
    RAISE EXCEPTION '069: outsider must receive exactly two members-only preview cards, saw %', v_preview;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.get_club_profile_events('20000000-0000-0000-0000-000000000001')
     WHERE visibility = 'specific'
  ) THEN
    RAISE EXCEPTION '069: selected event leaked through club profile RPC';
  END IF;

  BEGIN
    INSERT INTO public.event_rsvps (event_id, user_id, status)
    VALUES ('30000000-0000-0000-0000-000000000002', auth.uid(), 'going');
    RAISE EXCEPTION '069: outsider RSVP to members-only event unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.saved_events (event_id, user_id)
    VALUES ('30000000-0000-0000-0000-000000000003', auth.uid());
    RAISE EXCEPTION '069: outsider saved a selected event';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.events) <> 3 THEN
    RAISE EXCEPTION '069: ordinary member audience filtering failed';
  END IF;
  BEGIN
    INSERT INTO public.event_rsvps (event_id, user_id, status)
    VALUES ('30000000-0000-0000-0000-000000000004', auth.uid(), 'going');
    RAISE EXCEPTION '069: RSVP at exact event_end_at unexpectedly succeeded';
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
    RAISE EXCEPTION '069: picker must return current members but not its creator';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.search_event_audience_members('20000000-0000-0000-0000-000000000001', 'club mem', 50)
     WHERE username = 'member'
  ) THEN
    RAISE EXCEPTION '069: picker must support partial current-member display names';
  END IF;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- Resolution of the four rows the audit previously left at `investigating`.
-- These are negative assertions: the guards above are only meaningful if the
-- ineligible caller is actually refused, so each block drives the rejecting
-- path rather than the accepting one.
-- ───────────────────────────────────────────────────────────────────────────

RESET ROLE;
-- Seed the payloads an unauthorized caller must never receive. Written as the
-- BYPASSRLS harness owner so the seed itself is not the thing under test.
-- Founder decision (2026-08-05): the members-only club-profile card is a
-- COMPLETE presentation for a non-member — nothing is redacted. Give the
-- members-only event real content so the assertion below is meaningful.
UPDATE public.events
   SET description = 'Full members-only description',
       location = 'Main Hall',
       building = 'Building A',
       room = '204'
 WHERE id = '30000000-0000-0000-0000-000000000002';

INSERT INTO public.event_activities (event_id, activity) VALUES
  ('30000000-0000-0000-0000-000000000003', 'volleyball');
INSERT INTO public.event_interests (event_id, interest) VALUES
  ('30000000-0000-0000-0000-000000000003', 'sports');
INSERT INTO public.event_rsvps (event_id, user_id, status) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'going'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'going'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'going');
-- Two notifications for the same outsider: one about an event they may not see
-- and one about an event they may. Keeping both is what makes the negative
-- assertion below meaningful rather than an empty-table tautology.
INSERT INTO public.notifications (user_id, type, actor_id, entity_type, entity_id, message) VALUES
  ('10000000-0000-0000-0000-000000000003', 'event_updated',
   '10000000-0000-0000-0000-000000000001', 'event',
   '30000000-0000-0000-0000-000000000003', 'Selected event was updated'),
  ('10000000-0000-0000-0000-000000000003', 'event_updated',
   '10000000-0000-0000-0000-000000000001', 'event',
   '30000000-0000-0000-0000-000000000001', 'Everyone event was updated');
SET LOCAL ROLE authenticated;

-- Row: "Selected audience / officer" — only a CURRENT officer may search or
-- edit. An ordinary member is refused by the RPC and changes no event row.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE
  v_rows int;
BEGIN
  BEGIN
    PERFORM public.search_event_audience_members('20000000-0000-0000-0000-000000000001', '', 50);
    RAISE EXCEPTION '069: non-officer member was allowed to search selected recipients';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- RLS filters UPDATE silently rather than raising, so assert on row count.
  UPDATE public.events SET title = 'Hijacked'
   WHERE id = '30000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '069: non-officer member edited an event (% rows)', v_rows;
  END IF;

  -- Row: "RSVP / expired or unauthorized" — the exact end boundary blocks
  -- cancellation and status change, not only new attendance.
  DELETE FROM public.event_rsvps
   WHERE event_id = '30000000-0000-0000-0000-000000000004' AND user_id = auth.uid();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '069: RSVP cancellation succeeded at the exact end boundary';
  END IF;

  UPDATE public.event_rsvps SET status = 'cant'
   WHERE event_id = '30000000-0000-0000-0000-000000000004' AND user_id = auth.uid();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '069: RSVP status change succeeded at the exact end boundary';
  END IF;

  -- Positive control for the outsider assertions further down: an authorized
  -- member DOES see the members-only attendee row that the outsider must not.
  IF (SELECT count(*) FROM public.event_rsvps
       WHERE event_id = '30000000-0000-0000-0000-000000000002') <> 1 THEN
    RAISE EXCEPTION '069: member cannot see attendees of a members-only event they may access';
  END IF;

  -- The same member may still cancel an RSVP on a live event, proving the
  -- boundary check is the discriminator and not a blanket denial. Uses the
  -- everyone-event row so the members-only attendee row above survives.
  DELETE FROM public.event_rsvps
   WHERE event_id = '30000000-0000-0000-0000-000000000001' AND user_id = auth.uid();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '069: member could not cancel an RSVP on a live event';
  END IF;
END;
$$;

-- Positive control for the tag assertions: the selected recipient DOES receive
-- the activity/interest payload that the outsider must never see.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.event_activities
       WHERE event_id = '30000000-0000-0000-0000-000000000003') <> 1
     OR (SELECT count(*) FROM public.event_interests
          WHERE event_id = '30000000-0000-0000-0000-000000000003') <> 1 THEN
    RAISE EXCEPTION '069: selected recipient lost the tag payload for their own event';
  END IF;
END;
$$;

-- Row: "Direct links, saves, attendees, activity" and "Members-only event /
-- non-member" — no selected/members-only payload reaches an outsider through
-- any secondary route.
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.event_rsvps
       WHERE event_id = '30000000-0000-0000-0000-000000000002') <> 0 THEN
    RAISE EXCEPTION '069: outsider read attendee rows for a members-only event';
  END IF;

  IF (SELECT count(*) FROM public.event_activities
       WHERE event_id = '30000000-0000-0000-0000-000000000003') <> 0 THEN
    RAISE EXCEPTION '069: outsider read activity tags for a selected event';
  END IF;

  IF (SELECT count(*) FROM public.event_interests
       WHERE event_id = '30000000-0000-0000-0000-000000000003') <> 0 THEN
    RAISE EXCEPTION '069: outsider read interest tags for a selected event';
  END IF;

  IF (SELECT count(*) FROM public.notifications
       WHERE entity_type = 'event'
         AND entity_id = '30000000-0000-0000-0000-000000000003') <> 0 THEN
    RAISE EXCEPTION '069: outsider read a notification for an inaccessible event';
  END IF;

  -- Positive control: the sibling notification about an event they CAN see is
  -- still delivered, so the filter above is audience-based, not a blanket hide.
  IF (SELECT count(*) FROM public.notifications
       WHERE entity_type = 'event'
         AND entity_id = '30000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION '069: notification filtering hid an accessible event notification';
  END IF;

  -- Direct-ID access is the same predicate, so a known UUID leaks nothing.
  IF EXISTS (SELECT 1 FROM public.events
              WHERE id = '30000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION '069: outsider reached a selected event by direct id';
  END IF;
END;
$$;

-- Members-only club-profile presentation is COMPLETE for a non-member. This is
-- the founder's resolution of the preview question: the card is a full event
-- presentation carrying a red "Members only" badge, and only the ACTIONS are
-- restricted. A future change that starts blanking these fields must fail here.
DO $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
    FROM public.get_club_profile_events('20000000-0000-0000-0000-000000000001')
   WHERE id = '30000000-0000-0000-0000-000000000002';

  IF v_row IS NULL THEN
    RAISE EXCEPTION '069: non-member lost the members-only club-profile card entirely';
  END IF;
  IF v_row.can_open IS DISTINCT FROM false THEN
    RAISE EXCEPTION '069: members-only card must stay action-restricted for a non-member';
  END IF;
  IF v_row.description IS DISTINCT FROM 'Full members-only description'
     OR v_row.location IS DISTINCT FROM 'Main Hall'
     OR v_row.building IS DISTINCT FROM 'Building A'
     OR v_row.room IS DISTINCT FROM '204'
     OR v_row.event_date IS NULL
     OR v_row.start_time IS NULL
     OR v_row.end_time IS NULL
     OR v_row.event_end_at IS NULL THEN
    RAISE EXCEPTION '069: members-only club-profile information was redacted from a non-member';
  END IF;
END;
$$;

-- Row: "Members-only event / non-member" — join grants access and leave
-- removes it, with no re-authentication and no cached decision in between.
RESET ROLE;
INSERT INTO public.club_members (club_id, user_id, role) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'member');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.events) <> 3 THEN
    RAISE EXCEPTION '069: joining the club did not grant members-only access';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events
              WHERE id = '30000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION '069: joining the club leaked a selected event';
  END IF;
END;
$$;

RESET ROLE;
DELETE FROM public.club_members
 WHERE club_id = '20000000-0000-0000-0000-000000000001'
   AND user_id = '10000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.events) <> 1 THEN
    RAISE EXCEPTION '069: leaving the club did not revoke members-only access';
  END IF;
END;
$$;

-- Row: "Selected audience / officer" — demotion takes effect immediately,
-- because the guard reads club_members live rather than a cached claim.
RESET ROLE;
-- The full 001->073 chain carries migration 054's last-officer protection, which
-- the compact 057 fixture does not. Promote the existing ordinary member first
-- so the club never drops to zero officers; this is a fixture requirement, not
-- part of what is being asserted. The demoted officer below is still the only
-- subject of the assertion.
UPDATE public.club_members SET role = 'officer'
 WHERE club_id = '20000000-0000-0000-0000-000000000001'
   AND user_id = '10000000-0000-0000-0000-000000000002';
UPDATE public.club_members SET role = 'member'
 WHERE club_id = '20000000-0000-0000-0000-000000000001'
   AND user_id = '10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.search_event_audience_members('20000000-0000-0000-0000-000000000001', '', 50);
    RAISE EXCEPTION '069: demoted officer retained selected-recipient search';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;
UPDATE public.club_members SET role = 'officer'
 WHERE club_id = '20000000-0000-0000-0000-000000000001'
   AND user_id = '10000000-0000-0000-0000-000000000001';
-- Restore the fixture's original single-officer shape.
UPDATE public.club_members SET role = 'member'
 WHERE club_id = '20000000-0000-0000-0000-000000000001'
   AND user_id = '10000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;

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
    RAISE EXCEPTION '069: former member was accepted from a stale selected-member result';
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
    RAISE EXCEPTION '069: selected recipient lost the audited mobile exception after leaving';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;

SELECT '069 web permission parity RLS behaviour harness passed' AS result;
