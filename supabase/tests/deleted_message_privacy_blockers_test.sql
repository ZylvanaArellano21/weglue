-- ============================================================================
-- deleted_message_privacy_blockers_test.sql
--
-- Regression tests for the SEVEN Codex production-blockers fixed in migration
-- 051 (deleted-message privacy). Companion to deleted_message_privacy_test.sql;
-- runs in ONE transaction and ROLLS BACK — no persistent state.
--
--   docker exec -i supabase_db_weglue psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/deleted_message_privacy_blockers_test.sql
--
-- Each check records into test_results; the final SELECT raises if any failed.
-- RLS-visibility checks run as ROLE authenticated with a JWT claim; privileged
-- RPC/state-machine checks run as the default superuser (as the service role /
-- Edge worker would, since those RPCs are REVOKE'd from authenticated).
-- ============================================================================
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TEMP TABLE test_results(name text PRIMARY KEY, passed boolean, detail text) ON COMMIT DROP;

-- ── Identities ──────────────────────────────────────────────────────────────
\set e1 'e1e1e1e1-0000-4000-8000-000000000001'
\set e2 'e2e2e2e2-0000-4000-8000-000000000002'
\set e3 'e3e3e3e3-0000-4000-8000-000000000003'

\set cd 'cdcdcdcd-0000-4000-8000-000000000001'
\set cg 'cacacaca-0000-4000-8000-000000000002'
\set ck 'cbcbcbcb-0000-4000-8000-000000000003'
\set club 'c1ab0000-0000-4000-8000-000000000001'
\set chx 'c8a17e10-0000-4000-8000-000000000001'
\set chm 'c8a17e10-0000-4000-8000-0000000000ff'

INSERT INTO auth.users (id, aud, role, email) VALUES
  (:'e1','authenticated','authenticated','e1@test.edu'),
  (:'e2','authenticated','authenticated','e2@test.edu'),
  (:'e3','authenticated','authenticated','e3@test.edu');
INSERT INTO profiles (id, username, full_name, email_verified, onboarding_completed) VALUES
  (:'e1','e_one','E One', true, true),
  (:'e2','e_two','E Two', true, true),
  (:'e3','e_three','E Three', true, true)
ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, email_verified=true, onboarding_completed=true;

INSERT INTO clubs (id, name, handle, description, member_count, is_active, claimed, is_seed)
VALUES (:'club','Blk Club','blk-club','d', 2, true, true, false);
INSERT INTO club_members (club_id, user_id, role) VALUES
  (:'club', :'e1', 'officer'), (:'club', :'e2', 'member');

INSERT INTO conversations (id, type, created_by, club_id) VALUES
  (:'cd','direct', :'e1', NULL),
  (:'cg','group',  :'e1', NULL),
  (:'ck','club_group', NULL, :'club');
INSERT INTO conversation_participants (conversation_id, user_id) VALUES
  (:'cd', :'e1'), (:'cd', :'e2'),
  (:'cg', :'e1'), (:'cg', :'e2'),
  (:'ck', :'e1'), (:'ck', :'e2');

INSERT INTO conversation_channels (id, conversation_id, name, kind) VALUES
  (:'chm', :'ck', 'Main', 'main'),
  (:'chx', :'ck', 'general', 'channel');

-- Messages.
\set m_txt   'aaaae100-0000-4000-8000-000000000001'
\set m_poll  'aaaae100-0000-4000-8000-000000000002'
\set g_txt   'aaaae100-0000-4000-8000-000000000003'
\set k_main  'aaaae100-0000-4000-8000-000000000004'
\set k_ch1   'aaaae100-0000-4000-8000-000000000005'
\set k_ch2   'aaaae100-0000-4000-8000-000000000006'
\set k_img   'cbcbcbcb-0000-4000-8000-000000000003/ch.jpg'
\set m_mgd   'aaaae100-0000-4000-8000-000000000007'
\set m_img   'cdcdcdcd-0000-4000-8000-000000000001/w.jpg'

INSERT INTO messages (id, conversation_id, channel_id, sender_id, message_type, content, attachment_url, attachment_mime, attachment_size) VALUES
  (:'m_txt',  :'cd', NULL,   :'e1', 'text',  'direct secret',   NULL, NULL, NULL),
  (:'m_poll', :'cd', NULL,   :'e1', 'poll',  NULL,              NULL, NULL, NULL),
  (:'g_txt',  :'cg', NULL,   :'e2', 'text',  'group secret',    NULL, NULL, NULL),
  (:'k_main', :'ck', :'chm', :'e2', 'text',  'main secret',     NULL, NULL, NULL),
  (:'k_ch1',  :'ck', :'chx', :'e1', 'text',  'chan secret 1',   NULL, NULL, NULL),
  (:'k_ch2',  :'ck', :'chx', :'e2', 'image', 'chan img',        :'k_img', 'image/jpeg', 22),
  (:'m_mgd',  :'cd', NULL,   :'e1', 'image', 'wcap',            :'m_img', 'image/jpeg', 33);
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('chat-attachments', :'k_img'),
  ('chat-attachments', :'m_img');

-- Poll fixture for m_poll.
\set pj 'bbbbe100-0000-4000-8000-000000000001'
\set pjo1 'bbbbe100-0000-4000-8000-000000000011'
\set pjo2 'bbbbe100-0000-4000-8000-000000000012'
INSERT INTO polls (id, message_id, question) VALUES (:'pj', :'m_poll', 'Which?');
INSERT INTO poll_options (id, poll_id, option_text, display_order) VALUES
  (:'pjo1', :'pj', 'A', 0), (:'pjo2', :'pj', 'B', 1);
INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (:'pj', :'pjo1', :'e2');

-- Mirror prod API-role base grants (RLS gates them). Then restore migration 051's
-- messages UPDATE/DELETE revoke that the blanket grant above re-added.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON storage.objects TO authenticated;
REVOKE UPDATE, DELETE ON messages FROM authenticated;
-- service_role in prod holds ALL on public tables via Supabase default privileges
-- (it BYPASSES RLS but still needs the base grant). Mirror it so the backfill /
-- moderation-read assertions exercise the real access path.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCKER 1 — deleted-message UPDATE bypass removed.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO test_results VALUES ('B1.1 authenticated has NO UPDATE on messages',
  NOT has_table_privilege('authenticated','public.messages','UPDATE'));
INSERT INTO test_results VALUES ('B1.2 no UPDATE policy exists on messages',
  (SELECT count(*)=0 FROM pg_policies WHERE tablename='messages' AND cmd='UPDATE'));

-- Soft-delete a message, then a sender attempt to clear deleted_at / rehydrate
-- content must fail (no grant, no policy).
SELECT unsend_message(:'m_txt') FROM (SELECT set_config('request.jwt.claims',
  '{"sub":"e1e1e1e1-0000-4000-8000-000000000001","role":"authenticated"}', true)) s;
DO $$
DECLARE v_raised text := NULL;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims','{"sub":"e1e1e1e1-0000-4000-8000-000000000001","role":"authenticated"}', true);
  BEGIN
    UPDATE messages SET deleted_at = NULL, content = 'rehydrated'
    WHERE id = 'aaaae100-0000-4000-8000-000000000001';
  EXCEPTION WHEN OTHERS THEN v_raised := SQLSTATE; END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('B1.3 sender cannot clear deleted_at / rehydrate (permission denied)',
    v_raised = '42501');
END $$;
INSERT INTO test_results VALUES ('B1.4 message stays redacted after blocked UPDATE',
  (SELECT deleted_at IS NOT NULL AND content IS NULL FROM messages WHERE id=:'m_txt'));

-- Active-message read still works for a participant (no over-broad breakage).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"e2e2e2e2-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT count(*) AS n FROM messages WHERE id=:'k_main' \gset b15_
RESET ROLE;
INSERT INTO test_results VALUES ('B1.5 active message still readable by participant', :b15_n = 1);

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCKER 2 — report snapshots are private, reporter columns nulled.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO test_results VALUES ('B2.1 no reports row exposes content_snapshot',
  (SELECT count(*)=0 FROM reports WHERE content_snapshot IS NOT NULL));
INSERT INTO test_results VALUES ('B2.2 no reports row exposes attachment_snapshot',
  (SELECT count(*)=0 FROM reports WHERE attachment_snapshot IS NOT NULL));

-- e2 reports e1's managed message: evidence -> report_evidence, NOT reports.
SET LOCAL "request.jwt.claims" = '{"sub":"e2e2e2e2-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT report_message(:'m_mgd', 'spam', 'gross') AS rid \gset b2_
INSERT INTO test_results VALUES ('B2.3 report_message leaves reporter snapshot columns NULL',
  (SELECT content_snapshot IS NULL AND attachment_snapshot IS NULL FROM reports WHERE id=:'b2_rid'));
INSERT INTO test_results VALUES ('B2.4 report_message writes content evidence to report_evidence',
  (SELECT count(*)=1 FROM report_evidence WHERE report_id=:'b2_rid' AND evidence_type='message_content' AND content_snapshot='wcap'));
INSERT INTO test_results VALUES ('B2.5 report_message writes attachment evidence to report_evidence',
  (SELECT count(*)=1 FROM report_evidence WHERE report_id=:'b2_rid' AND evidence_type='attachment' AND storage_path=:'m_img'));

-- Reporter / reported-user / participant CANNOT read report_evidence (deny-all).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"e2e2e2e2-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT count(*) AS n FROM report_evidence WHERE report_id=:'b2_rid' \gset b26_
RESET ROLE;
INSERT INTO test_results VALUES ('B2.6 reporter cannot read report_evidence', :b26_n = 0);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"e1e1e1e1-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT count(*) AS n FROM report_evidence WHERE report_id=:'b2_rid' \gset b27_
RESET ROLE;
INSERT INTO test_results VALUES ('B2.7 reported user cannot read report_evidence', :b27_n = 0);

-- service_role (moderator/backfill) CAN read it (BYPASSRLS).
SET LOCAL ROLE service_role;
SELECT count(*) AS n FROM report_evidence WHERE report_id=:'b2_rid' \gset b28_
RESET ROLE;
INSERT INTO test_results VALUES ('B2.8 service role can read report_evidence (backfill/moderation)', :b28_n = 2);

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCKER 3 — channel/group/official-chat bulk ops never hard-delete messages.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO test_results VALUES ('B3.1 messages.channel_id FK is RESTRICT (no cascade)',
  (SELECT confdeltype='r' FROM pg_constraint WHERE conname='messages_channel_id_fkey'));
INSERT INTO test_results VALUES ('B3.2 messages composite channel FK is RESTRICT',
  (SELECT confdeltype='r' FROM pg_constraint WHERE conname='messages_channel_conversation_fkey'));
INSERT INTO test_results VALUES ('B3.3 messages.conversation_id FK is RESTRICT',
  (SELECT confdeltype='r' FROM pg_constraint WHERE conname='messages_conversation_id_fkey'));

-- delete_conversation_channel (officer e1) — messages redacted, retained,
-- NOT hard-deleted; channel container removed; attempts + history created.
SET LOCAL "request.jwt.claims" = '{"sub":"e1e1e1e1-0000-4000-8000-000000000001","role":"authenticated"}';
SELECT delete_conversation_channel(:'chx');
INSERT INTO test_results VALUES ('B3.4 channel message row still EXISTS (not hard-deleted)',
  (SELECT count(*)=1 FROM messages WHERE id=:'k_ch1'));
INSERT INTO test_results VALUES ('B3.5 channel message redacted (content NULL, deleted_at set)',
  (SELECT content IS NULL AND deleted_at IS NOT NULL FROM messages WHERE id=:'k_ch1'));
INSERT INTO test_results VALUES ('B3.6 channel managed attachment redacted + mapped',
  (SELECT attachment_url IS NULL FROM messages WHERE id=:'k_ch2')
   AND (SELECT count(*)=1 FROM message_attachment_map WHERE message_id=:'k_ch2' AND original_object_path=:'k_img'));
INSERT INTO test_results VALUES ('B3.7 channel deletion snapshots founder history',
  (SELECT content='chan secret 1' FROM deleted_message_history WHERE message_id=:'k_ch1'));
INSERT INTO test_results VALUES ('B3.8 channel container physically removed',
  (SELECT count(*)=0 FROM conversation_channels WHERE id=:'chx'));
INSERT INTO test_results VALUES ('B3.9 redacted channel messages detached (channel_id NULL)',
  (SELECT count(*)=0 FROM messages WHERE channel_id=:'chx'));

-- delete_group_conversation (creator e1) — group messages redacted, not hard-deleted.
SELECT delete_group_conversation(:'cg');
INSERT INTO test_results VALUES ('B3.10 group message row still exists + redacted',
  (SELECT count(*)=1 FROM messages WHERE id=:'g_txt')
   AND (SELECT content IS NULL AND deleted_at IS NOT NULL FROM messages WHERE id=:'g_txt'));
INSERT INTO test_results VALUES ('B3.11 group conversation soft-deleted (not physical)',
  (SELECT deleted_at IS NOT NULL FROM conversations WHERE id=:'cg'));

-- clear_official_chat (officer e1) — remaining ck main message redacted.
SELECT clear_official_chat(:'ck');
INSERT INTO test_results VALUES ('B3.12 official-chat message redacted, not hard-deleted',
  (SELECT count(*)=1 FROM messages WHERE id=:'k_main')
   AND (SELECT content IS NULL AND deleted_at IS NOT NULL FROM messages WHERE id=:'k_main'));

-- Authorization: a non-officer member cannot delete a channel.
INSERT INTO conversation_channels (id, conversation_id, name, kind)
VALUES ('c8a17e10-0000-4000-8000-000000000099', :'ck', 'temp', 'channel');
SET LOCAL "request.jwt.claims" = '{"sub":"e2e2e2e2-0000-4000-8000-000000000002","role":"authenticated"}';
DO $$
DECLARE v_raised text := NULL;
BEGIN
  BEGIN PERFORM delete_conversation_channel('c8a17e10-0000-4000-8000-000000000099');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  INSERT INTO test_results VALUES ('B3.13 non-officer cannot delete channel', v_raised = 'not_authorized');
END $$;
INSERT INTO test_results VALUES ('B3.14 unauthorized channel untouched',
  (SELECT count(*)=1 FROM conversation_channels WHERE id='c8a17e10-0000-4000-8000-000000000099'));

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCKER 4 — client Storage DELETE bypass removed.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO test_results VALUES ('B4.1 chat-attachments uploader-delete policy is gone',
  (SELECT count(*)=0 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
     AND policyname='chat-attachments: uploader can delete'));
INSERT INTO test_results VALUES ('B4.2 no DELETE policy references chat-attachments',
  (SELECT count(*)=0 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
     AND cmd='DELETE' AND qual LIKE '%chat-attachments%'));
INSERT INTO test_results VALUES ('B4.3 retention bucket has NO storage policy (deny-all)',
  (SELECT count(*)=0 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
     AND (qual LIKE '%deleted-message-retention%' OR with_check LIKE '%deleted-message-retention%')));

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCKER 5 — legacy poll_votes/polls policies dropped; RPC-only writes.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO test_results VALUES ('B5.1 legacy poll policies removed',
  (SELECT count(*)=0 FROM pg_policies WHERE tablename IN ('poll_votes','polls','poll_options')
     AND policyname IN ('poll_votes: authenticated can vote','poll_votes: users can remove own vote',
                        'poll_votes: users manage own','polls: participants can read',
                        'poll_options: poll creator can insert')));
INSERT INTO test_results VALUES ('B5.2 poll_votes has NO write policy (INSERT/UPDATE/DELETE)',
  (SELECT count(*)=0 FROM pg_policies WHERE tablename='poll_votes' AND cmd IN ('INSERT','UPDATE','DELETE','ALL')));

-- Direct INSERT to poll_votes denied by RLS (base grant present, no policy).
DO $$
DECLARE v_raised text := NULL;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims','{"sub":"e2e2e2e2-0000-4000-8000-000000000002","role":"authenticated"}', true);
  BEGIN INSERT INTO poll_votes (poll_id, option_id, user_id)
        VALUES ('bbbbe100-0000-4000-8000-000000000001','bbbbe100-0000-4000-8000-000000000012',
                'e2e2e2e2-0000-4000-8000-000000000002');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLSTATE; END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('B5.3 direct INSERT to poll_votes denied by RLS', v_raised = '42501');
END $$;
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims','{"sub":"e2e2e2e2-0000-4000-8000-000000000002","role":"authenticated"}', true);
  -- RLS DELETE with no matching policy affects 0 rows (no error).
  DELETE FROM poll_votes WHERE poll_id='bbbbe100-0000-4000-8000-000000000001'
          AND user_id='e2e2e2e2-0000-4000-8000-000000000002';
  RESET ROLE;
  INSERT INTO test_results VALUES ('B5.4 direct DELETE from poll_votes removes nothing',
    (SELECT count(*)=1 FROM poll_votes WHERE poll_id='bbbbe100-0000-4000-8000-000000000001'));
END $$;

-- cast_poll_vote works on the active poll (RPC, definer).
SELECT set_config('request.jwt.claims','{"sub":"e1e1e1e1-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT cast_poll_vote(:'pj', :'pjo2');
INSERT INTO test_results VALUES ('B5.5 cast_poll_vote succeeds on active poll',
  (SELECT count(*)=1 FROM poll_votes WHERE poll_id=:'pj' AND user_id=:'e1' AND option_id=:'pjo2'));

-- Delete the poll message, then cast_poll_vote must fail + votes/totals hidden.
SELECT begin_message_deletion(:'m_poll', :'e1', 'edge_function', 'poll-del-1', NULL);
DO $$
DECLARE v_raised text := NULL;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"e1e1e1e1-0000-4000-8000-000000000001","role":"authenticated"}', true);
  BEGIN PERFORM cast_poll_vote('bbbbe100-0000-4000-8000-000000000001','bbbbe100-0000-4000-8000-000000000011');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  INSERT INTO test_results VALUES ('B5.6 cast_poll_vote fails on deleted poll', v_raised = 'Poll not found');
END $$;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"e2e2e2e2-0000-4000-8000-000000000002","role":"authenticated"}';
SELECT count(*) AS n FROM poll_votes WHERE poll_id=:'pj' \gset b57_
SELECT count(*) AS n FROM polls WHERE id=:'pj' \gset b58_
RESET ROLE;
INSERT INTO test_results VALUES ('B5.7 participant cannot read deleted poll votes/totals', :b57_n = 0);
INSERT INTO test_results VALUES ('B5.8 participant cannot read deleted poll row', :b58_n = 0);

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCKER 6 — worker resumes failed attempts from the correct step.
-- ════════════════════════════════════════════════════════════════════════════
-- _dmp_resume_state resolver.
INSERT INTO test_results VALUES ('B6.1 resume(created)->pending',
  _dmp_resume_state('failed_requires_reconciliation','created') = 'pending');
