-- ===========================================================================
-- Test harness — migration 055 (durable, append-only admin audit)
-- ===========================================================================
--
-- HOW TO RUN (throwaway database, NEVER production):
--
--   docker run -d --name wg-audit-test -e POSTGRES_PASSWORD=test \
--     -e POSTGRES_DB=weglue_test -p 55433:5432 postgres:15
--
--   # Reproduce production's role topology. This matters: in production
--   # `postgres` is NOT a superuser but DOES hold BYPASSRLS, and `service_role`
--   # holds BYPASSRLS too. A test run as a superuser owner would pass for the
--   # wrong reason, because superusers bypass FORCE ROW LEVEL SECURITY.
--   docker exec -i wg-audit-test psql -U postgres -d postgres <<'EOF'
--     CREATE ROLE pgowner LOGIN PASSWORD 'test' NOSUPERUSER BYPASSRLS CREATEROLE;
--     CREATE DATABASE wg_faithful OWNER pgowner;
--     CREATE ROLE anon NOLOGIN;
--     CREATE ROLE authenticated NOLOGIN;
--     CREATE ROLE service_role NOLOGIN BYPASSRLS;
--   EOF
--   docker exec -i wg-audit-test psql -U pgowner -d wg_faithful \
--     -c "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;"
--
--   # Apply the migration TWICE — the second run proves idempotency.
--   docker exec -i wg-audit-test psql -U pgowner -d wg_faithful -v ON_ERROR_STOP=1 \
--     < supabase/migrations/055_durable_admin_audit.sql
--   docker exec -i wg-audit-test psql -U pgowner -d wg_faithful -v ON_ERROR_STOP=1 \
--     < supabase/migrations/055_durable_admin_audit.sql
--
--   # Then this file:
--   docker exec -i wg-audit-test psql -U pgowner -d wg_faithful -q \
--     < supabase/scripts/test_055_durable_admin_audit.sql
--
-- Every assertion raises on failure; the run aborts at the first FAIL.
-- The final line prints the pass count — a run that ends without it FAILED.
-- ===========================================================================

\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE OR REPLACE FUNCTION t_assert(cond boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN
    RAISE NOTICE 'PASS  %', label;
    UPDATE t_counter SET passed = passed + 1;
  ELSE
    RAISE EXCEPTION 'FAIL  %', label;
  END IF;
END $$;

-- Runs `sql` and asserts it RAISES. Optionally asserts the message contains
-- `expect`. A statement that unexpectedly succeeds is a test failure.
CREATE OR REPLACE FUNCTION t_denied(sql text, label text, expect text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE msg text;
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN others THEN
    msg := SQLERRM;
    IF expect IS NOT NULL AND position(lower(expect) IN lower(msg)) = 0 THEN
      RAISE EXCEPTION 'FAIL  % — wrong error: %', label, msg;
    END IF;
    RAISE NOTICE 'PASS  %  [%]', label, left(replace(msg, E'\n', ' '), 72);
    UPDATE t_counter SET passed = passed + 1;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL  % — statement SUCCEEDED but should have been denied', label;
END $$;

CREATE TABLE IF NOT EXISTS t_counter (passed int NOT NULL);
DELETE FROM t_counter; INSERT INTO t_counter VALUES (0);
GRANT SELECT, UPDATE ON t_counter TO anon, authenticated, service_role;

-- Fixed ids so every assertion reasons about the same rows.
\set FOUNDER  '''94387196-0000-4000-8000-000000000001'''
\set TARGET   '''11111111-0000-4000-8000-000000000002'''
\set CORREL   '''22222222-0000-4000-8000-000000000003'''


-- ===========================================================================
-- GROUP 1 — Structure: history must survive account deletion
-- ===========================================================================

-- The single most important structural property: NO foreign key from the audit
-- trail to any account/content table. If someone "helpfully" adds one later,
-- deleting a user would silently erase the evidence about that user.
SELECT t_assert(
  NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'admin_audit_events'
       AND c.contype = 'f'
       AND c.confrelid <> 'admin_audit_actions'::regclass
  ),
  '1.1  admin_audit_events has NO FK to accounts/content (history survives deletion)'
);

SELECT t_assert(
  (SELECT count(*) FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'admin_audit_events' AND c.contype = 'f') = 1,
  '1.2  the only FK is action -> admin_audit_actions (controlled vocabulary)'
);

SELECT t_assert(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = 'admin_audit_events'),
  '1.3  RLS is ENABLED and FORCED on admin_audit_events'
);

