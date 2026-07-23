-- ============================================================================
-- deleted_message_privacy_test.sql
--
-- Executable tests for migration 051 (deleted-message privacy, v9 design §13).
-- Runs inside ONE transaction and ROLLS BACK at the end — no persistent state.
--
--   docker exec -i supabase_db_weglue psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/deleted_message_privacy_test.sql
--
-- Every check records into test_results; the final SELECT raises if any failed,
-- so a non-zero psql exit == a real test failure. RLS-visibility checks run as
-- ROLE authenticated with a JWT claim; RPC/authorization checks set the JWT
-- claim only (SECURITY DEFINER + auth.uid() read the claim).
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE test_results(name text PRIMARY KEY, passed boolean, detail text) ON COMMIT DROP;

-- Fixed identities.
\set u1 '11111111-1111-1111-1111-111111111111'
\set u2 '22222222-2222-2222-2222-222222222222'
\set u3 '33333333-3333-3333-3333-333333333333'
\set c1 'c1c1c1c1-1111-4111-8111-111111111111'
\set c2 'c2c2c2c2-2222-4222-8222-222222222222'

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, aud, role, email)
VALUES (:'u1','authenticated','authenticated','u1@test.edu'),
       (:'u2','authenticated','authenticated','u2@test.edu'),
       (:'u3','authenticated','authenticated','u3@test.edu');

-- auth.users insert fires handle_new_user, which auto-creates profiles rows;
-- upsert to set the fields these tests rely on.
INSERT INTO profiles (id, username, full_name, email_verified, onboarding_completed)
VALUES (:'u1','user_one','User One', true, true),
       (:'u2','user_two','User Two', true, true),
       (:'u3','user_three','User Three', true, true)
ON CONFLICT (id) DO UPDATE
  SET username=EXCLUDED.username, full_name=EXCLUDED.full_name,
      email_verified=true, onboarding_completed=true;

INSERT INTO conversations (id, type, created_by) VALUES
  (:'c1','direct', :'u1'),
  (:'c2','group',  :'u1');

INSERT INTO conversation_participants (conversation_id, user_id) VALUES
  (:'c1', :'u1'), (:'c1', :'u2'),
  (:'c2', :'u1'), (:'c2', :'u2');

-- Messages (all sent by u1 in c1 unless noted).
\set m_text  'aaaa1111-0000-4000-8000-000000000001'
\set m_img   'aaaa1111-0000-4000-8000-000000000002'
\set m_ext   'aaaa1111-0000-4000-8000-000000000003'
\set m_poll  'aaaa1111-0000-4000-8000-000000000004'
\set m_unmap 'aaaa1111-0000-4000-8000-000000000005'
\set m_auth  'aaaa1111-0000-4000-8000-000000000006'
\set m_push  'aaaa1111-0000-4000-8000-000000000007'
\set m_dead  'aaaa1111-0000-4000-8000-000000000008'
\set imgpath 'c1c1c1c1-1111-4111-8111-111111111111/aaa.jpg'

INSERT INTO messages (id, conversation_id, sender_id, message_type, content, attachment_url, attachment_mime, attachment_size) VALUES
  (:'m_text', :'c1', :'u1', 'text',  'secret hello',        NULL,        NULL, NULL),
  (:'m_img',  :'c1', :'u1', 'image', 'caption',             :'imgpath',  'image/jpeg', 1234),
  (:'m_ext',  :'c1', :'u1', 'file',  'doc',                 'file://local/x.pdf', 'application/pdf', 10),
  (:'m_poll', :'c1', :'u1', 'poll',  NULL,                  NULL,        NULL, NULL),
  (:'m_unmap',:'c1', :'u1', 'image', 'cap2',                NULL,        'image/jpeg', 5),
  (:'m_auth', :'c1', :'u1', 'text',  'auth-test secret',    NULL,        NULL, NULL),
  (:'m_push', :'c1', :'u1', 'text',  'push secret',         NULL,        NULL, NULL),
  (:'m_dead', :'c1', :'u1', 'image', 'deadcap',             'c1c1c1c1-1111-4111-8111-111111111111/dead.jpg', 'image/jpeg', 7);