INSERT INTO test_results VALUES ('B6.2 resume(retained)->retained',
  _dmp_resume_state('failed_requires_reconciliation','retained') = 'retained');
INSERT INTO test_results VALUES ('B6.3 resume(original_removed)->original_removed',
  _dmp_resume_state('failed_requires_reconciliation','original_removed') = 'original_removed');
INSERT INTO test_results VALUES ('B6.4 resume passes active state through',
  _dmp_resume_state('retained','retained') = 'retained');

-- Fixture: a fresh managed attempt (pending) for m_mgd is already created by the
-- B2 report? No — create it now via the edge path.
SELECT (begin_message_deletion(:'m_mgd', :'e1', 'edge_function', 'wrk-1', NULL)->>'attempt_id') AS aid \gset b6_
-- Failure BEFORE copy: claim, fail, then reclaim resumes at 'pending'.
SELECT (claim_specific_deletion_attempt(:'b6_aid', 'w1')->>'claim_token') AS tok \gset b6a_
SELECT fail_deletion_attempt(:'b6_aid', :'b6a_tok', 'copy_failed', false);
UPDATE message_deletion_attempts SET next_retry_at = now() WHERE id=:'b6_aid';
SELECT (claim_specific_deletion_attempt(:'b6_aid', 'w2')->>'state') AS st \gset b6b_
INSERT INTO test_results VALUES ('B6.5 failure before copy resumes at pending', :'b6b_st' = 'pending');
INSERT INTO test_results VALUES ('B6.6 last_completed_step preserved as created',
  (SELECT last_completed_step='created' FROM message_deletion_attempts WHERE id=:'b6_aid'));