SELECT t_assert(
  (SELECT count(*) FROM pg_policies WHERE tablename IN ('admin_audit_events','admin_audit_actions')) = 0,
  '1.4  zero RLS policies exist -> deny-all for every non-bypassing role'
);

-- Day 10B–10F add controlled-vocabulary actions additively. This harness owns
-- the Day 10A baseline, so assert it remains present without rejecting later
-- audited features; exact current parity is covered by the web registry test.
SELECT t_assert((SELECT count(*) FROM admin_audit_actions) >= 26, '1.5  action catalog retains the Day 10A baseline');
SELECT t_assert((SELECT count(*) FROM admin_audit_events) = 0,   '1.6  audit table starts EMPTY (no fabricated backfill)');


-- ===========================================================================
-- GROUP 2 — anon has no access whatsoever
-- ===========================================================================
SET ROLE anon;
SELECT t_denied('SELECT * FROM admin_audit_events',                      '2.1  anon cannot SELECT audit events',   'permission denied');
SELECT t_denied($$INSERT INTO admin_audit_events (actor_user_id, action, target_type, success, correlation_id)
                  VALUES (gen_random_uuid(),'portal.lock','portal',true,gen_random_uuid())$$,
                                                                          '2.2  anon cannot INSERT audit events',   'permission denied');
SELECT t_denied('UPDATE admin_audit_events SET reason = $$x$$',           '2.3  anon cannot UPDATE audit events',   'permission denied');
SELECT t_denied('DELETE FROM admin_audit_events',                         '2.4  anon cannot DELETE audit events',   'permission denied');
SELECT t_denied('SELECT * FROM admin_audit_actions',                      '2.5  anon cannot read the action catalog', 'permission denied');
SELECT t_denied($$SELECT public.admin_audit_log('11111111-0000-4000-8000-000000000002'::uuid,
                    'x@y.z','portal.lock','portal')$$,
                                                                          '2.6  anon cannot EXECUTE admin_audit_log', 'permission denied');
RESET ROLE;


