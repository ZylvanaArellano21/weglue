-- =============================================================================
-- 075 — Client table privileges: make a FRESH database work from migrations
--
-- THE DEFECT
--
-- Every migration in this repository was authored against a Supabase project
-- provisioned years ago, whose `ALTER DEFAULT PRIVILEGES IN SCHEMA public`
-- granted anon / authenticated / service_role full DML on each newly created
-- table. Migrations 055, 057, 058, 061 and 063 say so in their own comments and
-- REVOKE those defaults back off the tables that must stay locked — which only
-- makes sense if the defaults were there to begin with.
--
-- Current Supabase images ship narrower defaults: `anon=Dxtm/postgres`, i.e.
-- DELETE / TRUNCATE / REFERENCES / TRIGGER / MAINTAIN but NOT SELECT, INSERT or
-- UPDATE. So a database created from this migration chain today has RLS
-- policies on every table and no table privileges to go with them:
-- `authenticated` cannot read `posts`, `profiles`, `clubs` or anything else,
-- and PostgREST answers "permission denied" before a policy is ever consulted.
-- The whole product is dead on a clean install, and a disaster-recovery rebuild
-- would not come up.
--
-- This was invisible for two reasons: production still carries the old
-- defaults, and the compact test fixture issued a blanket
-- `GRANT ... ON ALL TABLES IN SCHEMA public`, which papered over it in every
-- harness run.
--
-- THE FIX, AND WHY IT IS NOT A BLANKET GRANT
--
-- A privilege is granted here ONLY where an RLS policy already authorises that
-- role for that command. The list below was derived mechanically from
-- pg_policy — role by role, table by table, command by command — not written
-- from memory:
--
--     policy FOR SELECT TO authenticated   ->   GRANT SELECT ... TO authenticated
--     policy FOR ALL    TO authenticated   ->   GRANT SELECT, INSERT, UPDATE, DELETE
--     no policy for that role/command      ->   NO GRANT
--
-- The grant is therefore never wider than the policy: RLS remains the only
-- thing deciding WHICH rows, and this decides only WHICH TABLES are reachable
-- at all. Tables with no client policy — the admin audit log, restrictions,
-- deletion cases and jobs, the email outbox, content lifecycle, the push
-- pipeline, rate limits — appear nowhere below and stay unreachable.
--
-- `user_blocks` is also absent on purpose: 057 grants it SELECT and only
-- SELECT, because block mutation is RPC-only. Re-granting it here could only
-- widen that, so it is left to the migration that owns it.
--
-- This migration is additive and idempotent. On production, where the old
-- defaults already apply, it changes nothing that is not already true.
-- =============================================================================

BEGIN;

-- ── anon: the pre-authentication surface only ──────────────────────────────
-- Campus list and club browsing during signup/onboarding, the public config
-- row, and the unauthenticated account-deletion request form. Nothing else:
-- anon cannot read a profile, a post, an event or a message.
GRANT SELECT ON public.app_config      TO anon;
GRANT SELECT ON public.club_interests  TO anon;
GRANT SELECT ON public.clubs           TO anon;
GRANT SELECT ON public.universities    TO anon;
GRANT INSERT ON public.deletion_requests TO anon;

-- ── authenticated: exactly what the student policies already authorise ─────

-- Reference / read-only lookups.
GRANT SELECT ON public.app_config                  TO authenticated;
GRANT SELECT ON public.universities                TO authenticated;
GRANT SELECT ON public.notification_types          TO authenticated;
GRANT SELECT ON public.channel_posters             TO authenticated;
GRANT SELECT ON public.club_recommendation_batches TO authenticated;

-- Profile and personal settings.
GRANT SELECT, INSERT, UPDATE         ON public.profiles        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_privacy    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_interests  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_activities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.follows         TO authenticated;

-- Clubs.
GRANT SELECT, INSERT, UPDATE         ON public.clubs          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_members   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_officers  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_goals     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_interests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.club_photos    TO authenticated;
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