-- Advance to retained, fail, reclaim resumes at 'retained'.
SELECT claim_token AS tok FROM message_deletion_attempts WHERE id=:'b6_aid' \gset b6c_
SELECT mark_retention_copied(:'b6_aid', :'b6c_tok', 'deleted-message-retention', 'x/y', 'sum');
INSERT INTO test_results VALUES ('B6.7 mark_retention_copied sets last_completed_step retained',
  (SELECT last_completed_step='retained' AND state='retained' FROM message_deletion_attempts WHERE id=:'b6_aid'));
SELECT fail_deletion_attempt(:'b6_aid', :'b6c_tok', 'remove_failed', false);
UPDATE message_deletion_attempts SET next_retry_at = now() WHERE id=:'b6_aid';
SELECT (claim_specific_deletion_attempt(:'b6_aid', 'w3')->>'state') AS st \gset b6d_
INSERT INTO test_results VALUES ('B6.8 failure after copy resumes at retained', :'b6d_st' = 'retained');

-- Advance to original_removed, fail, reclaim resumes at 'original_removed', finalize.
SELECT claim_token AS tok FROM message_deletion_attempts WHERE id=:'b6_aid' \gset b6e_
SELECT mark_original_removed(:'b6_aid', :'b6e_tok', '{"result":"absent"}'::jsonb);
INSERT INTO test_results VALUES ('B6.9 mark_original_removed sets last_completed_step',
  (SELECT last_completed_step='original_removed' AND state='original_removed' FROM message_deletion_attempts WHERE id=:'b6_aid'));