-- Managed-attachment source objects must exist for preflight to pass.
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('chat-attachments', :'imgpath'),
  ('chat-attachments', 'c1c1c1c1-1111-4111-8111-111111111111/dead.jpg');

-- Poll fixture for m_poll.
\set poll1 'bbbb2222-0000-4000-8000-000000000001'
\set opt1  'bbbb2222-0000-4000-8000-000000000011'
\set opt2  'bbbb2222-0000-4000-8000-000000000012'
INSERT INTO polls (id, message_id, question) VALUES (:'poll1', :'m_poll', 'Best day?');
INSERT INTO poll_options (id, poll_id, option_text, display_order) VALUES
  (:'opt1', :'poll1', 'Fri', 0), (:'opt2', :'poll1', 'Sat', 1);
INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES
  (:'poll1', :'opt1', :'u1'), (:'poll1', :'opt1', :'u2');

-- Mirror production's API-role base grants (verified present in prod via
-- has_table_privilege). Supabase's hosted platform grants these to the
-- `authenticated` role; the local CLI's db reset does not fully replicate them,
-- so grant here to exercise the RLS policies exactly as they run in prod.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON storage.objects TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- TEST A — legacy unsend on a no-attachment (Category none) message redacts.
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT unsend_message(:'m_text');

INSERT INTO test_results VALUES ('A1 legacy delete sets deleted_at + nulls content',
  (SELECT deleted_at IS NOT NULL AND content IS NULL FROM messages WHERE id=:'m_text'));
INSERT INTO test_results VALUES ('A2 attempt row: category none, state completed',
  (SELECT count(*)=1 FROM message_deletion_attempts
     WHERE message_id=:'m_text' AND attachment_category='none' AND state='completed' AND entry_point='legacy_rpc'));
INSERT INTO test_results VALUES ('A3 founder history preserves original content',
  (SELECT content='secret hello' FROM deleted_message_history WHERE message_id=:'m_text'));

-- RLS: participant u2 can no longer SELECT the deleted message.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SELECT count(*) AS n FROM messages WHERE id=:'m_text' \gset a4_
RESET ROLE;
INSERT INTO test_results VALUES ('A4 participant cannot SELECT deleted message', :a4_n = 0);

-- ════════════════════════════════════════════════════════════════════════════
-- TEST B — legacy unsend on a MANAGED attachment is refused (B2), zero changes.
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
DO $$
DECLARE v_raised text := NULL;
BEGIN
  BEGIN
    PERFORM unsend_message('aaaa1111-0000-4000-8000-000000000002');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO test_results VALUES ('B1 legacy managed delete raises secure_deletion_required',
    v_raised = 'secure_deletion_required');
END $$;
INSERT INTO test_results VALUES ('B2 managed message unchanged (not deleted)',
  (SELECT deleted_at IS NULL AND content='caption' FROM messages WHERE id=:'m_img'));
INSERT INTO test_results VALUES ('B3 no attempt created for refused managed legacy delete',
  (SELECT count(*)=0 FROM message_deletion_attempts WHERE message_id=:'m_img'));
INSERT INTO test_results VALUES ('B4 no history for refused managed legacy delete',
  (SELECT count(*)=0 FROM deleted_message_history WHERE message_id=:'m_img'));

-- ════════════════════════════════════════════════════════════════════════════
-- TEST C — Edge path (begin_message_deletion) on the managed attachment.
-- ════════════════════════════════════════════════════════════════════════════
-- Preflight first (as the Edge Function would, passing actor explicitly).
SELECT (preflight_message_deletion(:'m_img', :'u1')->>'category') AS cat \gset c0_
INSERT INTO test_results VALUES ('C0 preflight classifies managed', :'c0_cat' = 'managed');