-- ===========================================================================
-- GROUP 3 — authenticated (ordinary student AND the founder's browser session)
-- ===========================================================================
-- The founder's signed-in browser session runs as `authenticated`, exactly like
-- any student. It must have no more access to the audit trail than they do:
-- reading is done server-side through requireSecureAdmin(), never from a client.
SET ROLE authenticated;
SELECT t_denied('SELECT * FROM admin_audit_events',                      '3.1  authenticated (student) cannot SELECT',       'permission denied');
SELECT t_denied($$INSERT INTO admin_audit_events (actor_user_id, action, target_type, success, correlation_id)
                  VALUES (gen_random_uuid(),'portal.lock','portal',true,gen_random_uuid())$$,
                                                                          '3.2  FOUNDER BROWSER SESSION cannot INSERT directly', 'permission denied');
SELECT t_denied('UPDATE admin_audit_events SET success = false',          '3.3  authenticated cannot UPDATE',                 'permission denied');
SELECT t_denied('DELETE FROM admin_audit_events',                         '3.4  authenticated cannot DELETE',                 'permission denied');
SELECT t_denied('TRUNCATE admin_audit_events',                            '3.5  authenticated cannot TRUNCATE',               'permission denied');
SELECT t_denied($$SELECT public.admin_audit_log('11111111-0000-4000-8000-000000000002'::uuid,
                    'founder@weglue.app','portal.lock','portal')$$,
                                                                          '3.6  FOUNDER BROWSER SESSION cannot EXECUTE the RPC', 'permission denied');
RESET ROLE;


-- ===========================================================================
-- GROUP 4 — service_role: may read, may NOT insert directly, may call the RPC
-- ===========================================================================
-- service_role holds BYPASSRLS, so policies do not constrain it — GRANTS do.
-- A leaked service key therefore cannot forge an arbitrary audit row; it can
-- only go through the validated entry point.
SET ROLE service_role;

SELECT t_denied($$INSERT INTO admin_audit_events (actor_user_id, action, target_type, success, correlation_id)
                  VALUES (gen_random_uuid(),'portal.lock','portal',true,gen_random_uuid())$$,
                '4.1  service_role CANNOT insert directly into the table', 'permission denied');

SELECT t_assert((SELECT count(*) FROM admin_audit_events) = 0, '4.2  service_role CAN SELECT (dashboard read path)');

-- The sanctioned path.
SELECT t_assert(
  public.admin_audit_log(
    p_actor_user_id  => :FOUNDER::uuid,
    p_actor_email    => 'founder@weglue.app',
    p_action         => 'membership.add',
    p_target_type    => 'club_member',
    p_target_id      => :TARGET::uuid,
    p_metadata       => '{"club_id":"33333333-0000-4000-8000-000000000004"}'::jsonb,
    p_success        => true,
    p_correlation_id => :CORREL::uuid
  ) IS NOT NULL,
  '4.3  service_role CAN insert through admin_audit_log() (the server path)'
);

SELECT t_assert((SELECT count(*) FROM admin_audit_events) = 1, '4.4  the row is durably persisted');

SELECT t_assert(
  (SELECT actor_user_id = :FOUNDER::uuid AND actor_email = 'founder@weglue.app'
          AND action = 'membership.add' AND target_type = 'club_member'
          AND target_id = :TARGET::uuid AND success
     FROM admin_audit_events LIMIT 1),
  '4.5  actor identity + target are recorded exactly as the server supplied them'
);

-- occurred_at is server-side: admin_audit_log has no timestamp parameter at all,
-- so an administrator cannot backdate their own trail.
SELECT t_assert(
  (SELECT occurred_at BETWEEN now() - interval '1 minute' AND now() + interval '1 second'
     FROM admin_audit_events LIMIT 1),
  '4.6  occurred_at is set by the server clock (no caller-supplied timestamp)'
);
RESET ROLE;

SELECT t_assert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.parameters
     WHERE specific_schema = 'public'
       AND specific_name LIKE 'admin_audit_log%'
       AND (parameter_name ILIKE '%occurred%' OR parameter_name ILIKE '%timestamp%')
  ),
  '4.7  admin_audit_log exposes NO timestamp parameter (structurally un-backdatable)'
);


-- ===========================================================================
-- GROUP 5 — Append-only, enforced for EVERY role including the owner
-- ===========================================================================
-- Triggers (not policies) are the guarantee here, because service_role and the
-- owner both bypass RLS. These run as `pgowner`, the most privileged role that
-- ever touches this table in production.
SELECT t_denied('UPDATE admin_audit_events SET reason = $$tampered$$',
                '5.1  OWNER cannot UPDATE an audit row (trigger)',  'append-only');
SELECT t_denied('UPDATE admin_audit_events SET success = false',
                '5.2  OWNER cannot flip success (trigger)',          'append-only');
SELECT t_denied('DELETE FROM admin_audit_events',
                '5.3  OWNER cannot DELETE an audit row (trigger)',   'append-only');
SELECT t_denied('TRUNCATE admin_audit_events',
                '5.4  OWNER cannot TRUNCATE the trail (statement trigger)', 'append-only');
SELECT t_denied('DELETE FROM admin_audit_actions WHERE action = $$portal.lock$$',
                '5.5  catalog rows are permanent (history cannot be orphaned)', 'permanent');

SET ROLE service_role;
SELECT t_denied('UPDATE admin_audit_events SET reason = $$tampered$$',
                '5.6  service_role cannot UPDATE (grant + trigger)', 'permission denied');
SELECT t_denied('DELETE FROM admin_audit_events',
                '5.7  service_role cannot DELETE (grant + trigger)', 'permission denied');
RESET ROLE;

SELECT t_assert((SELECT count(*) FROM admin_audit_events) = 1,
                '5.8  after every tamper attempt the trail is intact');