SELECT fail_deletion_attempt(:'b6_aid', :'b6e_tok', 'finalize_failed', false);
UPDATE message_deletion_attempts SET next_retry_at = now() WHERE id=:'b6_aid';
SELECT (claim_specific_deletion_attempt(:'b6_aid', 'w4')->>'state') AS st \gset b6f_
INSERT INTO test_results VALUES ('B6.10 failure after original removed resumes at original_removed', :'b6f_st' = 'original_removed');
SELECT claim_token AS tok FROM message_deletion_attempts WHERE id=:'b6_aid' \gset b6g_
SELECT finalize_message_deletion(:'b6_aid', :'b6g_tok') AS ok \gset b6h_
INSERT INTO test_results VALUES ('B6.11 finalize completes the resumed attempt', :'b6h_ok' = 't');
INSERT INTO test_results VALUES ('B6.12 attempt terminal completed',
  (SELECT state='completed' FROM message_deletion_attempts WHERE id=:'b6_aid'));

-- Lease expiry + stale token + duplicate worker (new attempt via bulk on cd? use a
-- fresh managed message). Reuse k_ch2's attempt (created by B3 channel delete).
SELECT id AS aid FROM message_deletion_attempts WHERE message_id=:'k_ch2' \gset b6i_
-- Force it back to a claimable pending state with no active lease for this probe.
UPDATE message_deletion_attempts
  SET state='pending', last_completed_step='created', claim_token=NULL, claim_expires_at=NULL,
      next_retry_at=now(), retry_count=0, requires_manual_reconciliation=false, dead_lettered_at=NULL
  WHERE id=:'b6i_aid';
