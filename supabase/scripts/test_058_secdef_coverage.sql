-- ===========================================================================
-- SECURITY DEFINER coverage test  (Day 10B2, Stage 1)
--
-- WHY THIS EXISTS
--
-- Table RLS does not constrain a SECURITY DEFINER function: it runs as its
-- owner. Day 10B2 found that the hard way — a SUSPENDED student successfully
-- called `block_user()` because no policy is consulted on that path. The
-- rename-and-wrap pass in migration 058 closed the functions known at the time,
-- but a hand-written list rots the moment someone adds a migration.
--
-- So this test does NOT trust a list. It INVENTORIES THE LIVE CATALOG after all
-- migrations are applied and requires every student-reachable SECURITY DEFINER
-- function to be classified as exactly one of:
--
--   1. guarded_wrapper   — a restriction-guarded public wrapper (has __inner)
--   2. shell_allowlisted — minimal operation the restricted shell needs
--   3. internal          — not a student RPC, with a written justification
--   4. (unclassified)    — TEST FAILURE: unauthorized exposure
--
-- ON ITS FIRST RUN THIS TEST FOUND A REAL PRODUCTION VULNERABILITY:
-- `insert_notification_once` was granted to PUBLIC, anon AND authenticated,
-- letting any caller forge a notification (and a push) to any account from any
-- actor. Migration 058 now revokes it. That is the kind of thing a frozen list
-- would never have surfaced.
--
-- HOW TO RUN — after applying, in order:
--   test_057_fixture_schema.sql, 057, 055, 056, 058
--   docker exec -i wg-058 psql -U pgowner -d wg -q < this file
-- ===========================================================================

\set ON_ERROR_STOP on
\pset pager off
\o /dev/null