-- ===========================================================================
-- GROUP 6 — Controlled vocabulary
-- ===========================================================================
SET ROLE service_role;
SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','totally.madeUp','club')$$,
                '6.1  an unknown action is rejected',              'unknown action');

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','membership.add','report')$$,
                '6.2  action/target_type mismatch is rejected',    'declared for target_type');

SELECT t_denied($$SELECT public.admin_audit_log(
    NULL,'f@w.app','membership.add','club_member')$$,
                '6.3  a NULL actor is rejected (identity is mandatory)', 'actor_user_id is required');
RESET ROLE;

-- An invalid target_type cannot even be spelled, thanks to the CHECK.
SELECT t_denied($$INSERT INTO admin_audit_actions (action, target_type, sensitivity)
                  VALUES ('bad.name','not_a_real_type','ordinary')$$,
                '6.4  target_type CHECK rejects unknown categories', 'violates check constraint');
SELECT t_denied($$INSERT INTO admin_audit_actions (action, target_type, sensitivity)
                  VALUES ('BadName','club','ordinary')$$,
                '6.5  action naming convention is enforced',        'violates check constraint');


-- ===========================================================================
-- GROUP 7 — Secrets and private content are rejected at the database
-- ===========================================================================
-- These are the SECOND barrier. The application allowlist (auditSanitize.ts) is
-- the first. Each of these proves a compromised or buggy server build still
-- cannot persist a credential.
SET ROLE service_role;

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','university.edit','university',
    NULL, NULL, NULL, '{"password":"hunter2"}'::jsonb)$$,
                '7.1  a "password" key is rejected',               'forbidden key');

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','university.edit','university',
    NULL, NULL, NULL, '{"access_token":"abc"}'::jsonb)$$,
                '7.2  an "access_token" key is rejected',          'forbidden key');

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','university.edit','university',
    NULL, NULL, NULL, NULL, '{"service_role_key":"x"}'::jsonb)$$,
                '7.3  a service-role key field is rejected',       'forbidden key');

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','university.edit','university',
    NULL, NULL, NULL, NULL, '{"totp_code":"123456"}'::jsonb)$$,
                '7.4  a TOTP/MFA code field is rejected',          'forbidden key');

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','university.edit','university',
    NULL, NULL, NULL, NULL, '{"entry_phrase":"secret-path"}'::jsonb)$$,
                '7.5  the private admin entry phrase is rejected', 'forbidden key');

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','university.edit','university',
    NULL, NULL, NULL, NULL, '{"cookie":"sb-access=1"}'::jsonb)$$,
                '7.6  a cookie field is rejected',                 'forbidden key');

-- Value-level, not just key-level: a JWT smuggled under an innocent key name.
SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','university.edit','university',
    NULL, NULL, NULL, NULL,
    '{"note":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload"}'::jsonb)$$,
                '7.7  a JWT-shaped VALUE is rejected under any key name', 'credential-bearing');

-- A pre-signed Storage URL leaks retrievable media credentials.
SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','post.editCaption','post',
    NULL, NULL, NULL, NULL,
    '{"image":"https://x.supabase.co/o/p.jpg?token=abc&X-Amz-Signature=deadbeef"}'::jsonb)$$,
                '7.8  a signed/credentialed media URL is rejected', 'credential-bearing');

-- Nested, to prove the scan is recursive rather than top-level only.
SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','university.edit','university',
    NULL, NULL, '{"deep":{"deeper":[{"api_key":"leak"}]}}'::jsonb)$$,
                '7.9  the scan is RECURSIVE through objects and arrays', 'forbidden key');

-- Private message bodies: banned specifically on message-targeted rows.
SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','message.revealBody','message',
    NULL, NULL, NULL, NULL, '{"content":"the private message text"}'::jsonb)$$,
                '7.10 a message BODY is rejected on a message row',  'private message content');

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','message.revealBody','message',
    NULL, NULL, NULL, NULL, '{"attachment_url":"https://x/y.png"}'::jsonb)$$,
                '7.11 an attachment URL is rejected on a message row', 'private message content');

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','message.revealBody','message',
    NULL, NULL, NULL, NULL, '{"poll_question":"who is coming?"}'::jsonb)$$,
                '7.12 poll question text is rejected on a message row', 'private message content');

