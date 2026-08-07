-- =============================================================================
-- 075 — Client table privileges
--
-- WHAT WENT WRONG THE FIRST TIME, AND WHY THIS FILE IS SHAPED LIKE THIS
--
-- The first version of 075 only GRANTED, and put its fail-closed self-check
-- AFTER `COMMIT`. Against Production that produced the worst possible outcome:
-- the grants committed, the check then failed with
--
--     075: push_queue must not be readable by a client role
--
-- and because the check aborted the session AFTER the commit, `supabase db push`
-- never recorded 075 in supabase_migrations. Production ended up carrying 075's
-- grants while believing 075 had never run.
--
-- The check was RIGHT. It found a real, pre-existing Production defect that a
-- freshly-created database cannot show:
--
--   * A database built from these migrations today gets narrow platform
--     defaults, so protected tables start with no client privileges and the
--     assertion passes trivially.
--   * PRODUCTION was provisioned years ago, when Supabase's
--     ALTER DEFAULT PRIVILEGES granted anon / authenticated / service_role
--     ALL EIGHT privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
--     REFERENCES, TRIGGER, MAINTAIN) on every newly created table. Only the
--     tables whose own migration explicitly revoked them (055, 057, 058, 061,
--     063, 064) were ever locked. Every table created without an explicit
--     REVOKE — push_queue, push_tickets, chat_invitations, notification_config,
--     social_proof_events, auth_probe_rate_limits — still carries that blanket.
--
-- So asserting was never enough: 075 has to REVOKE the legacy blanket, not just
-- describe the world it wished for. Row access was still denied (RLS is enabled
-- on every table and those six have no policies), but TRUNCATE is NOT subject to
-- RLS, and both client roles held it.
--
-- THIS VERSION THEREFORE:
--   1. REVOKEs every privilege from anon and authenticated on every table,
--   2. GRANTs back exactly what an RLS policy already authorises,
--   3. narrows service_role to what the server flows actually do,
--   4. validates INSIDE the transaction, BEFORE COMMIT, so any failure rolls
--      the whole migration back and leaves nothing half-applied.
--
-- It is idempotent and converges from BOTH starting points: a clean 001->075
-- database, and today's partially-applied Production (first-attempt grants
-- present, 075 unrecorded).
-- =============================================================================

BEGIN;

-- ── 1. Strip the legacy blanket from the client roles ──────────────────────
-- Dynamic on purpose: it must cover every table that exists, including any this
-- file does not name, so a table added by a future migration cannot inherit a
-- platform default and quietly become client-reachable. This is the opposite of
-- a blanket grant — nothing is handed out here, only taken back. Section 2 and
-- 3 then grant the exact, policy-derived set.
DO $$
DECLARE
  v_table text;
BEGIN
  FOR v_table IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v_table);
  END LOOP;
END;
$$;

-- ── 2. anon: the pre-authentication surface only ───────────────────────────
-- Campus list and club browsing during signup/onboarding, the public config
-- row, and the unauthenticated account-deletion request form. Nothing else:
-- anon cannot read a profile, a post, an event or a message.
GRANT SELECT ON public.app_config        TO anon;
GRANT SELECT ON public.club_interests    TO anon;
GRANT SELECT ON public.clubs             TO anon;
GRANT SELECT ON public.universities      TO anon;
GRANT INSERT ON public.deletion_requests TO anon;

-- ── 3. authenticated: exactly what the student policies already authorise ───
-- Derived mechanically from pg_policy — policy FOR SELECT -> GRANT SELECT,
-- policy FOR ALL -> all four DML privileges, no policy -> no grant. Never wider
-- than the policy: RLS still decides WHICH ROWS, this decides only which tables
-- are reachable at all. TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are granted
-- to no client role anywhere; a client never does DDL or maintenance, and
-- TRUNCATE in particular ignores RLS.

-- Reference / read-only lookups.
GRANT SELECT ON public.app_config                  TO authenticated;
GRANT SELECT ON public.universities                TO authenticated;
GRANT SELECT ON public.notification_types          TO authenticated;  -- restates 046
GRANT SELECT ON public.channel_posters             TO authenticated;
GRANT SELECT ON public.club_recommendation_batches TO authenticated;