SELECT (begin_message_deletion(:'m_img', :'u1', 'edge_function', 'client-key-img-1', NULL)->>'state') AS st \gset c1_
INSERT INTO test_results VALUES ('C1 edge begin -> state pending', :'c1_st' = 'pending');
INSERT INTO test_results VALUES ('C2 canonical redacted (content + attachment nulled, deleted_at set)',
  (SELECT deleted_at IS NOT NULL AND content IS NULL AND attachment_url IS NULL FROM messages WHERE id=:'m_img'));
INSERT INTO test_results VALUES ('C3 immutable mapping stores original object path',
  (SELECT original_bucket='chat-attachments' AND original_object_path=:'imgpath' AND mapping_confidence='high'
     FROM message_attachment_map WHERE message_id=:'m_img'));
INSERT INTO test_results VALUES ('C4 history preserves original content + attachment',
  (SELECT content='caption' AND attachment_url=:'imgpath' FROM deleted_message_history WHERE message_id=:'m_img'));
INSERT INTO test_results VALUES ('C5 is_deleted_message true', is_deleted_message(:'m_img'));
INSERT INTO test_results VALUES ('C6 is_deleted_attachment true -> new signed URL denied',
  is_deleted_attachment('chat-attachments', :'imgpath'));

-- RLS: a new signed-URL request (storage SELECT) is denied for the deleted object.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SELECT count(*) AS n FROM storage.objects
  WHERE bucket_id='chat-attachments' AND name=:'imgpath' \gset c7_
RESET ROLE;
INSERT INTO test_results VALUES ('C7 participant storage SELECT denied for deleted attachment', :c7_n = 0);

-- ════════════════════════════════════════════════════════════════════════════
-- TEST D — unauthorized deletion creates ZERO state.
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL "request.jwt.claims" = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
DO $$
DECLARE v_raised text := NULL;
BEGIN
  BEGIN
    PERFORM unsend_message('aaaa1111-0000-4000-8000-000000000006');  -- m_auth, u3 not participant
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO test_results VALUES ('D1 unauthorized delete raises (opaque)',
    v_raised = 'not_found_or_not_authorized');
END $$;
INSERT INTO test_results VALUES ('D2 unauthorized: message unchanged',
  (SELECT deleted_at IS NULL AND content='auth-test secret' FROM messages WHERE id=:'m_auth'));
INSERT INTO test_results VALUES ('D3 unauthorized: no attempt/history',
  (SELECT count(*)=0 FROM message_deletion_attempts WHERE message_id=:'m_auth')
  AND (SELECT count(*)=0 FROM deleted_message_history WHERE message_id=:'m_auth'));

-- ════════════════════════════════════════════════════════════════════════════
-- TEST E — poll privacy on deletion.
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT (begin_message_deletion(:'m_poll', :'u1', 'edge_function', 'client-key-poll-1', NULL)->>'state') AS st \gset e0_
INSERT INTO test_results VALUES ('E0 poll message deletion completes (category none)', :'e0_st' = 'completed');
INSERT INTO test_results VALUES ('E1 poll snapshot captured (options + votes + totals)',
  (SELECT poll_snapshot->>'question'='Best day?'
      AND jsonb_array_length(poll_snapshot->'options')=2
      AND jsonb_array_length(poll_snapshot->'votes')=2
      AND (poll_snapshot->'totals'->>'bbbb2222-0000-4000-8000-000000000011')='2'
     FROM deleted_message_history WHERE message_id=:'m_poll'));

-- RLS: participant u2 cannot read the poll / options / votes of a deleted poll.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SELECT count(*) AS p FROM polls WHERE id=:'poll1' \gset e2_
SELECT count(*) AS o FROM poll_options WHERE poll_id=:'poll1' \gset e3_
SELECT count(*) AS v FROM poll_votes WHERE poll_id=:'poll1' \gset e4_
RESET ROLE;
INSERT INTO test_results VALUES ('E2 deleted poll hidden from participant', :e2_p = 0);
INSERT INTO test_results VALUES ('E3 deleted poll options hidden', :e3_o = 0);
INSERT INTO test_results VALUES ('E4 deleted poll votes hidden', :e4_v = 0);