-- Notifications, push and safety.
GRANT SELECT, UPDATE, DELETE         ON public.notifications           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT SELECT, DELETE                 ON public.push_tokens             TO authenticated;
GRANT SELECT, INSERT                 ON public.reports                 TO authenticated;
GRANT INSERT                         ON public.deletion_requests       TO authenticated;

-- ── service_role: the trusted server role ──────────────────────────────────
-- Used by the Admin Dashboard and the Edge Functions. It bypasses RLS, so a
-- table grant here is a real capability and the list is deliberately explicit.
-- The protected tables (admin audit, restrictions, deletion cases/jobs, email
-- outbox, content lifecycle) are NOT here: migrations 055, 057, 058, 061 and
-- 063 already fixed their posture to SELECT-only, and this must not widen it.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.profiles, public.user_privacy, public.user_interests,
  public.user_activities, public.follows,
  public.clubs, public.club_members, public.club_officers, public.club_goals,
  public.club_interests, public.club_photos, public.club_categories,
  public.club_recommendation_batches,
  public.events, public.event_rsvps, public.event_activities,
  public.event_interests, public.saved_events,
  public.posts, public.post_likes, public.post_comments, public.post_club_tags,
  public.messages, public.conversations, public.conversation_participants,
  public.conversation_channels, public.channel_mutes, public.channel_posters,
  public.channel_reads, public.message_hides,
  public.polls, public.poll_options, public.poll_votes,
  public.notifications, public.notification_preferences,
  public.notification_types, public.notification_config,
  public.push_tokens, public.push_queue, public.push_tickets,
  public.reports, public.report_decision_history,
  public.report_notification_deliveries,
  public.deletion_requests, public.chat_invitations,
  public.social_proof_events, public.auth_probe_rate_limits,
  public.universities, public.app_config
TO service_role;

COMMIT;

-- ── Fail-closed self-check ─────────────────────────────────────────────────
-- Runs inside the migration so a clean install refuses to come up wrong. If a
-- future edit ever turns this file into a blanket grant, the install aborts
-- here rather than shipping a readable audit log.
DO $$
DECLARE
  v_table text;
BEGIN
  -- 1. Protected and service-only tables stay unreachable by clients.
  FOREACH v_table IN ARRAY ARRAY[
    'admin_audit_events', 'admin_audit_actions', 'account_restrictions',
    'account_deletion_cases', 'account_deletion_jobs',
    'transactional_email_outbox', 'content_lifecycle',
    'push_queue', 'push_tickets', 'auth_probe_rate_limits',
    'chat_invitations', 'notification_config', 'social_proof_events',
    'report_decision_history', 'report_notification_deliveries'
  ] LOOP
    IF has_table_privilege('authenticated', 'public.' || quote_ident(v_table), 'SELECT')
       OR has_table_privilege('anon', 'public.' || quote_ident(v_table), 'SELECT') THEN
      RAISE EXCEPTION '075: % must not be readable by a client role', v_table;
    END IF;
  END LOOP;

  -- 2. anon stays out of student content entirely.
  FOREACH v_table IN ARRAY ARRAY['profiles', 'posts', 'events', 'messages', 'notifications'] LOOP
    IF has_table_privilege('anon', 'public.' || quote_ident(v_table), 'SELECT') THEN
      RAISE EXCEPTION '075: anon must not read %', v_table;
    END IF;
  END LOOP;

  -- 3. user_blocks keeps 057's shape: readable, never client-writable.
  IF NOT has_table_privilege('authenticated', 'public.user_blocks', 'SELECT')
     OR has_table_privilege('authenticated', 'public.user_blocks', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_blocks', 'DELETE') THEN
    RAISE EXCEPTION '075: user_blocks privilege shape changed';
  END IF;

  -- 4. Positive control: the ordinary content tables ARE now reachable, or
  --    every check above would pass for the wrong reason.
  FOREACH v_table IN ARRAY ARRAY['profiles', 'posts', 'clubs', 'events', 'messages'] LOOP
    IF NOT has_table_privilege('authenticated', 'public.' || quote_ident(v_table), 'SELECT') THEN
      RAISE EXCEPTION '075: authenticated still cannot read %', v_table;
    END IF;
  END LOOP;
END;
$$;