-- Blocking. Restates migration 057 verbatim: readable so the client can resolve
-- its own block list, never writable — every mutation is an RPC. Named here
-- only because section 1 revokes it first; 057 remains the owner of the rule.
GRANT SELECT ON public.user_blocks                 TO authenticated;

-- Profile and personal settings.
--
-- profiles deliberately gets SELECT and UPDATE only, NOT INSERT. A profile row
-- is never created by a client: every creation path is SECURITY DEFINER and so
-- runs as the function owner, not as `authenticated` —
--   handle_new_user()          AFTER INSERT trigger on auth.users
--   ensure_profile()           repair/backfill RPC
--   complete_oauth_onboarding() Microsoft/OAuth signup
--   replace_pending_signup()   re-signup over an unconfirmed account
-- A repo-wide audit of every `.insert()`, `.upsert()` and `.update()` against
-- `profiles` in web and mobile found ONLY updates (full_name, avatar, username,
-- agreed_to_terms, onboarding_complete, email_changed_at) and not one insert.
--
-- This also matters beyond least privilege: Production has no INSERT policy on
-- profiles at all — 001 creates `profiles: users insert own`, but that policy is
-- absent in Production, the single policy drift between the shipped chain and
-- the live database. Granting INSERT there would be a privilege with no policy
-- behind it, which is exactly what section 5c refuses. The grant is dropped
-- rather than the drift papered over with a new policy, because no code needs it.
GRANT SELECT, UPDATE                 ON public.profiles        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_privacy    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_interests  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_activities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.follows         TO authenticated;

-- Clubs.
GRANT SELECT, INSERT, UPDATE         ON public.clubs           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_members    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_officers   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_goals      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_interests  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_photos     TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.club_categories TO authenticated;

-- Events.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_rsvps      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_activities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_interests  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_events     TO authenticated;

-- Posts and interactions.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_likes     TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.post_comments  TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.post_club_tags TO authenticated;

-- Messaging. `messages` gets INSERT and SELECT only: edits and deletions run
-- through the delete-message Edge Function and the 067 lifecycle, never a
-- direct client UPDATE.
GRANT SELECT, INSERT                 ON public.messages                  TO authenticated;
GRANT SELECT, UPDATE                 ON public.conversations             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_participants TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.conversation_channels     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_mutes             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channel_reads             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_hides             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.polls                     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.poll_options              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.poll_votes                TO authenticated;

-- Notifications, push and safety. notification_preferences deliberately gets no
-- DELETE: migration 046 granted SELECT/INSERT/UPDATE only, and although its
-- policy is FOR ALL, 046's narrower intent is the one that is honoured here.
GRANT SELECT, UPDATE, DELETE         ON public.notifications            TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.notification_preferences TO authenticated;
GRANT SELECT, DELETE                 ON public.push_tokens              TO authenticated;
GRANT SELECT, INSERT                 ON public.reports                  TO authenticated;
GRANT INSERT                         ON public.deletion_requests        TO authenticated;

-- ── 4. service_role: only what the canonical server flows actually do ──────
-- service_role bypasses RLS, so every privilege it holds is a real capability.
-- The first version of this file granted it SELECT/INSERT/UPDATE/DELETE on ~48
-- tables while its own comment claimed the protected tables were excluded. They
-- were not: that list re-granted write access on report_decision_history and
-- report_notification_deliveries, which migration 064 had deliberately locked to
-- SELECT. That widening is undone below.
--
-- Evidence for the narrow set, gathered by reading the code rather than
-- guessing:
--   * The Admin Dashboard performs NO direct table writes. Every `admin.from()`
--     call is a read; all mutations go through SECURITY DEFINER RPCs owned by
--     postgres, which do not depend on service_role's table privileges.
--   * The only service_role writers are two Edge Functions:
--       send-push          -> push_queue UPDATE, push_tokens UPDATE,
--                             push_tickets INSERT + UPDATE
--       send-report-email  -> reports UPDATE
--
-- SELECT is deliberately left as it is. Reading is the Admin Dashboard's whole
-- purpose, revoking it broadly would break the console with no security gain,
-- and the tables that must not even be read are already locked by the
-- migrations that own them.