-- Voting on a deleted poll is denied.
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
DO $$
DECLARE v_raised text := NULL;
BEGIN
  BEGIN PERFORM cast_poll_vote('bbbb2222-0000-4000-8000-000000000001','bbbb2222-0000-4000-8000-000000000012');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  INSERT INTO test_results VALUES ('E5 cast_poll_vote on deleted poll denied', v_raised = 'Poll not found');
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- TEST F — Category C (unmappable) preflight failure: no attempt, safe diagnostic.
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
DO $$
DECLARE v_raised text := NULL;
BEGIN
  BEGIN PERFORM unsend_message('aaaa1111-0000-4000-8000-000000000005');  -- m_unmap
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  INSERT INTO test_results VALUES ('F1 category-C delete raises attachment_unmappable',
    v_raised = 'attachment_unmappable');
END $$;
INSERT INTO test_results VALUES ('F2 category-C: no attempt, no redaction',
  (SELECT count(*)=0 FROM message_deletion_attempts WHERE message_id=:'m_unmap')
  AND (SELECT deleted_at IS NULL FROM messages WHERE id=:'m_unmap'));
-- preflight/unsend RAISE, so they cannot persist the diagnostic themselves
-- (the txn rolls back). The orchestrating entry point (delete-message Edge
-- Function) records it in a SEPARATE call; here we invoke that same RPC and
-- assert it commits a clean, path/content-free diagnostic.
SELECT record_unmappable_attachment_diagnostic(:'m_unmap', 'unmappable_attachment');
INSERT INTO test_results VALUES ('F3 safe diagnostic committed via dedicated RPC (no path/content)',
  (SELECT count(*)=1 FROM data_health_diagnostics
     WHERE diagnostic_type='unmappable_attachment' AND related_entity_id=:'m_unmap'
       AND (safe_metadata ? 'diagnostic_code')
       AND NOT (safe_metadata::text LIKE '%chat-attachments%')
       AND NOT (safe_metadata::text LIKE '%/%')));

-- ════════════════════════════════════════════════════════════════════════════
-- TEST G — worker lease + CAS transitions (drives m_img managed attempt).
-- ════════════════════════════════════════════════════════════════════════════
SELECT id AS aid FROM message_deletion_attempts WHERE message_id=:'m_img' \gset g_
SELECT (claim_deletion_attempt('worker-1')) AS claim \gset g_
SELECT (:'g_claim'::jsonb->>'claimed')::boolean AS ok,
       (:'g_claim'::jsonb->>'attempt_id') AS caid,
       (:'g_claim'::jsonb->>'claim_token') AS token \gset g_
INSERT INTO test_results VALUES ('G1 worker claims eligible managed attempt', :'g_ok' = 't' AND :'g_caid' = :'g_aid');
INSERT INTO test_results VALUES ('G2 heartbeat with valid token succeeds',
  heartbeat_deletion_claim(:'g_aid', :'g_token'));
-- Stale token cannot transition (CAS rejects).
INSERT INTO test_results VALUES ('G3 stale claim token rejected (CAS zero rows)',
  mark_retention_copied(:'g_aid', gen_random_uuid(), 'deleted-message-retention', 'x/y', 'chk') = false);
INSERT INTO test_results VALUES ('G4 valid token pending->retained',
  mark_retention_copied(:'g_aid', :'g_token', 'deleted-message-retention', :'g_aid' || '/' || :'imgpath', 'chk1'));
INSERT INTO test_results VALUES ('G5 retained->original_removed with verification',
  mark_original_removed(:'g_aid', :'g_token', '{"method":"storage_list","result":"absent"}'::jsonb));
INSERT INTO test_results VALUES ('G6 original_removed->completed (finalize)',
  finalize_message_deletion(:'g_aid', :'g_token'));
INSERT INTO test_results VALUES ('G7 attempt terminal completed',
  (SELECT state='completed' FROM message_deletion_attempts WHERE id=:'g_aid'));