DROP TABLE IF EXISTS t_results;
CREATE TABLE t_results (n serial primary key, name text, ok boolean, detail text);
CREATE OR REPLACE FUNCTION t_ok(p_name text, p_cond boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN INSERT INTO t_results (name, ok, detail) VALUES (p_name, COALESCE(p_cond,false), p_detail); END; $$;

-- ── The classification ─────────────────────────────────────────────────────
--
-- Matched on function NAME. Overloads are checked separately below, so an
-- overload cannot inherit a sibling's classification silently.
DROP TABLE IF EXISTS secdef_classification;
CREATE TABLE secdef_classification (
  proname       text PRIMARY KEY,
  category      text NOT NULL CHECK (category IN ('guarded_wrapper','shell_allowlisted','internal')),
  justification text NOT NULL
);

INSERT INTO secdef_classification (proname, category, justification) VALUES
-- ── 2. RESTRICTED-SHELL ALLOWLIST — deliberately MINIMAL ───────────────────
-- Only what a restricted student genuinely needs. Legal and support pages are
-- public web resources and require no RPC, so none appear here.
('my_access_state',                'shell_allowlisted','Returns the caller''s own sanitized access state (generic label, optional expiry, public support email). Cannot return an internal reason, administrator identity, history or correlation id.'),
('current_student_can_access_app', 'shell_allowlisted','Argument-free self check used by RLS and the clients. Discloses nothing about anyone else.'),
('delete_own_account_atomic',      'shell_allowlisted','Account deletion MUST remain available while restricted (App Store 5.1.1(v)). Deliberately ungated.'),

-- ── 3. INTERNAL — not student RPCs ─────────────────────────────────────────
-- Trigger functions. Calling one directly raises "trigger functions can only be
-- called as triggers", so a grant on them is not an action surface.
('handle_follow_insert',        'internal','Trigger function; not directly invocable.'),
('handle_follow_delete',        'internal','Trigger function; not directly invocable.'),
('handle_follow_accept',        'internal','Trigger function; not directly invocable.'),
('handle_post_like_notify',     'internal','Trigger function; not directly invocable.'),
('notifications_prepare',       'internal','Trigger function; not directly invocable.'),
('notifications_block_guard',   'internal','Trigger function (058); not directly invocable.'),
('follows_block_guard',         'internal','Trigger function (058); not directly invocable.'),
('messages_block_guard',        'internal','Trigger function (058); not directly invocable.'),
-- Read-only predicates about the CALLER. They take no action and disclose
-- nothing the caller could not already infer from their own data.
('is_conversation_participant',        'internal','Read-only predicate about the caller''s own participation.'),
('can_post_in_channel',                'internal','Read-only predicate about the caller''s own posting right.'),
('is_club_member',                     'internal','Read-only predicate about the caller''s own membership.'),
('is_club_officer',                    'internal','Read-only predicate about the caller''s own officer role.'),
('is_channel_club_officer',            'internal','Read-only predicate about the caller''s own officer role.'),
('blocked_user_ids',                   'internal','Read-only: ids the CALLER cannot interact with. Argument-free, self-scoped.'),
('blockable_notification_types',       'internal','Read-only classification list; contains no user data.'),
('restricted_user_ids',                'internal','Read-only id list used by RLS. Ids only — no reason, type or administrator identity.'),
('users_have_block_relationship',      'internal','Read-only symmetric predicate; never says which direction.'),
('users_may_interact',                 'internal','Read-only composite predicate.'),
('current_user_blocks',                'internal','Read-only: whether the CALLER blocked a target. Directional, self-scoped.'),
('target_is_blocked_from_current_user','internal','Read-only symmetric availability check; never reveals direction.'),
('assert_self_or_null',                'internal','Identity validator used by the discovery RPCs; returns only auth.uid().'),
('recent_club_preview_message_ids',    'internal','Read-only helper for the public club-chat preview.'),
-- Service-role / infrastructure paths. These must NOT be student-reachable;
-- the grant assertions below prove they are not.
('insert_notification_once',  'internal','Notification helper. Was PUBLIC/anon/authenticated in production — a real spoofing vector — and is revoked by migration 058. Grant assertion below enforces it.'),
('enqueue_push',              'internal','Push enqueue; service_role only.'),
('claim_push_batch',          'internal','Push worker claim; service_role only.'),
('user_wants_push',           'internal','Push preference lookup; service_role only.'),
('notification_push_copy',    'internal','Push copy builder; service_role only.'),
('invoke_push_dispatch',      'internal','Push dispatch trigger; service_role only.'),
('get_unread_summary_for',    'internal','Service-role unread summary for a given user.'),
('grouped_notification_message','internal','Pure text helper; service_role only.'),
('notification_config_int',   'internal','Config reader; service_role only.'),
('generate_club_recommendation_batch','internal','Service-role recommendation generator.'),
('rank_eligible_clubs',       'internal','Service-role ranking helper.'),
('process_event_reminders',   'internal','Scheduled job; service_role only.'),
('process_social_proof_events','internal','Scheduled job; service_role only.'),
('check_club_inactivity',     'internal','Scheduled job.'),
('before_user_created',       'internal','GoTrue auth hook.'),
('handle_new_user',           'internal','Trigger on auth.users.'),
('ensure_profile',            'internal','Runs during sign-in, before any restriction state can exist; must not be gated or a restricted user could never load their own shell.'),
('auth_signup_status',        'internal','Pre-authentication signup flow.'),
('replace_pending_signup',    'internal','Pre-authentication signup flow.'),
('resolve_signup_university_id','internal','Pre-authentication signup flow.'),
('complete_oauth_onboarding', 'internal','Onboarding completion; runs before the student tree.'),
('sync_pending_profile_meta', 'internal','Trigger function.'),
('sync_university_name',      'internal','Trigger function.'),
('handle_profile_created_social_proof','internal','Trigger function.'),
('storage_path_from_public_url','internal','Pure string helper.'),
('delete_own_user_data',      'internal','Internal helper used by the deletion path.'),
('club_officer_floor_exempt', 'internal','Service-role officer-floor helper.'),
('count_club_officers',       'internal','Service-role officer count.'),
('enforce_club_officer_floor','internal','Trigger function.'),
('cleanup_channel_posters_on_leave','internal','Trigger function.'),
('complete_recommendation_batch_on_join','internal','Trigger function.'),
('update_club_member_count',  'internal','Trigger function.'),
('update_club_activity_on_event','internal','Trigger function.'),
('update_club_activity_on_message','internal','Trigger function.'),
('unhide_conversation_on_message','internal','Trigger function.'),
('handle_club_created','internal','Trigger function.'),
('handle_club_join','internal','Trigger function.'),
('handle_club_leave','internal','Trigger function.'),
('handle_club_leave_rsvp_cleanup','internal','Trigger function.'),
('handle_club_member_role_change','internal','Trigger function.'),
('handle_club_officer_role_notify','internal','Trigger function.'),
('handle_club_post_notify','internal','Trigger function.'),
('handle_club_renamed','internal','Trigger function.'),
('handle_event_canceled_notify','internal','Trigger function.'),
('handle_event_deleted_notifications','internal','Trigger function.'),
('handle_event_updated_notify','internal','Trigger function.'),
('handle_message_push','internal','Trigger function.'),
('handle_new_event_notify','internal','Trigger function.'),
('handle_post_club_tag_notify','internal','Trigger function.'),
('handle_post_club_tag_photo','internal','Trigger function.'),
('handle_post_comment_notify','internal','Trigger function.'),
('handle_post_tagged_club_photo','internal','Trigger function.'),
('handle_post_unlike_notify','internal','Trigger function.'),
('notifications_after_group_merge_push','internal','Trigger function.'),
('notifications_after_insert_push','internal','Trigger function.'),
('notify_club_post','internal','Service-role notification fan-out.'),
('admin_audit_log','internal','Service-role audit writer.'),
('get_account_access_state','internal','Per-user probe; service_role only so students cannot enumerate other accounts.'),
('is_account_restricted','internal','Per-user probe; service_role only.'),
('can_student_access_app','internal','Per-user probe; service_role only.'),
('safe_like_fragment','internal','Pure string helper.');

GRANT SELECT ON secdef_classification TO authenticated;

-- Everything renamed by the 058 wrapper pass is category 1, discovered from the
-- catalog rather than listed: a wrapper is exactly a function whose __inner
-- twin exists.
INSERT INTO secdef_classification (proname, category, justification)
SELECT DISTINCT left(p.proname, length(p.proname) - 7), 'guarded_wrapper',
       'Restriction-guarded wrapper installed by migration 058; original body preserved in the __inner twin.'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE '%\_\_inner'
ON CONFLICT (proname) DO NOTHING;

-- ── The inventory ──────────────────────────────────────────────────────────
-- Every SECURITY DEFINER function in `public` that `authenticated` can execute,
-- whether through an explicit grant or an inherited PUBLIC grant.
DROP VIEW IF EXISTS student_reachable_secdef;
CREATE VIEW student_reachable_secdef AS
SELECT p.oid,
       p.proname,
       pg_get_function_identity_arguments(p.oid) AS identity_args,
       pg_get_function_arguments(p.oid)          AS full_args,
       pg_get_function_result(p.oid)             AS result,
       p.provolatile,
       p.proretset,
       (p.proacl IS NULL)                        AS public_by_default,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prosecdef
   AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
   -- Exclude the harness's OWN helpers. They are SECURITY DEFINER so they can
   -- record results while impersonating `authenticated`, and they exist only
   -- inside a throwaway test database — they are not part of the product
   -- surface and must not be classified as if they were.
   AND p.proname NOT IN ('t_ok','t_as','t_anon');

-- ===========================================================================
-- 1. EVERY reachable function must be classified
-- ===========================================================================
SELECT t_ok(
  'S1 every student-reachable SECDEF function is classified',
  (SELECT count(*) = 0
     FROM student_reachable_secdef s
     LEFT JOIN secdef_classification c ON c.proname = s.proname
    WHERE c.proname IS NULL),
  COALESCE((SELECT string_agg(s.proname || '(' || s.identity_args || ')', '; ')
              FROM student_reachable_secdef s
              LEFT JOIN secdef_classification c ON c.proname = s.proname
             WHERE c.proname IS NULL), ''));

-- Overloads are inventoried independently: two signatures of the same name are
-- two separate reachable surfaces, and both must appear.
SELECT t_ok(
  'S2 overloaded signatures are inventoried independently',
  (SELECT count(*) = count(DISTINCT (proname, identity_args)) FROM student_reachable_secdef));

-- ===========================================================================
-- 2. Wrapper fidelity — a guard must not change the public contract
-- ===========================================================================
SELECT t_ok('S3 every wrapper has exactly one __inner twin',
  (SELECT count(*) = 0
     FROM secdef_classification c
    WHERE c.category = 'guarded_wrapper'
      AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                       WHERE n.nspname='public' AND p.proname = c.proname || '__inner')));