-- 4a. Remove write capability service_role does not use. A stolen service key
--     should not be able to mass-delete student content.
DO $$
DECLARE
  v_table text;
BEGIN
  FOR v_table IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER '
      'ON public.%I FROM service_role', v_table);
  END LOOP;
END;
$$;

-- 4b. SELECT for the surfaces that actually read. Enumerated from the code:
--     every `.from()` in apps/web/lib/admin and supabase/functions. Named
--     explicitly rather than granted in bulk, and it must be stated here rather
--     than assumed, because on a NEWLY created database service_role starts
--     with no privileges at all — Production only appears to have them because
--     of the same legacy defaults this migration is cleaning up.
--     Tables in `private`, and the ones 055/057/058/061/063/064 already grant
--     SELECT on, are deliberately untouched: those migrations own them.
GRANT SELECT ON
  public.app_config, public.universities, public.notification_types,
  public.profiles, public.user_activities, public.user_interests, public.follows,
  public.clubs, public.club_members, public.club_officers,
  public.events, public.event_rsvps,
  public.posts, public.post_comments, public.post_likes, public.post_club_tags,
  public.messages, public.conversations, public.conversation_participants,
  public.conversation_channels, public.channel_posters,
  public.polls, public.poll_options, public.poll_votes,
  public.notifications, public.push_queue, public.push_tickets,
  public.push_tokens, public.reports
TO service_role;

-- 4c. Give back exactly the four Edge Function write capabilities.
--     send-push        -> push_queue UPDATE, push_tokens UPDATE,
--                         push_tickets INSERT + UPDATE
--     send-report-email -> reports UPDATE
GRANT UPDATE          ON public.push_queue   TO service_role;
GRANT UPDATE          ON public.push_tokens  TO service_role;
GRANT INSERT, UPDATE  ON public.push_tickets TO service_role;
GRANT UPDATE          ON public.reports      TO service_role;

-- ── 5. Fail-closed validation — INSIDE the transaction, BEFORE COMMIT ──────
-- The first version ran this after COMMIT, which is how Production ended up
-- with applied grants and no ledger row. Any RAISE here aborts the whole
-- migration and leaves the database exactly as it was.
DO $$
DECLARE
  v_table text;
  v_priv  text;
  r       record;