INSERT INTO test_results VALUES ('G8 mapping records verified_absent',
  (SELECT delete_status='verified_absent' AND copy_status='verified' FROM message_attachment_map WHERE attempt_id=:'g_aid'));

-- ════════════════════════════════════════════════════════════════════════════
-- TEST H — dead-letter is NOT auto-reclaimed; manual retry re-enables one attempt.
-- ════════════════════════════════════════════════════════════════════════════
SELECT (begin_message_deletion(:'m_dead', :'u1', 'edge_function', 'client-key-dead-1', NULL)->>'state') AS st \gset h0_
SELECT id AS aid FROM message_deletion_attempts WHERE message_id=:'m_dead' \gset h_
SELECT (claim_deletion_attempt('worker-2')::jsonb->>'claim_token') AS token \gset h_
-- Permanent failure -> dead-letter.
SELECT (fail_deletion_attempt(:'h_aid', :'h_token', 'retention_checksum_mismatch', true)::jsonb->>'dead_lettered') AS dl \gset h_
INSERT INTO test_results VALUES ('H1 permanent failure dead-letters', :'h_dl' = 'true');
INSERT INTO test_results VALUES ('H2 dead-letter flags set',
  (SELECT requires_manual_reconciliation AND dead_lettered_at IS NOT NULL AND dead_lettered_by='worker'
     FROM message_deletion_attempts WHERE id=:'h_aid'));
-- Worker must NOT reclaim a dead-lettered attempt.
SELECT (claim_deletion_attempt('worker-3')::jsonb->>'claimed') AS ok \gset h2_
INSERT INTO test_results VALUES ('H3 dead-lettered attempt not auto-reclaimed',
  NOT EXISTS (SELECT 1 FROM message_deletion_attempts
              WHERE id=:'h_aid' AND claimed_by='worker-3'));
-- Manual retry clears the dead-letter and schedules exactly one attempt.
INSERT INTO test_results VALUES ('H4 manual retry clears dead-letter',
  (admin_manual_retry_deletion(:'h_aid', 'ops review')::jsonb->>'ok')::boolean);
INSERT INTO test_results VALUES ('H5 after manual retry: claimable again',
  (SELECT NOT requires_manual_reconciliation AND dead_lettered_at IS NULL
     FROM message_deletion_attempts WHERE id=:'h_aid'));

-- ════════════════════════════════════════════════════════════════════════════
-- TEST I — idempotency + restore-then-delete-again.
-- ════════════════════════════════════════════════════════════════════════════
-- Second legacy call on already-deleted m_text is a clean no-op (still 1 attempt).
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT unsend_message(:'m_text');
INSERT INTO test_results VALUES ('I1 duplicate legacy delete is idempotent (one attempt)',
  (SELECT count(*)=1 FROM message_deletion_attempts WHERE message_id=:'m_text'));

-- Restore m_text (founder path) then delete again -> new attempt_no 2.
SELECT id AS aid FROM message_deletion_attempts WHERE message_id=:'m_text' \gset i_
-- Two statements: a volatile function's mid-statement writes are not visible to
-- a subquery in the SAME statement (snapshot), so assert content separately.
SELECT (admin_restore_message(:'i_aid', 'appeal')->>'ok') AS ok \gset i2_
INSERT INTO test_results VALUES ('I2 admin_restore_message returns ok', :'i2_ok' = 'true');
INSERT INTO test_results VALUES ('I2b restored content + cleared deleted_at visible',
  (SELECT deleted_at IS NULL AND content='secret hello' FROM messages WHERE id=:'m_text'));
SELECT unsend_message(:'m_text');
INSERT INTO test_results VALUES ('I3 delete-after-restore creates a new attempt (attempt_no 2)',
  (SELECT max(attempt_no)=2 AND count(*)=2 FROM message_deletion_attempts WHERE message_id=:'m_text'));