-- The SAFE metadata shape for a sensitive reveal must still be accepted:
-- ids, a length, and a boolean — never the text itself.
SELECT t_assert(
  public.admin_audit_log(
    :FOUNDER::uuid, 'founder@weglue.app', 'message.revealBody', 'message',
    '44444444-0000-4000-8000-000000000005'::uuid, NULL, NULL, NULL,
    '{"conversation_id":"55555555-0000-4000-8000-000000000006","content_len":142,"has_attachment":true}'::jsonb
  ) IS NOT NULL,
  '7.13 SAFE reveal metadata (ids + content_len + has_attachment) IS accepted'
);
RESET ROLE;


-- ===========================================================================
-- GROUP 8 — Reason requirement for sensitive/destructive actions
-- ===========================================================================
SET ROLE service_role;

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','membership.remove','club_member',
    '11111111-0000-4000-8000-000000000002'::uuid, NULL)$$,
                '8.1  a destructive action WITHOUT a reason is rejected', 'requires a reason');

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','membership.remove','club_member',
    '11111111-0000-4000-8000-000000000002'::uuid, '   ')$$,
                '8.2  a blank/whitespace reason does not satisfy the requirement', 'requires a reason');

SELECT t_assert(
  public.admin_audit_log(
    :FOUNDER::uuid,'founder@weglue.app','membership.remove','club_member',
    :TARGET::uuid, 'Removed at the member''s own request (ticket 118).'
  ) IS NOT NULL,
  '8.3  the same action WITH a reason succeeds'
);

-- A FAILURE record must never be lost just because no reason was supplied —
-- the failure may have occurred during input validation, before the operator
-- ever reached a reason prompt.
SELECT t_assert(
  public.admin_audit_log(
    :FOUNDER::uuid,'founder@weglue.app','membership.remove','club_member',
    :TARGET::uuid, NULL, NULL, NULL, '{}'::jsonb, false, 'not_a_member'
  ) IS NOT NULL,
  '8.4  a FAILURE record is stored without a reason (failures are never dropped)'
);

-- An ordinary action needs no reason at all.
SELECT t_assert(
  public.admin_audit_log(
    :FOUNDER::uuid,'founder@weglue.app','notification.setRead','notification',
    '66666666-0000-4000-8000-000000000007'::uuid
  ) IS NOT NULL,
  '8.5  an ordinary action needs no reason'
);
RESET ROLE;


-- ===========================================================================
-- GROUP 9 — Honest success/failure semantics
-- ===========================================================================
-- A success row must not carry an error code, and a failure row must say why.
-- This is what stops a rolled-back mutation from being filed as a success.
SET ROLE service_role;
SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','notification.setRead','notification',
    NULL, NULL, NULL, NULL, '{}'::jsonb, true, 'some_error')$$,
                '9.1  a SUCCESS row carrying an error_code is rejected', 'error_consistency');

SELECT t_denied($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','notification.setRead','notification',
    NULL, NULL, NULL, NULL, '{}'::jsonb, false, NULL)$$,
                '9.2  a FAILURE row with no error_code is rejected',     'error_consistency');
RESET ROLE;

SELECT t_assert(
  (SELECT count(*) FROM admin_audit_events WHERE NOT success) = 1,
  '9.3  exactly one failure record is stored, and it is marked as a failure'
);
SELECT t_assert(
  (SELECT error_code FROM admin_audit_events WHERE NOT success) = 'not_a_member',
  '9.4  the failure record preserves its error code'
);