BEGIN
  -- 5a. NEGATIVE — protected, administrative and service-only tables are
  --     unreachable by a client role, on EVERY privilege, not just SELECT.
  --     This is the check that failed in Production; it now follows a REVOKE
  --     that makes it true rather than merely hoping it already was.
  FOREACH v_table IN ARRAY ARRAY[
    'admin_audit_events', 'admin_audit_actions', 'account_restrictions',
    'account_deletion_cases', 'account_deletion_jobs',
    'transactional_email_outbox', 'content_lifecycle',
    'push_queue', 'push_tickets', 'auth_probe_rate_limits',
    'chat_invitations', 'notification_config', 'social_proof_events',
    'report_decision_history', 'report_notification_deliveries'
  ] LOOP
    IF to_regclass('public.' || quote_ident(v_table)) IS NULL THEN
      CONTINUE;
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE',
                                  'TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('authenticated', 'public.' || quote_ident(v_table), v_priv)
         OR has_table_privilege('anon', 'public.' || quote_ident(v_table), v_priv) THEN
        RAISE EXCEPTION '075: % must not hold % for a client role', v_table, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 5b. NEGATIVE — no client role holds TRUNCATE / REFERENCES / TRIGGER on ANY
  --     table. TRUNCATE ignores RLS entirely, so the legacy blanket made row
  --     policies irrelevant for whoever could reach it.
  FOR r IN
    SELECT c.relname, role.name AS role, p.priv
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS role(name)
      CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND has_table_privilege(role.name, c.oid, p.priv)
  LOOP
    RAISE EXCEPTION '075: % still holds % on public.%', r.role, r.priv, r.relname;
  END LOOP;

  -- 5c. NEGATIVE — no client privilege exists without a policy authorising it.
  --     A blanket grant fails here immediately, because it also hands out
  --     privileges on tables that have no client policy at all.
  FOR r IN
    WITH cmds(priv, code) AS (
      VALUES ('SELECT','r'), ('INSERT','a'), ('UPDATE','w'), ('DELETE','d')
    ),
    held AS (
      SELECT c.relname AS tbl, role.name AS role, cmds.priv, cmds.code
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS role(name)
        CROSS JOIN cmds
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND has_table_privilege(role.name, c.oid, cmds.priv)
    )
    SELECT held.* FROM held
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_policy p JOIN pg_class pc ON pc.oid = p.polrelid
        WHERE pc.relname = held.tbl
          AND (p.polcmd = held.code OR p.polcmd = '*')
          AND (p.polroles = '{0}'::oid[] OR held.role::regrole::oid = ANY (p.polroles))
     )
  LOOP
    RAISE EXCEPTION
      '075: % holds % on public.% with no policy authorising it', r.role, r.priv, r.tbl;
  END LOOP;

  -- 5d. NEGATIVE — anon stays out of student content entirely.
  FOREACH v_table IN ARRAY ARRAY['profiles','posts','post_comments','post_likes',
                                 'events','event_rsvps','messages','conversations',
                                 'conversation_participants','notifications','follows',
                                 'user_blocks','user_privacy','saved_events',
                                 'club_members','polls','poll_votes','push_tokens',
                                 'reports'] LOOP
    IF has_table_privilege('anon', 'public.' || quote_ident(v_table), 'SELECT')
       OR has_table_privilege('anon', 'public.' || quote_ident(v_table), 'INSERT') THEN
      RAISE EXCEPTION '075: anon can reach %', v_table;
    END IF;
  END LOOP;

  -- 5e. NEGATIVE — user_blocks stays RPC-only for mutation (057's rule).
  IF has_table_privilege('authenticated', 'public.user_blocks', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_blocks', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.user_blocks', 'DELETE') THEN
    RAISE EXCEPTION '075: user_blocks became client-writable';
  END IF;

  -- 5f. NEGATIVE — 064's lock on the report tables is intact for service_role.
  FOREACH v_table IN ARRAY ARRAY['report_decision_history',
                                 'report_notification_deliveries'] LOOP
    IF has_table_privilege('service_role', 'public.' || quote_ident(v_table), 'INSERT')
       OR has_table_privilege('service_role', 'public.' || quote_ident(v_table), 'UPDATE')
       OR has_table_privilege('service_role', 'public.' || quote_ident(v_table), 'DELETE') THEN
      RAISE EXCEPTION '075: service_role write access on % was not revoked (064 owns this)', v_table;
    END IF;
  END LOOP;

  -- 5g. POSITIVE — the product still works. Without these, every negative above
  --     would pass on a database where nothing is granted at all, which is
  --     exactly the broken state this migration exists to fix.
  FOREACH v_table IN ARRAY ARRAY['profiles','posts','clubs','events','messages',
                                 'notifications','conversations','user_blocks'] LOOP
    IF NOT has_table_privilege('authenticated', 'public.' || quote_ident(v_table), 'SELECT') THEN
      RAISE EXCEPTION '075: authenticated still cannot read %', v_table;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('anon', 'public.universities', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.clubs', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.deletion_requests', 'INSERT') THEN
    RAISE EXCEPTION '075: the pre-authentication surface is not reachable by anon';
  END IF;

  -- 5h. POSITIVE — the two Edge Functions keep exactly the writes they perform.
  IF NOT has_table_privilege('service_role', 'public.push_queue', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.push_tokens', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.push_tickets', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.push_tickets', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.reports', 'UPDATE') THEN
    RAISE EXCEPTION '075: an Edge Function lost a write it actually performs';
  END IF;
  -- ...and the Admin Dashboard keeps its reads.
  IF NOT has_table_privilege('service_role', 'public.profiles', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.reports', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.admin_audit_events', 'SELECT') THEN
    RAISE EXCEPTION '075: the Admin Dashboard lost a read it depends on';
  END IF;
END;
$$;

COMMIT;