SELECT (claim_specific_deletion_attempt(:'b6i_aid','wA')->>'claim_token') AS tok \gset b6j_
-- Duplicate worker while lease valid: second claim returns claimed=false.
SELECT (claim_specific_deletion_attempt(:'b6i_aid','wB')->>'claimed') AS c \gset b6k_
INSERT INTO test_results VALUES ('B6.13 duplicate worker cannot double-claim a leased attempt', :'b6k_c' = 'false');
-- Stale token CAS rejected.
SELECT mark_retention_copied(:'b6i_aid','00000000-0000-0000-0000-000000000000','b','p',NULL) AS ok \gset b6l_
INSERT INTO test_results VALUES ('B6.14 stale-token CAS transition rejected', :'b6l_ok' = 'f');
SELECT heartbeat_deletion_claim(:'b6i_aid','00000000-0000-0000-0000-000000000000') AS ok \gset b6m_
INSERT INTO test_results VALUES ('B6.15 stale-token heartbeat rejected', :'b6m_ok' = 'f');
-- Lease expiry -> reclaimable by another worker.
UPDATE message_deletion_attempts SET claim_expires_at = now() - interval '1 minute' WHERE id=:'b6i_aid';
SELECT (claim_specific_deletion_attempt(:'b6i_aid','wC')->>'claimed') AS c \gset b6n_
INSERT INTO test_results VALUES ('B6.16 expired lease reclaimable by another worker', :'b6n_c' = 'true');