-- ===========================================================================
-- GROUP 10 — correlation_id connects multi-step operations
-- ===========================================================================
-- An officer transfer touches club_members AND club_officers. Both steps share
-- one correlation id so a reviewer sees a single logical operation.
SET ROLE service_role;
SELECT public.admin_audit_log(
  :FOUNDER::uuid,'founder@weglue.app','officer.demote','club_officer',
  '77777777-0000-4000-8000-000000000008'::uuid,'Officer transfer step 1 of 2.',
  NULL, NULL, '{}'::jsonb, true, NULL,
  '88888888-0000-4000-8000-000000000009'::uuid
);
SELECT public.admin_audit_log(
  :FOUNDER::uuid,'founder@weglue.app','officer.promote','club_officer',
  '99999999-0000-4000-8000-00000000000a'::uuid,'Officer transfer step 2 of 2.',
  NULL, NULL, '{}'::jsonb, true, NULL,
  '88888888-0000-4000-8000-000000000009'::uuid
);
RESET ROLE;

SELECT t_assert(
  (SELECT count(*) FROM admin_audit_events
    WHERE correlation_id = '88888888-0000-4000-8000-000000000009'::uuid) = 2,
  '10.1 both steps of a transfer share one correlation_id'
);
SELECT t_assert(
  (SELECT count(DISTINCT action) FROM admin_audit_events
    WHERE correlation_id = '88888888-0000-4000-8000-000000000009'::uuid) = 2,
  '10.2 the correlated steps are distinguishable by action'
);
SELECT t_assert(
  (SELECT count(DISTINCT correlation_id) FROM admin_audit_events) > 1,
  '10.3 unrelated operations get distinct correlation ids (auto-generated)'
);


-- ===========================================================================
-- GROUP 11 — Deleting a user does NOT delete audit history
-- ===========================================================================
-- The real production scenario: the founder deletes a student account (hard
-- cascade, migrations 044/052). Because there is no FK, the audit rows about
-- that account survive. This test simulates the account tables and cascades
-- them, then proves the trail is untouched.
CREATE TABLE t_fake_accounts (id uuid PRIMARY KEY);
INSERT INTO t_fake_accounts VALUES (:FOUNDER::uuid), (:TARGET::uuid);

SELECT t_assert(
  (SELECT count(*) FROM admin_audit_events
    WHERE actor_user_id = :FOUNDER::uuid OR target_id = :TARGET::uuid) >= 3,
  '11.1 audit rows exist that reference both the actor and the target account'
);

DELETE FROM t_fake_accounts;  -- the accounts are gone

SELECT t_assert(
  (SELECT count(*) FROM admin_audit_events WHERE actor_user_id = :FOUNDER::uuid) >= 3,
  '11.2 ACTOR account deleted -> their audit history SURVIVES'
);
SELECT t_assert(
  (SELECT count(*) FROM admin_audit_events WHERE target_id = :TARGET::uuid) >= 2,
  '11.3 TARGET account deleted -> audit history about them SURVIVES'
);
SELECT t_assert(
  (SELECT actor_email FROM admin_audit_events
    WHERE actor_user_id = :FOUNDER::uuid ORDER BY occurred_at LIMIT 1) = 'founder@weglue.app',
  '11.4 the historical actor EMAIL is preserved as immutable evidence'
);
DROP TABLE t_fake_accounts;


-- ===========================================================================
-- GROUP 12 — Bounds
-- ===========================================================================
SET ROLE service_role;
SELECT t_denied(format($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','event.edit','event',
    NULL, NULL, %L::jsonb)$$, json_build_object('blob', repeat('x', 20000))::text),
                '12.1 an oversized before_state is rejected (table-bloat guard)', 'violates check constraint');

SELECT t_denied(format($$SELECT public.admin_audit_log(
    '94387196-0000-4000-8000-000000000001'::uuid,'f@w.app','rsvp.remove','rsvp',
    NULL, %L)$$, repeat('y', 600)),
                '12.2 an oversized reason is rejected',                          'violates check constraint');
RESET ROLE;


-- ===========================================================================
-- Summary
-- ===========================================================================
SELECT t_assert(
  (SELECT count(*) FROM admin_audit_events) = 7,
  '13.1 final state: exactly the 7 rows the accepted calls created'
);

DO $$
DECLARE n int;
BEGIN
  SELECT passed INTO n FROM t_counter;
  RAISE NOTICE '';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '  migration 055 harness: % assertions PASSED', n;
  RAISE NOTICE '=====================================================';
END $$;
