-- Private block-sync Realtime authorization harness. Run only against a
-- task-owned disposable local Supabase stack after migrations through 149;
-- never run against Production.
--
-- docker exec -i "$WEGLUE_HARNESS_STACK" psql -U postgres -d postgres \
--   -v ON_ERROR_STOP=1 -q < supabase/scripts/test_149_realtime_sync_block_auth.sql

\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  v_policy text;
  v_roles oid[];
  v_command "char";
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'private'
       AND p.proname = 'can_receive_block_sync'
  ) THEN
    RAISE EXCEPTION 'block-sync receive helper is missing';
  END IF;

  SELECT pg_get_expr(p.polqual, p.polrelid), p.polroles, p.polcmd
    INTO v_policy, v_roles, v_command
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'realtime'
     AND c.relname = 'messages'
     AND p.polname = 'weglue_receive_block_sync';

  IF v_policy IS NULL
     OR position('can_receive_block_sync' IN v_policy) = 0
     OR position('extension = ''broadcast''' IN v_policy) = 0
     OR v_command <> 'r'
     OR NOT ('authenticated'::regrole::oid = ANY (v_roles)) THEN
    RAISE EXCEPTION 'block-sync policy must be authenticated-only, SELECT-only, and Broadcast-only';
  END IF;

  IF has_function_privilege('anon', 'private.can_receive_block_sync(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'private.can_receive_block_sync(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'block-sync receive helper grants are not least privilege';
  END IF;
END;
$$;

BEGIN;

-- The `realtime.topic` GUC is the topic supplied by the Realtime authorization
-- query. These SELECTs therefore exercise the actual realtime.messages RLS
-- policy rather than only evaluating the helper in isolation.
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1490000-0000-4000-8000-000000000001', 'role', 'authenticated')::text,
  false
);

CREATE TEMP TABLE block_sync_authorization_result (
  test_name text PRIMARY KEY,
  visible boolean NOT NULL
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.block_sync_visible(p_topic text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_visible boolean;
BEGIN
  PERFORM set_config('realtime.topic', p_topic, false);
  SELECT EXISTS (
    SELECT 1
      FROM realtime.messages
     WHERE realtime.messages.extension = 'broadcast'
  ) INTO v_visible;
  RETURN v_visible;
END;
$$;

-- Seed one Broadcast row for the RLS probes. The real Realtime authorization
-- query supplies a candidate broadcast row with the session topic; this row
-- makes the same policy decision observable in SQL.
RESET ROLE;
INSERT INTO realtime.messages (topic, event, payload, extension, private)
VALUES ('sync:block:a1490000-0000-4000-8000-000000000001', 'invalidate', '{}'::jsonb, 'broadcast', true);
SET ROLE authenticated;

INSERT INTO block_sync_authorization_result (test_name, visible) VALUES
  ('own topic', pg_temp.block_sync_visible('sync:block:a1490000-0000-4000-8000-000000000001')),
  ('other user topic', pg_temp.block_sync_visible('sync:block:a1490000-0000-4000-8000-000000000002')),
  ('extra suffix', pg_temp.block_sync_visible('sync:block:a1490000-0000-4000-8000-000000000001:extra')),
  ('malformed uuid', pg_temp.block_sync_visible('sync:block:not-a-uuid')),
  ('missing uuid', pg_temp.block_sync_visible('sync:block:')),
  ('neighbor plural', pg_temp.block_sync_visible('sync:blocks:a1490000-0000-4000-8000-000000000001')),
  ('neighbor blocking', pg_temp.block_sync_visible('sync:blocking:a1490000-0000-4000-8000-000000000001')),
  ('unrelated namespace', pg_temp.block_sync_visible('sync:unrelated:a1490000-0000-4000-8000-000000000001'));

DO $$
BEGIN
  IF NOT (SELECT visible FROM block_sync_authorization_result WHERE test_name = 'own topic')
     OR EXISTS (
       SELECT 1
         FROM block_sync_authorization_result
        WHERE test_name <> 'own topic' AND visible
     ) THEN
    RAISE EXCEPTION 'block-sync Realtime policy did not enforce exact self-topic authorization';
  END IF;
END;
$$;

RESET ROLE;
SET ROLE anon;
SELECT set_config('realtime.topic', 'sync:block:a1490000-0000-4000-8000-000000000001', false);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM realtime.messages
     WHERE realtime.messages.extension = 'broadcast'
  ) THEN
    RAISE EXCEPTION 'unauthenticated callers must not receive block-sync broadcasts';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;

SELECT '149 realtime sync-block authorization harness passed' AS result;
