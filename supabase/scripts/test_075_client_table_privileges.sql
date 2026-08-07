-- =============================================================================
-- 075 — FRESH DATABASE PERMISSION HARNESS
--
-- Run against a database built from the migration chain ALONE:
--
--     supabase db reset            # nothing else. No fixture, no grants bridge.
--     docker exec -i <db> psql -U postgres -d postgres -f this file
--
-- The point of this harness is that it must pass with NO test-only setup. The
-- earlier `test_full_chain_grants_bridge.sql` existed precisely because the
-- chain could not stand on its own; migration 075 replaced it, and this file is
-- what proves the replacement is real rather than assumed.
--
-- Structure: every check is paired.
--   POSITIVE — a legitimate client role CAN reach what the product needs.
--   NEGATIVE — no client role can reach protected, administrative or
--              service-only data, and no role has a privilege wider than the
--              policy that authorises it.
--
-- A harness that only asserted the negatives would pass on a database where
-- nothing is granted at all — which is exactly the broken state being fixed.
-- =============================================================================

\set ON_ERROR_STOP on

-- ── 0. The bridge must be gone, and must not be silently reintroduced ───────
DO $$
BEGIN
  -- If a blanket grant is ever added, `anon` would gain SELECT on student
  -- content. That single check catches `GRANT ... ON ALL TABLES IN SCHEMA`.
  IF has_table_privilege('anon', 'public.posts', 'SELECT')
     OR has_table_privilege('anon', 'public.messages', 'SELECT')
     OR has_table_privilege('anon', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION '075: a blanket grant has reappeared — anon can read student content';
  END IF;
END;
$$;

-- ── 1. POSITIVE: every table a client legitimately uses is reachable ───────
DO $$
DECLARE
  v_table text;
  v_priv  text;
  v_pairs text[][] := ARRAY[
    -- reference / lookup
    ['app_config','SELECT'], ['universities','SELECT'], ['notification_types','SELECT'],
    ['channel_posters','SELECT'], ['club_recommendation_batches','SELECT'],
    -- profile + social graph
    ['profiles','SELECT'], ['profiles','INSERT'], ['profiles','UPDATE'],
    ['user_privacy','SELECT'], ['user_privacy','UPDATE'],
    ['user_interests','SELECT'], ['user_interests','INSERT'],
    ['user_activities','SELECT'], ['user_activities','INSERT'],
    ['follows','SELECT'], ['follows','INSERT'], ['follows','DELETE'],
    -- clubs
    ['clubs','SELECT'], ['clubs','INSERT'], ['clubs','UPDATE'],
    ['club_members','SELECT'], ['club_members','INSERT'], ['club_members','DELETE'],
    ['club_officers','SELECT'], ['club_goals','SELECT'], ['club_photos','SELECT'],
    ['club_interests','SELECT'], ['club_categories','SELECT'],
    -- events
    ['events','SELECT'], ['events','INSERT'], ['events','UPDATE'], ['events','DELETE'],
    ['event_rsvps','SELECT'], ['event_rsvps','INSERT'], ['event_rsvps','DELETE'],
    ['event_activities','SELECT'], ['event_interests','SELECT'],
    ['saved_events','SELECT'], ['saved_events','INSERT'], ['saved_events','DELETE'],
    -- posts
    ['posts','SELECT'], ['posts','INSERT'], ['posts','UPDATE'], ['posts','DELETE'],
    ['post_likes','SELECT'], ['post_likes','INSERT'],
    ['post_comments','SELECT'], ['post_comments','INSERT'],
    ['post_club_tags','SELECT'], ['post_club_tags','INSERT'],
    -- messaging
    ['messages','SELECT'], ['messages','INSERT'],
    ['conversations','SELECT'], ['conversations','UPDATE'],
    ['conversation_participants','SELECT'], ['conversation_participants','UPDATE'],
    ['conversation_channels','SELECT'], ['channel_mutes','SELECT'],
    ['channel_reads','SELECT'], ['channel_reads','UPDATE'],
    ['message_hides','SELECT'], ['message_hides','INSERT'],
    ['polls','SELECT'], ['poll_options','SELECT'], ['poll_votes','SELECT'],
    ['poll_votes','INSERT'],
    -- notifications, push, safety
    ['notifications','SELECT'], ['notifications','UPDATE'], ['notifications','DELETE'],
    ['notification_preferences','SELECT'], ['notification_preferences','UPDATE'],
    ['push_tokens','SELECT'], ['push_tokens','DELETE'],
    ['reports','SELECT'], ['reports','INSERT'],
    ['deletion_requests','INSERT'],
    -- blocking: readable, never client-writable (057 owns this)
    ['user_blocks','SELECT']
  ];
BEGIN
  FOR i IN 1 .. array_length(v_pairs, 1) LOOP
    v_table := v_pairs[i][1];
    v_priv  := v_pairs[i][2];
    IF NOT has_table_privilege('authenticated', 'public.' || quote_ident(v_table), v_priv) THEN
      RAISE EXCEPTION '075 POSITIVE: authenticated needs % on public.% and does not have it',
        v_priv, v_table;
    END IF;
  END LOOP;
END;
$$;

-- ── 2. POSITIVE: the pre-auth surface anon legitimately needs ──────────────
DO $$
BEGIN
  IF NOT has_table_privilege('anon', 'public.universities', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.clubs', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.club_interests', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.app_config', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.deletion_requests', 'INSERT') THEN
    RAISE EXCEPTION '075 POSITIVE: the pre-authentication surface is not reachable by anon';
  END IF;
END;
$$;

-- ── 3. NEGATIVE: protected / administrative / service-only stays closed ────
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'admin_audit_events', 'admin_audit_actions', 'account_restrictions',
    'account_deletion_cases', 'account_deletion_jobs',
    'transactional_email_outbox', 'content_lifecycle',
    'push_queue', 'push_tickets', 'auth_probe_rate_limits',
    'chat_invitations', 'notification_config', 'social_proof_events',
    'report_decision_history', 'report_notification_deliveries'
  ] LOOP
    IF has_table_privilege('authenticated', 'public.' || quote_ident(v_table), 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || quote_ident(v_table), 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || quote_ident(v_table), 'UPDATE')
       OR has_table_privilege('anon', 'public.' || quote_ident(v_table), 'SELECT') THEN
      RAISE EXCEPTION '075 NEGATIVE: % is reachable by a client role', v_table;
    END IF;
  END LOOP;
