-- Run only against a disposable local database after migrations through 068.
-- This complements the 067 harness with cross-platform safety regressions:
-- caller-bound access, historical recipients, canonical end timestamp, and
-- the opaque selected-audience convergence trigger.

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_triggerdef(oid) INTO v_definition
    FROM pg_trigger WHERE tgname = 'trg_events_set_end_at';
  IF v_definition NOT LIKE '%BEFORE INSERT OR UPDATE%' THEN
    RAISE EXCEPTION '068: event_end_at trigger must run on every event update';
  END IF;

  IF has_function_privilege('authenticated', 'private.can_access_event(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.can_mutate_event_rsvp(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'private.can_current_user_access_event(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '068: event access helper grants are not caller-bound';
  END IF;

  SELECT pg_get_functiondef('private.validate_event_specific_audience()'::regprocedure)
    INTO v_definition;
  IF position('NOT (selected_id = ANY(v_existing_ids))' IN v_definition) = 0 THEN
    RAISE EXCEPTION '068: audience validation must distinguish existing recipients from additions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_events_broadcast_audience_sync'
  ) THEN
    RAISE EXCEPTION '068: selected-audience changes must publish an opaque convergence signal';
  END IF;
END;
$$;

BEGIN;

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('11000000-0000-0000-0000-000000000001', 'creator-068@example.test', '{}'::jsonb),
  ('11000000-0000-0000-0000-000000000002', 'former-068@example.test', '{}'::jsonb),
  ('11000000-0000-0000-0000-000000000003', 'outsider-068@example.test', '{}'::jsonb),
  ('11000000-0000-0000-0000-000000000004', 'selected-068@example.test', '{}'::jsonb);

INSERT INTO public.profiles (
  id, username, full_name, email_verified, onboarding_complete, onboarding_completed
) VALUES
  ('11000000-0000-0000-0000-000000000001', 'creator068', 'Creator 068', true, true, true),
  ('11000000-0000-0000-0000-000000000002', 'former068', 'Former 068', true, true, true),
  ('11000000-0000-0000-0000-000000000003', 'outsider068', 'Outsider 068', true, true, true),
  ('11000000-0000-0000-0000-000000000004', 'selected068', 'Selected 068', true, true, true);

INSERT INTO public.clubs (id, name, handle) VALUES
  ('21000000-0000-0000-0000-000000000001', 'Parity 068 Club', 'parity-068-club');
INSERT INTO public.club_members (club_id, user_id, role) VALUES
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'officer'),
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'member'),
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000004', 'member');

INSERT INTO public.events (
  id, club_id, created_by, title, event_date, start_time, end_time, visibility, specific_user_ids
) VALUES (
  '31000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Historical recipient', '2099-01-02', '10:00', '14:00', 'specific',
  ARRAY['11000000-0000-0000-0000-000000000002'::uuid]
);

INSERT INTO public.events (
  id, club_id, created_by, title, event_date, start_time, end_time, visibility, specific_user_ids
) VALUES (
  '31000000-0000-0000-0000-000000000002',
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Private selected event', '2099-01-02', '10:00', '14:00', 'specific',
  ARRAY['11000000-0000-0000-0000-000000000004'::uuid]
);

-- CDT and CST wall-clock conversion stays canonical and cannot be overridden.
DO $$
DECLARE
  v_cdt timestamptz;
  v_cst timestamptz;
BEGIN
  SELECT event_end_at INTO v_cdt FROM public.events WHERE id = '31000000-0000-0000-0000-000000000001';
  IF v_cdt <> '2099-01-02 20:00:00+00'::timestamptz THEN
    RAISE EXCEPTION '068: expected America/Chicago CST conversion, got %', v_cdt;
  END IF;

  UPDATE public.events
     SET event_date = '2099-07-01', end_time = '14:00'
   WHERE id = '31000000-0000-0000-0000-000000000001';
  SELECT event_end_at INTO v_cdt FROM public.events WHERE id = '31000000-0000-0000-0000-000000000001';
  IF v_cdt <> '2099-07-01 19:00:00+00'::timestamptz THEN
    RAISE EXCEPTION '068: expected America/Chicago CDT conversion, got %', v_cdt;
  END IF;

  UPDATE public.events
     SET event_end_at = '2000-01-01 00:00:00+00'
   WHERE id = '31000000-0000-0000-0000-000000000001';
  SELECT event_end_at INTO v_cst FROM public.events WHERE id = '31000000-0000-0000-0000-000000000001';
  IF v_cst <> v_cdt THEN
    RAISE EXCEPTION '068: direct event_end_at override was accepted';
  END IF;
END;
$$;

-- Existing former recipient remains after an unrelated edit; after removal the
-- stale client cannot re-add the former member.
DELETE FROM public.club_members
 WHERE club_id = '21000000-0000-0000-0000-000000000001'
   AND user_id = '11000000-0000-0000-0000-000000000002';

UPDATE public.events
   SET title = 'Historical recipient, edited'
 WHERE id = '31000000-0000-0000-0000-000000000001';

DO $$
BEGIN
  IF NOT private.can_access_event(
    '31000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000002'
  ) THEN
    RAISE EXCEPTION '068: unchanged former recipient lost historical access';
  END IF;

  -- Change audience, then attempt stale re-add to exercise the new-ID branch.
  UPDATE public.events
     SET visibility = 'everyone'
   WHERE id = '31000000-0000-0000-0000-000000000001';
  BEGIN
    UPDATE public.events
       SET visibility = 'specific',
           specific_user_ids = ARRAY['11000000-0000-0000-0000-000000000002'::uuid]
     WHERE id = '31000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '068: stale former recipient was re-added';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000003', true);
DO $$
BEGIN
  BEGIN
    PERFORM private.can_access_event(
      '31000000-0000-0000-0000-000000000002',
      '11000000-0000-0000-0000-000000000004'
    );
    RAISE EXCEPTION '068: authenticated caller invoked arbitrary-viewer predicate';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.events WHERE id = '31000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION '068: outsider read selected event payload';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;

SELECT '068 cross-platform event permission parity harness passed' AS result;