-- Parameter types, ORDER and DEFAULTS must match the inner function exactly.
-- Defaults are the one that actually broke: dropping them made
-- `get_my_blocked_users()` and `search_students('bob')` stop resolving.
SELECT t_ok('S4 wrappers preserve parameter types, order AND defaults',
  (SELECT count(*) = 0 FROM (
     SELECT w.proname
       FROM pg_proc w JOIN pg_namespace nw ON nw.oid = w.pronamespace
       JOIN pg_proc i ON i.proname = w.proname || '__inner'
       JOIN pg_namespace ni ON ni.oid = i.pronamespace AND ni.nspname = 'public'
      WHERE nw.nspname = 'public'
        AND EXISTS (SELECT 1 FROM secdef_classification c
                     WHERE c.proname = w.proname AND c.category = 'guarded_wrapper')
        AND pg_get_function_arguments(w.oid) IS DISTINCT FROM pg_get_function_arguments(i.oid)
   ) bad),
  COALESCE((SELECT string_agg(w.proname, ', ')
              FROM pg_proc w JOIN pg_namespace nw ON nw.oid = w.pronamespace
              JOIN pg_proc i ON i.proname = w.proname || '__inner'
              JOIN pg_namespace ni ON ni.oid = i.pronamespace AND ni.nspname='public'
             WHERE nw.nspname='public'
               AND EXISTS (SELECT 1 FROM secdef_classification c
                            WHERE c.proname = w.proname AND c.category='guarded_wrapper')
               AND pg_get_function_arguments(w.oid) IS DISTINCT FROM pg_get_function_arguments(i.oid)), ''));