-- ════════════════════════════════════════════════════════════════════════════
-- TEST J — private-table denial for ordinary authenticated users.
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
SELECT count(*) AS a FROM message_deletion_attempts \gset j1_
SELECT count(*) AS b FROM message_attachment_map \gset j2_
SELECT count(*) AS c FROM deleted_message_history \gset j3_
SELECT count(*) AS d FROM data_health_diagnostics \gset j4_
SELECT count(*) AS e FROM report_evidence \gset j5_
RESET ROLE;
INSERT INTO test_results VALUES ('J1 message_deletion_attempts deny-all to authenticated', :j1_a = 0);
INSERT INTO test_results VALUES ('J2 message_attachment_map deny-all', :j2_b = 0);
INSERT INTO test_results VALUES ('J3 deleted_message_history deny-all', :j3_c = 0);
INSERT INTO test_results VALUES ('J4 data_health_diagnostics deny-all', :j4_d = 0);
INSERT INTO test_results VALUES ('J5 report_evidence deny-all', :j5_e = 0);

-- ════════════════════════════════════════════════════════════════════════════
-- TEST K — push cleanup: linked pending push scrubbed; unrelated push untouched.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO push_queue (user_id, category, title, body, source_type, source_message_id, dedupe_key, status)
VALUES (:'u2','messages','User One','push secret','message', :'m_push', 'msg:'||:'m_push'||':'||:'u2', 'pending'),
       (:'u2','messages','Other','unrelated body','message', :'m_auth', 'msg:'||:'m_auth'||':'||:'u2', 'pending');
SET LOCAL "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
SELECT unsend_message(:'m_push');
INSERT INTO test_results VALUES ('K1 linked pending push scrubbed (suppressed + body nulled)',
  (SELECT status='suppressed' AND body IS NULL AND title IS NULL
     FROM push_queue WHERE source_message_id=:'m_push'));
INSERT INTO test_results VALUES ('K2 unrelated pending push untouched',
  (SELECT status='pending' AND body='unrelated body'
     FROM push_queue WHERE source_message_id=:'m_auth'));

-- ════════════════════════════════════════════════════════════════════════════
-- TEST L — SECURITY DEFINER hardening: privileged RPCs not granted to clients.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO test_results VALUES ('L1 begin_message_deletion not executable by authenticated',
  NOT has_function_privilege('authenticated',
    'begin_message_deletion(uuid,uuid,text,text,text)', 'EXECUTE'));
INSERT INTO test_results VALUES ('L2 preflight not executable by authenticated',
  NOT has_function_privilege('authenticated',
    'preflight_message_deletion(uuid,uuid)', 'EXECUTE'));
INSERT INTO test_results VALUES ('L3 claim_deletion_attempt not executable by authenticated',
  NOT has_function_privilege('authenticated', 'claim_deletion_attempt(text)', 'EXECUTE'));
INSERT INTO test_results VALUES ('L4 admin_restore_message not executable by authenticated',
  NOT has_function_privilege('authenticated', 'admin_restore_message(uuid,text)', 'EXECUTE'));
INSERT INTO test_results VALUES ('L5 unsend_message IS executable by authenticated (legacy path)',
  has_function_privilege('authenticated', 'unsend_message(uuid)', 'EXECUTE'));
INSERT INTO test_results VALUES ('L7 service_role CAN execute the edge-called RPCs',
  has_function_privilege('service_role','begin_message_deletion(uuid,uuid,text,text,text)','EXECUTE')
  AND has_function_privilege('service_role','claim_deletion_attempt(text)','EXECUTE')
  AND has_function_privilege('service_role','claim_specific_deletion_attempt(uuid,text)','EXECUTE')
  AND has_function_privilege('service_role','preflight_message_deletion(uuid,uuid)','EXECUTE'));
INSERT INTO test_results VALUES ('L6 all new SECURITY DEFINER funcs have a pinned search_path',
  (SELECT bool_and(p.proconfig::text LIKE '%search_path%')
     FROM pg_proc p
     WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
       AND p.proname IN ('is_deleted_message','is_deleted_attachment','classify_message_attachment',
         'preflight_message_deletion','begin_message_deletion','unsend_message','claim_deletion_attempt',
         'heartbeat_deletion_claim','mark_retention_copied','mark_original_removed',
         'finalize_message_deletion','fail_deletion_attempt','admin_manual_retry_deletion',
         'admin_restore_message','admin_purge_deleted_message','scrub_message_pushes',
         'record_unmappable_attachment_diagnostic','message_conversation_id','enqueue_push',
         'cast_poll_vote')));