END;
$$;

-- ── 4. NEGATIVE: anon is confined to the pre-auth surface ──────────────────
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'profiles', 'posts', 'post_comments', 'post_likes', 'events', 'event_rsvps',
    'messages', 'conversations', 'conversation_participants', 'notifications',
    'follows', 'user_blocks', 'user_privacy', 'saved_events', 'club_members',
    'polls', 'poll_votes', 'push_tokens', 'reports'
  ] LOOP
    IF has_table_privilege('anon', 'public.' || quote_ident(v_table), 'SELECT')
       OR has_table_privilege('anon', 'public.' || quote_ident(v_table), 'INSERT') THEN
      RAISE EXCEPTION '075 NEGATIVE: anon can reach %', v_table;
    END IF;
  END LOOP;
END;
$$;

-- ── 5. NEGATIVE: no grant is wider than the policy that authorises it ──────
-- This is the check that makes "no blanket grants" mechanical rather than a
-- promise. For every table/role/command a client role holds, there must be a
-- matching RLS policy. A blanket grant fails immediately, because it also hands
-- out privileges on tables with no client policy at all.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    WITH cmds(priv, code) AS (
      VALUES ('SELECT','r'), ('INSERT','a'), ('UPDATE','w'), ('DELETE','d')
    ),
    held AS (
      SELECT c.relname AS tbl, role.name AS role, cmds.priv, cmds.code
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS role(name)
        CROSS JOIN cmds
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND has_table_privilege(role.name, c.oid, cmds.priv)
    )
    SELECT held.* FROM held
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_policy p
         JOIN pg_class pc ON pc.oid = p.polrelid
        WHERE pc.relname = held.tbl
          AND (p.polcmd = held.code OR p.polcmd = '*')
          AND (p.polroles = '{0}'::oid[]
               OR held.role::regrole::oid = ANY (p.polroles))
     )
  LOOP
    RAISE EXCEPTION
      '075 NEGATIVE: % holds % on public.% with no policy authorising it — a grant is wider than its policy',
      r.role, r.priv, r.tbl;
  END LOOP;
END;
$$;

-- ── 5b. NEGATIVE: no client role holds TRUNCATE / REFERENCES / TRIGGER ────
-- This is the class the first version of 075 missed entirely. Production was
-- provisioned when Supabase's default privileges handed anon and authenticated
-- ALL EIGHT privileges on every new table, and TRUNCATE is NOT subject to RLS —
-- so a row policy is no defence against whoever can reach it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, role.name AS role, p.priv
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS role(name)
      CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND has_table_privilege(role.name, c.oid, p.priv)
  LOOP
    RAISE EXCEPTION '075 NEGATIVE: % still holds % on public.%', r.role, r.priv, r.relname;
  END LOOP;