-- Retry limit + dead-letter exclusion + manual retry.
UPDATE message_deletion_attempts SET retry_count=8, claim_token=NULL, claim_expires_at=NULL, next_retry_at=now()
  WHERE id=:'b6i_aid';
SELECT (claim_specific_deletion_attempt(:'b6i_aid','wD')->>'claimed') AS c \gset b6o_
INSERT INTO test_results VALUES ('B6.17 retry-limit-exceeded attempt not claimable', :'b6o_c' = 'false');
UPDATE message_deletion_attempts SET retry_count=0, requires_manual_reconciliation=true, dead_lettered_at=now()
  WHERE id=:'b6i_aid';
SELECT (claim_specific_deletion_attempt(:'b6i_aid','wE')->>'claimed') AS c \gset b6p_
INSERT INTO test_results VALUES ('B6.18 dead-lettered attempt excluded from claim', :'b6p_c' = 'false');
SELECT (admin_manual_retry_deletion(:'b6i_aid','ops')->>'ok') AS ok \gset b6q_
SELECT (claim_specific_deletion_attempt(:'b6i_aid','wF')->>'claimed') AS c \gset b6r_
INSERT INTO test_results VALUES ('B6.19 manual retry re-enables claim', :'b6q_ok'='true' AND :'b6r_c'='true');