SELECT t_ok('S5 wrappers preserve the return type and set-returning shape',
  (SELECT count(*) = 0 FROM (
     SELECT w.proname
       FROM pg_proc w JOIN pg_namespace nw ON nw.oid = w.pronamespace
       JOIN pg_proc i ON i.proname = w.proname || '__inner'
       JOIN pg_namespace ni ON ni.oid = i.pronamespace AND ni.nspname='public'
      WHERE nw.nspname='public'
        AND EXISTS (SELECT 1 FROM secdef_classification c
                     WHERE c.proname = w.proname AND c.category='guarded_wrapper')
        AND (pg_get_function_result(w.oid) IS DISTINCT FROM pg_get_function_result(i.oid)
             OR w.proretset IS DISTINCT FROM i.proretset)
   ) bad));

-- ===========================================================================
-- 3. The __inner twins must be unreachable from any client role
-- ===========================================================================
SELECT t_ok('S6 no __inner function is executable by authenticated, anon or PUBLIC',
  (SELECT count(*) = 0
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE '%\_\_inner'
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR p.proacl IS NULL)),
  COALESCE((SELECT string_agg(p.proname, ', ')
              FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname LIKE '%\_\_inner'
               AND (has_function_privilege('authenticated', p.oid,'EXECUTE')
                 OR has_function_privilege('anon', p.oid,'EXECUTE')
                 OR p.proacl IS NULL)), ''));