END;
$$;

-- ── 5c. NEGATIVE: protected tables are closed on EVERY privilege ──────────
-- The original harness only checked SELECT, which is why a table carrying the
-- full legacy blanket could still have looked half-acceptable.
DO $$
DECLARE v_table text; v_priv text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'admin_audit_events', 'admin_audit_actions', 'account_restrictions',
    'account_deletion_cases', 'account_deletion_jobs',
    'transactional_email_outbox', 'content_lifecycle',
    'push_queue', 'push_tickets', 'auth_probe_rate_limits',
    'chat_invitations', 'notification_config', 'social_proof_events',
    'report_decision_history', 'report_notification_deliveries'
  ] LOOP
    CONTINUE WHEN to_regclass('public.' || quote_ident(v_table)) IS NULL;
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE',
                                  'TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('authenticated', 'public.' || quote_ident(v_table), v_priv)
         OR has_table_privilege('anon', 'public.' || quote_ident(v_table), v_priv) THEN
        RAISE EXCEPTION '075 NEGATIVE: % holds % for a client role', v_table, v_priv;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- ── 5d. service_role holds only what the server flows actually perform ────
-- 064 locked report_decision_history and report_notification_deliveries to
-- SELECT. The first version of 075 re-granted write on both; this pins the
-- correction. The positive half proves the two Edge Functions still work, so a
-- future over-tightening cannot pass by revoking everything.
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['report_decision_history',
                                 'report_notification_deliveries'] LOOP
    IF has_table_privilege('service_role', 'public.' || quote_ident(v_table), 'INSERT')
       OR has_table_privilege('service_role', 'public.' || quote_ident(v_table), 'UPDATE')
       OR has_table_privilege('service_role', 'public.' || quote_ident(v_table), 'DELETE') THEN
      RAISE EXCEPTION '075 NEGATIVE: service_role may not write % (064 owns it)', v_table;
    END IF;
  END LOOP;

  -- send-push and send-report-email, the only service_role writers in the repo.
  IF NOT has_table_privilege('service_role', 'public.push_queue', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.push_tokens', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.push_tickets', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.push_tickets', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.reports', 'UPDATE') THEN
    RAISE EXCEPTION '075 POSITIVE: an Edge Function lost a write it performs';
  END IF;

  -- The Admin Dashboard reads; it never writes a table directly.
  IF NOT has_table_privilege('service_role', 'public.profiles', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.reports', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.admin_audit_events', 'SELECT') THEN
    RAISE EXCEPTION '075 POSITIVE: the Admin Dashboard lost a read it depends on';
  END IF;
  IF has_table_privilege('service_role', 'public.posts', 'DELETE')
     OR has_table_privilege('service_role', 'public.profiles', 'DELETE') THEN
    RAISE EXCEPTION '075 NEGATIVE: service_role kept a mass-delete capability it never uses';
  END IF;
END;
$$;

-- ── 6. NEGATIVE: user_blocks stays RPC-only for mutation ───────────────────
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.user_blocks', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_blocks', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.user_blocks', 'DELETE') THEN
    RAISE EXCEPTION '075 NEGATIVE: user_blocks became client-writable';
  END IF;
END;
$$;

-- ── 7. NEGATIVE: the admin-only RPCs stay out of reach of students ─────────
DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.get_account_access_state(uuid)',
    'public.admin_audit_log(text,text,uuid,jsonb)'
  ] LOOP
    IF to_regprocedure(v_fn) IS NOT NULL
       AND has_function_privilege('authenticated', to_regprocedure(v_fn), 'EXECUTE') THEN
      RAISE EXCEPTION '075 NEGATIVE: students can execute the admin routine %', v_fn;
    END IF;
  END LOOP;

  -- POSITIVE control on the same axis: the student-facing self-probe IS
  -- callable, so the check above is about admin routines and not about a
  -- database with no function grants at all.
  IF NOT has_function_privilege('authenticated', 'public.my_access_state()', 'EXECUTE') THEN
    RAISE EXCEPTION '075 POSITIVE: students cannot call my_access_state()';
  END IF;
END;
$$;

SELECT '075 fresh-database permission harness passed' AS result;