-- ════════════════════════════════════════════════════════════════════════════
-- BLOCKER 7 — no existence/deletion oracles; internal helpers not client-callable.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO test_results VALUES ('B7.1 authenticated cannot EXECUTE is_deleted_message',
  NOT has_function_privilege('authenticated','is_deleted_message(uuid)','EXECUTE'));
INSERT INTO test_results VALUES ('B7.2 authenticated cannot EXECUTE message_conversation_id',
  NOT has_function_privilege('authenticated','message_conversation_id(uuid)','EXECUTE'));
INSERT INTO test_results VALUES ('B7.3 authenticated cannot EXECUTE is_deleted_attachment',
  NOT has_function_privilege('authenticated','is_deleted_attachment(text,text)','EXECUTE'));
INSERT INTO test_results VALUES ('B7.4 authenticated cannot EXECUTE is_deleted_poll',
  NOT has_function_privilege('authenticated','is_deleted_poll(uuid)','EXECUTE'));
INSERT INTO test_results VALUES ('B7.5 opaque helper can_see_message IS granted to authenticated',
  has_function_privilege('authenticated','can_see_message(uuid)','EXECUTE'));
INSERT INTO test_results VALUES ('B7.6 opaque helper can_see_poll IS granted to authenticated',
  has_function_privilege('authenticated','can_see_poll(uuid)','EXECUTE'));