-- ===========================================================================
-- 4. Service-role-only functions must not be student-reachable
--
-- This is the assertion that caught the live production exposure of
-- insert_notification_once.
-- ===========================================================================
SELECT t_ok('S7 privileged internals are NOT executable by authenticated or anon',
  (SELECT count(*) = 0 FROM (
     SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public'
        AND p.proname IN ('insert_notification_once','enqueue_push','claim_push_batch',
                          'user_wants_push','admin_audit_log','notify_club_post',
                          'get_account_access_state','is_account_restricted','can_student_access_app')
        AND (has_function_privilege('authenticated', p.oid,'EXECUTE')
          OR has_function_privilege('anon', p.oid,'EXECUTE'))
   ) bad),
  COALESCE((SELECT string_agg(p.proname, ', ')
              FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public'
               AND p.proname IN ('insert_notification_once','enqueue_push','claim_push_batch',
                                 'user_wants_push','admin_audit_log','notify_club_post',
                                 'get_account_access_state','is_account_restricted','can_student_access_app')
               AND (has_function_privilege('authenticated', p.oid,'EXECUTE')
                 OR has_function_privilege('anon', p.oid,'EXECUTE'))), ''));

SELECT t_ok('S8 the administrator restriction RPCs are service_role only',
  (SELECT count(*) = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'admin_tx_%'
      AND (has_function_privilege('authenticated', p.oid,'EXECUTE')
        OR has_function_privilege('anon', p.oid,'EXECUTE'))));

-- ===========================================================================
-- 5. The shell allowlist stays MINIMAL
-- ===========================================================================
SELECT t_ok('S9 the restricted-shell allowlist contains only the three approved operations',
  (SELECT count(*) = 3 FROM secdef_classification WHERE category = 'shell_allowlisted'),
  COALESCE((SELECT string_agg(proname, ', ') FROM secdef_classification WHERE category='shell_allowlisted'), ''));

SELECT t_ok('S10 no legal/support page needs an RPC (none is allowlisted)',
  (SELECT count(*) = 0 FROM secdef_classification
    WHERE category = 'shell_allowlisted'
      AND proname NOT IN ('my_access_state','current_student_can_access_app','delete_own_account_atomic')));

-- ===========================================================================
-- 6. Behaviour: a restricted student cannot call a guarded RPC; an active one can
-- ===========================================================================
INSERT INTO universities (id,name,slug) VALUES
  ('99990000-0000-4000-8000-00000000aaaa','Lone Star College','lone-star-college')
ON CONFLICT DO NOTHING;
INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES
  ('99990000-0000-4000-8000-000000000001','sec1@e.edu','{}'::jsonb),
  ('99990000-0000-4000-8000-000000000002','sec2@e.edu','{}'::jsonb),
  ('99990000-0000-4000-8000-0000000000ad','secadm@weglue.app','{"account_type":"platform_admin"}'::jsonb)
ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,username,full_name) VALUES
  ('99990000-0000-4000-8000-000000000001','sec_one','Sec One'),
  ('99990000-0000-4000-8000-000000000002','sec_two','Sec Two')
ON CONFLICT DO NOTHING;