-- ════════════════════════════════════════════════════════════════════════════
-- TEST M — club-officer Edge-path authorization (actor-parameterized officer
-- check; is_club_officer() reads auth.uid() = NULL under service_role, so begin/
-- preflight must authorize the officer via p_actor_id).
-- ════════════════════════════════════════════════════════════════════════════
\set club1 'dddd4444-0000-4000-8000-000000000001'
\set c3    'c3c3c3c3-3333-4333-8333-333333333333'
\set m_off 'aaaa1111-0000-4000-8000-000000000009'
INSERT INTO clubs (id, name, handle, description, member_count, is_active, claimed, is_seed)
VALUES (:'club1','Test Club','test-club','desc', 2, true, true, false);
INSERT INTO club_members (club_id, user_id, role) VALUES
  (:'club1', :'u1', 'officer'),
  (:'club1', :'u2', 'member');
INSERT INTO conversations (id, type, club_id) VALUES (:'c3','club_group', :'club1');
INSERT INTO conversation_participants (conversation_id, user_id) VALUES
  (:'c3', :'u1'), (:'c3', :'u2');
INSERT INTO messages (id, conversation_id, sender_id, message_type, content)
VALUES (:'m_off', :'c3', :'u2', 'text', 'member message');

-- Officer u1 deletes member u2's message via the Edge path (no JWT claim; actor
-- supplied explicitly, as the Edge Function does under service_role).
RESET ROLE;
SET LOCAL "request.jwt.claims" = '';
SELECT (begin_message_deletion(:'m_off', :'u1', 'edge_function', 'client-key-off-1', NULL)->>'state') AS st \gset m1_
INSERT INTO test_results VALUES ('M1 officer deletes member message via edge path (actor-parameterized)',
  :'m1_st' = 'completed' AND (SELECT deleted_at IS NOT NULL AND content IS NULL FROM messages WHERE id=:'m_off'));

-- Non-officer, non-sender u3 is refused by preflight (opaque error), zero state.
INSERT INTO messages (id, conversation_id, sender_id, message_type, content)
VALUES ('aaaa1111-0000-4000-8000-00000000000a', :'c3', :'u2', 'text', 'second member message');
DO $$
DECLARE v_raised text := NULL;
BEGIN
  BEGIN PERFORM preflight_message_deletion('aaaa1111-0000-4000-8000-00000000000a',
                                           '33333333-3333-3333-3333-333333333333');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  INSERT INTO test_results VALUES ('M2 non-officer non-sender refused on edge path',
    v_raised = 'not_found_or_not_authorized');
END $$;
INSERT INTO test_results VALUES ('M3 refused edge delete leaves message intact',
  (SELECT deleted_at IS NULL FROM messages WHERE id='aaaa1111-0000-4000-8000-00000000000a'));

-- ════════════════════════════════════════════════════════════════════════════
-- RESULTS
-- ════════════════════════════════════════════════════════════════════════════
\echo ''
\echo '──────────────── TEST RESULTS ────────────────'
SELECT name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result
FROM test_results ORDER BY name;

SELECT count(*) FILTER (WHERE passed) AS passed,
       count(*) FILTER (WHERE NOT passed OR passed IS NULL) AS failed,
       count(*) AS total
FROM test_results;

DO $$
DECLARE v_failed int;
BEGIN
  SELECT count(*) INTO v_failed FROM test_results WHERE passed IS NOT TRUE;
  IF v_failed > 0 THEN
    RAISE EXCEPTION '% test(s) FAILED', v_failed;
  END IF;
  RAISE NOTICE 'ALL TESTS PASSED';
END $$;

ROLLBACK;