-- Ordinary authenticated cannot invoke an internal helper directly.
DO $$
DECLARE v_raised text := NULL;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims','{"sub":"e2e2e2e2-0000-4000-8000-000000000002","role":"authenticated"}', true);
  BEGIN PERFORM message_conversation_id('aaaae100-0000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLSTATE; END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('B7.7 authenticated cannot call message_conversation_id directly',
    v_raised = '42501');
END $$;

-- preflight: unauthorized caller cannot distinguish deleted vs nonexistent vs
-- foreign — all raise the same opaque error. m_txt was deleted in B1; e3 is not
-- a participant of cd.
DO $$
DECLARE r_deleted text := NULL; r_missing text := NULL; r_authok text := NULL;
BEGIN
  BEGIN PERFORM preflight_message_deletion('aaaae100-0000-4000-8000-000000000001',
                                           'e3e3e3e3-0000-4000-8000-000000000003');
  EXCEPTION WHEN OTHERS THEN r_deleted := SQLERRM; END;
  BEGIN PERFORM preflight_message_deletion('00000000-0000-0000-0000-0000000000ff',
                                           'e3e3e3e3-0000-4000-8000-000000000003');
  EXCEPTION WHEN OTHERS THEN r_missing := SQLERRM; END;
  INSERT INTO test_results VALUES ('B7.8 unauthorized: deleted message -> opaque error (no oracle)',
    r_deleted = 'not_found_or_not_authorized');
  INSERT INTO test_results VALUES ('B7.9 unauthorized: nonexistent message -> same opaque error',
    r_missing = 'not_found_or_not_authorized' AND r_deleted = r_missing);
END $$;

-- Authorized caller still gets the idempotent already_deleted signal.
SELECT (preflight_message_deletion(:'m_txt', :'e1')->>'status') AS st \gset b710_
INSERT INTO test_results VALUES ('B7.10 authorized caller gets already_deleted (idempotent)',
  :'b710_st' = 'already_deleted');

-- begin_message_deletion authorizes BEFORE the already_deleted short-circuit.
DO $$
DECLARE v_raised text := NULL;
BEGIN
  BEGIN PERFORM begin_message_deletion('aaaae100-0000-4000-8000-000000000001',
          'e3e3e3e3-0000-4000-8000-000000000003', 'edge_function', 'oracle-probe', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM; END;
  INSERT INTO test_results VALUES ('B7.11 begin authorizes before revealing already_deleted',
    v_raised = 'not_found_or_not_authorized');
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- RESULTS
-- ════════════════════════════════════════════════════════════════════════════
\echo ''
\echo '──────────── BLOCKER REGRESSION RESULTS ────────────'
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
    RAISE EXCEPTION '% blocker test(s) FAILED', v_failed;
  END IF;
  RAISE NOTICE 'ALL BLOCKER TESTS PASSED';
END $$;

ROLLBACK;