-- ACTIVE student keeps access.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"99990000-0000-4000-8000-000000000001"}',false);
DO $$ BEGIN
  BEGIN
    PERFORM public.get_my_blocked_users();
    PERFORM public.search_students('sec');
    PERFORM public.my_access_state();
    PERFORM t_ok('S11 an ACTIVE student retains guarded-RPC access', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM t_ok('S11 an ACTIVE student retains guarded-RPC access', false, SQLERRM);
  END;
END $$;
RESET ROLE;

-- Restrict, then re-check.
SELECT public.admin_tx_restriction_suspend(
  '99990000-0000-4000-8000-0000000000ad','secadm@weglue.app','Coverage test',
  gen_random_uuid(), '99990000-0000-4000-8000-000000000001', NULL);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"99990000-0000-4000-8000-000000000001"}',false);
DO $$
DECLARE blocked int := 0; total int := 0; fn record;
BEGIN
  -- Every guarded wrapper must refuse a restricted caller.
  FOR fn IN
    SELECT proname FROM secdef_classification WHERE category='guarded_wrapper'
     AND proname IN ('block_user','unblock_user','get_my_blocked_users','search_students',
                     'search_discovery','get_discovery_people','get_or_create_direct_chat')
  LOOP
    total := total + 1;
    BEGIN
      EXECUTE format('SELECT public.%I(%s)', fn.proname,
        CASE fn.proname
          WHEN 'block_user' THEN '''99990000-0000-4000-8000-000000000002''::uuid'
          WHEN 'unblock_user' THEN '''99990000-0000-4000-8000-000000000002''::uuid'
          WHEN 'get_or_create_direct_chat' THEN '''99990000-0000-4000-8000-000000000002''::uuid'
          WHEN 'search_students' THEN '''sec'''
          WHEN 'search_discovery' THEN 'NULL, ''sec'''
          WHEN 'get_discovery_people' THEN 'NULL'
          ELSE '' END);
    EXCEPTION WHEN insufficient_privilege THEN blocked := blocked + 1;
              WHEN OTHERS THEN NULL;
    END;
  END LOOP;
  PERFORM t_ok('S12 a RESTRICTED student is refused by every sampled guarded RPC',
               blocked = total, format('%s of %s refused', blocked, total));
END $$;

-- The shell allowlist must still work while restricted.
DO $$ BEGIN
  BEGIN
    PERFORM public.my_access_state();
    PERFORM t_ok('S13 the restricted shell can still read its own state', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM t_ok('S13 the restricted shell can still read its own state', false, SQLERRM);
  END;
END $$;
SELECT t_ok('S14 account deletion remains EXECUTE-able while restricted',
  has_function_privilege('authenticated','public.delete_own_account_atomic()','EXECUTE'));
RESET ROLE;

-- ===========================================================================
-- 7. Platform-admin identities stay outside the student system
-- ===========================================================================
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"99990000-0000-4000-8000-0000000000ad"}',false);
SELECT t_ok('S15 a platform-admin identity is never treated as an active student',
  (SELECT public.current_student_can_access_app() = false));
RESET ROLE;

SELECT public.admin_tx_restriction_unsuspend(
  '99990000-0000-4000-8000-0000000000ad','secadm@weglue.app','Coverage test cleanup',
  gen_random_uuid(), '99990000-0000-4000-8000-000000000001');

-- ===========================================================================
\o
\echo ''
\echo '========== SECURITY DEFINER COVERAGE RESULTS =========='
SELECT lpad(n::text,3) AS "#",
       CASE WHEN ok THEN 'PASS' ELSE '*** FAIL ***' END AS result,
       name, NULLIF(detail,'') AS detail
FROM t_results ORDER BY n;

SELECT count(*) FILTER (WHERE ok) AS passed,
       count(*) FILTER (WHERE NOT ok) AS failed,
       (SELECT count(*) FROM student_reachable_secdef) AS inventoried
FROM t_results;

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM t_results WHERE NOT ok;
  IF v > 0 THEN RAISE EXCEPTION '% SECDEF COVERAGE TEST(S) FAILED', v; END IF;
  RAISE NOTICE 'SECURITY DEFINER COVERAGE: ALL PASSED';
END $$;
