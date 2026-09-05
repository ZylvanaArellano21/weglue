#!/usr/bin/env bash
set -euo pipefail

# Run against a disposable migrated database after migration 130.
# The runner invokes this as: test_130_event_audience_member_role.sh CONTAINER DB

CONTAINER="${1:-supabase_db_weglue}"
DB="${2:-postgres}"

MIGRATION="$(cd "$(dirname "$0")" && pwd)/../migrations/130_event_audience_member_club_role.sql"
echo "Applying migration 130 to disposable clone ${DB}…"
docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q < "$MIGRATION"

docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
BEGIN;

INSERT INTO auth.users (id, email, raw_app_meta_data)
VALUES
  ('12400000-0000-4000-8000-000000000001', 'event-role-caller@example.test', '{}'::jsonb),
  ('12400000-0000-4000-8000-000000000002', 'event-role-officer@example.test', '{}'::jsonb),
  ('12400000-0000-4000-8000-000000000003', 'event-role-member@example.test', '{}'::jsonb),
  ('12400000-0000-4000-8000-000000000004', 'event-role-cross-club@example.test', '{}'::jsonb),
  ('12400000-0000-4000-8000-000000000005', 'event-role-blocked@example.test', '{}'::jsonb);

INSERT INTO public.profiles (id, username, full_name, email_verified, onboarding_complete, onboarding_completed)
VALUES
  ('12400000-0000-4000-8000-000000000001', 'event_role_caller', 'Event Role Caller', true, true, true),
  ('12400000-0000-4000-8000-000000000002', 'event_role_officer', 'Event Role Officer', true, true, true),
  ('12400000-0000-4000-8000-000000000003', 'event_role_member', 'Event Role Member', true, true, true),
  ('12400000-0000-4000-8000-000000000004', 'event_role_cross_club', 'Event Role Cross Club', true, true, true),
  ('12400000-0000-4000-8000-000000000005', 'event_role_blocked', 'Event Role Blocked', true, true, true)
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  full_name = EXCLUDED.full_name,
  email_verified = EXCLUDED.email_verified,
  onboarding_complete = EXCLUDED.onboarding_complete,
  onboarding_completed = EXCLUDED.onboarding_completed;

INSERT INTO public.clubs (id, name, handle, description)
VALUES
  ('12400000-0000-4000-8000-000000000101', 'Event Role Hosting Club', 'event-role-hosting', '124 fixture'),
  ('12400000-0000-4000-8000-000000000102', 'Event Role Other Club', 'event-role-other', '124 fixture');

INSERT INTO public.club_members (club_id, user_id, role)
VALUES
  ('12400000-0000-4000-8000-000000000101', '12400000-0000-4000-8000-000000000001', 'officer'),
  ('12400000-0000-4000-8000-000000000101', '12400000-0000-4000-8000-000000000002', 'officer'),
  ('12400000-0000-4000-8000-000000000101', '12400000-0000-4000-8000-000000000003', 'member'),
  ('12400000-0000-4000-8000-000000000101', '12400000-0000-4000-8000-000000000004', 'member'),
  ('12400000-0000-4000-8000-000000000101', '12400000-0000-4000-8000-000000000005', 'member'),
  ('12400000-0000-4000-8000-000000000102', '12400000-0000-4000-8000-000000000004', 'officer');

INSERT INTO public.club_officers (club_id, user_id, role_title, display_name)
VALUES
  ('12400000-0000-4000-8000-000000000101', '12400000-0000-4000-8000-000000000002', 'Events Chair', 'Event Role Officer'),
  ('12400000-0000-4000-8000-000000000102', '12400000-0000-4000-8000-000000000004', 'President', 'Event Role Cross Club');

-- Seed the block under the harness owner; the RPC must still hide the row from
-- the authenticated caller through blocked_user_ids().
INSERT INTO public.user_blocks (blocker_id, blocked_id)
VALUES
  ('12400000-0000-4000-8000-000000000001', '12400000-0000-4000-8000-000000000005');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '12400000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row
    FROM public.search_event_audience_members(
      '12400000-0000-4000-8000-000000000101', '', 50
    )
   WHERE id = '12400000-0000-4000-8000-000000000002';
  IF NOT FOUND THEN
    RAISE EXCEPTION '124: hosting-club officer target was not returned';
  END IF;
  IF v_row.club_role IS DISTINCT FROM 'Events Chair'
     OR v_row.is_officer IS DISTINCT FROM true THEN
    RAISE EXCEPTION '124: hosting-club officer role payload incorrect: role=%, is_officer=%',
      v_row.club_role, v_row.is_officer;
  END IF;

  SELECT * INTO v_row
    FROM public.search_event_audience_members(
      '12400000-0000-4000-8000-000000000101', '', 50
    )
   WHERE id = '12400000-0000-4000-8000-000000000003';
  IF NOT FOUND THEN
    RAISE EXCEPTION '124: hosting-club plain member was not returned';
  END IF;
  IF v_row.club_role IS NOT NULL
     OR v_row.is_officer IS DISTINCT FROM false THEN
    RAISE EXCEPTION '124: hosting-club plain member role payload incorrect: role=%, is_officer=%',
      v_row.club_role, v_row.is_officer;
  END IF;

  SELECT * INTO v_row
    FROM public.search_event_audience_members(
      '12400000-0000-4000-8000-000000000101', '', 50
    )
   WHERE id = '12400000-0000-4000-8000-000000000004';
  IF NOT FOUND THEN
    RAISE EXCEPTION '124: cross-club officer/plain hosting member was not returned';
  END IF;
  IF v_row.club_role IS NOT NULL
     OR v_row.is_officer IS DISTINCT FROM false THEN
    RAISE EXCEPTION '124: role leaked from the other club: role=%, is_officer=%',
      v_row.club_role, v_row.is_officer;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.search_event_audience_members(
        '12400000-0000-4000-8000-000000000101', '', 50
      )
     WHERE id = '12400000-0000-4000-8000-000000000005'
  ) THEN
    RAISE EXCEPTION '124: blocked member was returned by the audience picker';
  END IF;
END;
$$;

-- Existing permission boundary: a non-officer caller still receives the
-- canonical error rather than an empty or role-enriched result.
SELECT set_config('request.jwt.claim.sub', '12400000-0000-4000-8000-000000000003', true);
DO $$
DECLARE
  v_rejected boolean := false;
  v_message text;
BEGIN
  BEGIN
    PERFORM public.search_event_audience_members(
      '12400000-0000-4000-8000-000000000101', '', 50
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_rejected := v_message = 'only_club_officers_can_select_event_members';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION '124: non-officer caller did not receive only_club_officers_can_select_event_members';
  END IF;
END;
$$;

ROLLBACK;
SQL

echo "124 event audience member club-role harness passed"
