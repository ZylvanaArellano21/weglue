-- Day 10F local database/security harness. Run only after a disposable local
-- reset with migrations through 068; never run it against Production.
--
-- docker exec -i supabase_db_weglue psql -U postgres -d postgres \
--   -v ON_ERROR_STOP=1 < supabase/scripts/test_067_deleted_message_privacy.sql

\set ON_ERROR_STOP on
\pset pager off

-- Hosted PostgREST provides verified JWT claims in request.jwt.claims JSON.
-- The service-only predicate must accept only a well-formed service_role
-- claim, independently of the caller's request body or RPC arguments.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false);
  IF NOT private.is_service_role_request() THEN
    RAISE EXCEPTION 'hosted service-role JSON claims were rejected';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', false);
  IF private.is_service_role_request() THEN
    RAISE EXCEPTION 'ordinary authenticated JSON claims passed the service gate';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', false);
  IF private.is_service_role_request() THEN
    RAISE EXCEPTION 'anonymous JSON claims passed the service gate';
  END IF;

  PERFORM set_config('request.jwt.claims', '', false);
  IF private.is_service_role_request() THEN
    RAISE EXCEPTION 'missing JSON claims passed the service gate';
  END IF;

  PERFORM set_config('request.jwt.claims', '{malformed', false);
  IF private.is_service_role_request() THEN
    RAISE EXCEPTION 'malformed JSON claims passed the service gate';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"role":"platform_admin"}', false);
  IF private.is_service_role_request() THEN
    RAISE EXCEPTION 'unexpected JSON role passed the service gate';
  END IF;
END;
$$;

-- ── Schema, privilege, policy, and opaque-Realtime shape ───────────────────

DO $$
DECLARE
  v_policy text;
  v_fn text;
  v_rls boolean;
  v_force boolean;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'message_deletion_operations', 'message_attachment_cleanup_jobs',
    'report_message_evidence', 'report_evidence_holds', 'report_evidence_appeals'
  ] LOOP
    SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'private' AND c.relname = v_fn;
    IF NOT v_rls OR NOT v_force THEN
      RAISE EXCEPTION 'private.% must enable and force RLS', v_fn;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'private.message_deletion_operations', 'SELECT')
     OR has_table_privilege('authenticated', 'private.message_attachment_cleanup_jobs', 'SELECT')
     OR has_table_privilege('authenticated', 'private.report_message_evidence', 'SELECT')
     OR has_function_privilege('authenticated', 'private.message_is_active_for_policy(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.begin_message_deletion(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_message_attachment_cleanup_jobs(text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_expired_report_message_evidence(text,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_record_report_evidence_view(uuid,text,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_record_report_evidence_view(uuid,text,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_tx_apply_report_evidence_hold(uuid,text,text,uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_tx_release_report_evidence_hold(uuid,text,text,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_tx_set_report_evidence_appeal(uuid,text,text,uuid,uuid,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Day 10F private-table or service-only grants are too broad';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.begin_message_deletion(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_message_attachment_cleanup_jobs(text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_expired_report_message_evidence(text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_tx_apply_report_evidence_hold(uuid,text,text,uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_tx_release_report_evidence_hold(uuid,text,text,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_tx_set_report_evidence_appeal(uuid,text,text,uuid,uuid,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Day 10F required least-privilege grants are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'messages' AND p.polcmd = 'w') THEN
    RAISE EXCEPTION 'students must not retain a direct message UPDATE policy';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-attachments' AND public = false)
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'deleted-message-evidence' AND public = false) THEN
    RAISE EXCEPTION 'chat and retained-evidence buckets must be private';
  END IF;
  SELECT qual INTO v_policy FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'chat-attachments: active message participants can read';
  IF v_policy IS NULL OR position('active_chat_attachment_readable' IN v_policy) = 0 THEN
    RAISE EXCEPTION 'chat attachment read policy is not bound to active messages';
  END IF;
  SELECT with_check INTO v_policy FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'messages'
     AND policyname = 'messages: sender-owned chat attachment';
  IF v_policy IS NULL OR position('chat_attachment_available_to_sender' IN v_policy) = 0 THEN
    RAISE EXCEPTION 'message attachment paths are not bound to uploader ownership';
  END IF;

  SELECT pg_get_functiondef('private.broadcast_message_sync()'::regprocedure) INTO v_fn;
  IF position('realtime.send(''{}''::jsonb' IN v_fn) = 0
     OR v_fn ~* 'jsonb_build_object|to_jsonb\(new\)|row_to_json\(new\)' THEN
    RAISE EXCEPTION 'message Realtime payload must remain opaque';
  END IF;
  SELECT pg_get_functiondef('public.report_message(uuid,text,text)'::regprocedure) INTO v_fn;
  IF position('FOR UPDATE OF m' IN v_fn) = 0 THEN
    RAISE EXCEPTION 'report evidence capture must lock the active message against deletion races';
  END IF;
  SELECT qual INTO v_policy FROM pg_policies
   WHERE schemaname = 'realtime' AND tablename = 'messages'
     AND policyname = 'weglue_receive_message_sync';
  IF v_policy IS NULL OR position('extension = ''broadcast''' IN v_policy) = 0
     OR position('can_receive_message_sync' IN v_policy) = 0 THEN
    RAISE EXCEPTION 'message deletion Realtime receive policy is not private broadcast-only';
  END IF;
END;
$$;

-- ── Sender deletion, direct-ID/RLS, evidence, attachment leases, and purge ─

BEGIN;

INSERT INTO public.universities (id, name, slug) VALUES
  ('a6700000-0000-4000-8000-0000000000a1', 'Day 10F University', 'day-10f-university');
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('a6700000-0000-4000-8000-000000000001', 'day10f-sender@test.invalid', '{}'::jsonb),
  ('a6700000-0000-4000-8000-000000000002', 'day10f-recipient@test.invalid', '{}'::jsonb),
  ('a6700000-0000-4000-8000-000000000003', 'day10f-outsider@test.invalid', '{}'::jsonb),
  ('a6700000-0000-4000-8000-000000000004', 'day10f-founder@test.invalid', '{}'::jsonb);
INSERT INTO public.profiles (id, username, full_name, university_id) VALUES
  ('a6700000-0000-4000-8000-000000000001', 'day10fsender', 'Day 10F Sender', 'a6700000-0000-4000-8000-0000000000a1'),
  ('a6700000-0000-4000-8000-000000000002', 'day10frecipient', 'Day 10F Recipient', 'a6700000-0000-4000-8000-0000000000a1'),
  ('a6700000-0000-4000-8000-000000000003', 'day10foutsider', 'Day 10F Outsider', 'a6700000-0000-4000-8000-0000000000a1'),
  ('a6700000-0000-4000-8000-000000000004', 'day10ffounder', 'Day 10F Founder', 'a6700000-0000-4000-8000-0000000000a1')
ON CONFLICT (id) DO UPDATE
  SET username = EXCLUDED.username,
      full_name = EXCLUDED.full_name,
      university_id = EXCLUDED.university_id;
INSERT INTO public.conversations (id, type, created_by) VALUES
  ('a6700000-0000-4000-8000-0000000000c1', 'direct', 'a6700000-0000-4000-8000-000000000001'),
  ('a6700000-0000-4000-8000-0000000000c2', 'group', 'a6700000-0000-4000-8000-000000000002');
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  ('a6700000-0000-4000-8000-0000000000c1', 'a6700000-0000-4000-8000-000000000001'),
  ('a6700000-0000-4000-8000-0000000000c1', 'a6700000-0000-4000-8000-000000000002'),
  ('a6700000-0000-4000-8000-0000000000c2', 'a6700000-0000-4000-8000-000000000001'),
  ('a6700000-0000-4000-8000-0000000000c2', 'a6700000-0000-4000-8000-000000000002');
INSERT INTO public.messages (id, conversation_id, sender_id, content, message_type, attachment_url, attachment_name, attachment_size, attachment_mime) VALUES
  ('a6700000-0000-4000-8000-0000000000b1', 'a6700000-0000-4000-8000-0000000000c1', 'a6700000-0000-4000-8000-000000000001', 'DAY10F DELETE ME', 'text', 'a6700000-0000-4000-8000-000000000001/delete-me.jpg', 'delete-me.jpg', 12, 'image/jpeg'),
  ('a6700000-0000-4000-8000-0000000000b2', 'a6700000-0000-4000-8000-0000000000c1', 'a6700000-0000-4000-8000-000000000001', 'DAY10F REPORT EVIDENCE', 'text', 'a6700000-0000-4000-8000-000000000001/evidence.jpg', 'evidence.jpg', 24, 'image/jpeg'),
  ('a6700000-0000-4000-8000-0000000000b3', 'a6700000-0000-4000-8000-0000000000c1', 'a6700000-0000-4000-8000-000000000001', 'DAY10F RECONCILIATION', 'text', 'a6700000-0000-4000-8000-000000000001/retry.jpg', 'retry.jpg', 36, 'image/jpeg'),
  ('a6700000-0000-4000-8000-0000000000b4', 'a6700000-0000-4000-8000-0000000000c2', 'a6700000-0000-4000-8000-000000000001', 'DAY10F GROUP MODERATION', 'text', NULL, NULL, NULL, NULL),
  ('a6700000-0000-4000-8000-0000000000b5', 'a6700000-0000-4000-8000-0000000000c1', 'a6700000-0000-4000-8000-000000000001', 'DAY10F RESTRICTED OWNER DELETE', 'text', NULL, NULL, NULL, NULL),
  ('a6700000-0000-4000-8000-0000000000b6', 'a6700000-0000-4000-8000-0000000000c2', 'a6700000-0000-4000-8000-000000000002', 'DAY10F RESTRICTED ACTOR DENIED', 'text', NULL, NULL, NULL, NULL),
  ('a6700000-0000-4000-8000-0000000000b7', 'a6700000-0000-4000-8000-0000000000c1', 'a6700000-0000-4000-8000-000000000001', 'DAY10F DELETION PENDING OWNER DELETE', 'text', NULL, NULL, NULL, NULL),
  ('a6700000-0000-4000-8000-0000000000b8', 'a6700000-0000-4000-8000-0000000000c1', 'a6700000-0000-4000-8000-000000000001', 'DAY10F ENFORCEMENT EVIDENCE', 'text', NULL, NULL, NULL, NULL);
INSERT INTO public.push_queue (id, user_id, category, title, body, route, dedupe_key, source_message_id)
VALUES ('a6700000-0000-4000-8000-0000000000e1', 'a6700000-0000-4000-8000-000000000002', 'messages', 'Sender', 'DAY10F DELETE ME', '{"screen":"chat","messageId":"a6700000-0000-4000-8000-0000000000b1"}'::jsonb, 'day10f-push-m1', 'a6700000-0000-4000-8000-0000000000b1');
INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES
  ('chat-attachments', 'a6700000-0000-4000-8000-0000000000c1/sender-owned.jpg', 'a6700000-0000-4000-8000-000000000001', '{}'::jsonb),
  ('chat-attachments', 'a6700000-0000-4000-8000-0000000000c1/recipient-owned.jpg', 'a6700000-0000-4000-8000-000000000002', '{}'::jsonb);

-- Supabase REST grants these relation reads to the authenticated API role in
-- production. Make that explicit inside this rolled-back fixture so the RLS
-- assertions exercise policy visibility rather than bare SQL table grants.
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT SELECT ON public.conversations, public.conversation_participants, public.reports TO authenticated;
GRANT SELECT ON public.reports TO service_role;

-- Service-only lease RPCs must reject both regular and anonymous callers even
-- when they supply arbitrary request claims or message identifiers.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'a6700000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, false);
DO $$
BEGIN
  BEGIN
    PERFORM public.claim_message_attachment_cleanup_for_message('forged-worker', 'a6700000-0000-4000-8000-0000000000b1');
    RAISE EXCEPTION 'authenticated caller invoked service-only cleanup claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claims', json_build_object('role', 'anon')::text, false);
DO $$
BEGIN
  BEGIN
    PERFORM public.claim_message_attachment_cleanup_for_message('forged-worker', 'a6700000-0000-4000-8000-0000000000b1');
    RAISE EXCEPTION 'anonymous caller invoked service-only cleanup claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'a6700000-0000-4000-8000-000000000003')::text, false);
DO $$
BEGIN
  IF private.active_chat_attachment_readable('a6700000-0000-4000-8000-000000000001/delete-me.jpg') THEN
    RAISE EXCEPTION 'outsider may not read another conversation attachment';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claims', json_build_object('sub', 'a6700000-0000-4000-8000-000000000002')::text, false);
DO $$
DECLARE v_moderated jsonb;
BEGIN
  IF NOT private.active_chat_attachment_readable('a6700000-0000-4000-8000-000000000001/delete-me.jpg') THEN
    RAISE EXCEPTION 'participant could not read an active attachment';
  END IF;
  BEGIN
    PERFORM public.begin_message_deletion('a6700000-0000-4000-8000-0000000000b1', 'a6700000-0000-4000-8000-0000000000d1');
    RAISE EXCEPTION 'recipient deleted another sender message';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF public.begin_message_deletion('a6700000-0000-4000-8000-0000000000ff', 'a6700000-0000-4000-8000-0000000000d5')->>'state' <> 'unavailable' THEN
    RAISE EXCEPTION 'missing message did not return an opaque unavailable state';
  END IF;
  PERFORM public.report_message('a6700000-0000-4000-8000-0000000000b2', 'harassment', 'Day 10F evidence before deletion');
  PERFORM public.report_message('a6700000-0000-4000-8000-0000000000b8', 'harassment', 'Day 10F enforcement evidence before deletion');
  v_moderated := public.begin_message_deletion('a6700000-0000-4000-8000-0000000000b4', 'a6700000-0000-4000-8000-0000000000d4');
  IF v_moderated->>'state' <> 'deleted' THEN RAISE EXCEPTION 'authorized group moderation failed'; END IF;
END;
$$;

SELECT set_config('request.jwt.claims', json_build_object('sub', 'a6700000-0000-4000-8000-000000000001')::text, false);
DO $$
DECLARE v_first jsonb; v_second jsonb;
BEGIN
  INSERT INTO public.messages (
    id, conversation_id, sender_id, content, message_type, attachment_url,
    attachment_name, attachment_size, attachment_mime
  ) VALUES (
    'a6700000-0000-4000-8000-0000000000bc', 'a6700000-0000-4000-8000-0000000000c1',
    'a6700000-0000-4000-8000-000000000001', 'DAY10F OWNED ATTACHMENT', 'text',
    'a6700000-0000-4000-8000-0000000000c1/sender-owned.jpg', 'sender-owned.jpg', 1, 'image/jpeg'
  );
  BEGIN
    INSERT INTO public.messages (
      id, conversation_id, sender_id, content, message_type, attachment_url,
      attachment_name, attachment_size, attachment_mime
    ) VALUES (
      'a6700000-0000-4000-8000-0000000000bd', 'a6700000-0000-4000-8000-0000000000c1',
      'a6700000-0000-4000-8000-000000000001', 'DAY10F STOLEN ATTACHMENT', 'text',
      'a6700000-0000-4000-8000-0000000000c1/recipient-owned.jpg', 'recipient-owned.jpg', 1, 'image/jpeg'
    );
    RAISE EXCEPTION 'sender bound another participant''s attachment object';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  v_first := public.begin_message_deletion('a6700000-0000-4000-8000-0000000000b1', 'a6700000-0000-4000-8000-0000000000d1');
  v_second := public.begin_message_deletion('a6700000-0000-4000-8000-0000000000b1', 'a6700000-0000-4000-8000-0000000000d1');
  IF v_first->>'state' <> 'deletion_pending_attachment_cleanup' OR v_second->>'state' <> 'already_deleted' THEN
    RAISE EXCEPTION 'sender deletion is not immediate and idempotent';
  END IF;
  UPDATE public.messages
     SET deleted_at = NULL, deletion_kind = 'active', content = 'attempted restore'
   WHERE id = 'a6700000-0000-4000-8000-0000000000b1';
  IF FOUND THEN RAISE EXCEPTION 'sender restored a deleted message through direct UPDATE'; END IF;
  PERFORM public.begin_message_deletion('a6700000-0000-4000-8000-0000000000b2', 'a6700000-0000-4000-8000-0000000000d2');
  PERFORM public.begin_message_deletion('a6700000-0000-4000-8000-0000000000b3', 'a6700000-0000-4000-8000-0000000000d3');
  PERFORM public.begin_message_deletion('a6700000-0000-4000-8000-0000000000b8', 'a6700000-0000-4000-8000-0000000000d6');
END;
$$;

-- A service-role database principal without verified PostgREST claims cannot
-- claim the job. The immediate deletion remains scrubbed and the canonical
-- job stays pending for a later authenticated reconciliation attempt.
RESET ROLE;
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '', false);
DO $$
BEGIN
  BEGIN
    PERFORM public.claim_message_attachment_cleanup_for_message(
      'unverified-delete-message',
      'a6700000-0000-4000-8000-0000000000b1'
    );
    RAISE EXCEPTION 'unverified cleanup claimant obtained a lease';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false);
  IF NOT EXISTS (
    SELECT 1
      FROM private.message_attachment_cleanup_jobs j
      JOIN private.message_deletion_operations o ON o.id = j.operation_id
     WHERE o.message_id = 'a6700000-0000-4000-8000-0000000000b1'
       AND j.state = 'pending'
       AND j.claim_token IS NULL
       AND o.reconciliation_state = 'pending_attachment_cleanup'
  ) THEN
    RAISE EXCEPTION 'failed cleanup claim did not leave the job safely retryable';
  END IF;
END;
$$;
RESET ROLE;

-- A participant cannot recover deleted content by a direct ID, a cache-like
-- database query, a second report, or a remembered attachment path.
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'a6700000-0000-4000-8000-000000000002')::text, false);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.messages WHERE id IN ('a6700000-0000-4000-8000-0000000000b1', 'a6700000-0000-4000-8000-0000000000b2')) THEN
    RAISE EXCEPTION 'deleted message was returned by direct-ID read';
  END IF;
  IF private.active_chat_attachment_readable('a6700000-0000-4000-8000-000000000001/delete-me.jpg') THEN
    RAISE EXCEPTION 'remembered deleted attachment path remains readable';
  END IF;
  BEGIN
    PERFORM public.report_message('a6700000-0000-4000-8000-0000000000b2', 'harassment', NULL);
    RAISE EXCEPTION 'report evidence was created after deletion';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    EXECUTE 'SELECT count(*) FROM private.report_message_evidence';
    RAISE EXCEPTION 'authenticated student read retained evidence';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

-- Privacy-reducing self-deletion remains available in both restricted and
-- deletion-pending shells; neither state grants a moderation path over another
-- sender's message.
INSERT INTO public.account_restrictions (
  user_id, restriction_type, status, internal_reason, created_by, correlation_id
) VALUES (
  'a6700000-0000-4000-8000-000000000001', 'suspended', 'active',
  'Day 10F restricted deletion test.', 'a6700000-0000-4000-8000-000000000004',
  'a6700000-0000-4000-8000-0000000000b8'
);
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'a6700000-0000-4000-8000-000000000001')::text, false);
DO $$
BEGIN
  IF public.begin_message_deletion('a6700000-0000-4000-8000-0000000000b5', 'a6700000-0000-4000-8000-0000000000b9')->>'state' <> 'deleted' THEN
    RAISE EXCEPTION 'restricted sender could not delete own message';
  END IF;
  BEGIN
    PERFORM public.begin_message_deletion('a6700000-0000-4000-8000-0000000000b6', 'a6700000-0000-4000-8000-0000000000ba');
    RAISE EXCEPTION 'restricted actor deleted another sender message';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;
INSERT INTO public.account_deletion_cases (
  user_id, mode, state, scheduled_deletion_at, appeal_deadline, violation_category,
  public_reason, internal_reason, basis, evidence_references, created_by, correlation_id
) VALUES (
  'a6700000-0000-4000-8000-000000000001', 'scheduled', 'pending', now() + interval '7 days', now() + interval '7 days',
  'privacy_violation', 'A valid test deletion-pending notice.', 'Day 10F deletion-pending privacy test.',
  'administrator_observation', 'Day10F fixture', 'a6700000-0000-4000-8000-000000000004',
  'a6700000-0000-4000-8000-0000000000bb'
);
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', 'a6700000-0000-4000-8000-000000000001')::text, false);
DO $$
BEGIN
  IF public.current_student_can_access_app() THEN RAISE EXCEPTION 'fixture is not deletion pending'; END IF;
  IF public.begin_message_deletion('a6700000-0000-4000-8000-0000000000b7', 'a6700000-0000-4000-8000-0000000000bc')->>'state' <> 'deleted' THEN
    RAISE EXCEPTION 'deletion-pending sender could not delete own message';
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.messages
     WHERE id IN ('a6700000-0000-4000-8000-0000000000b1', 'a6700000-0000-4000-8000-0000000000b2', 'a6700000-0000-4000-8000-0000000000b3', 'a6700000-0000-4000-8000-0000000000b4', 'a6700000-0000-4000-8000-0000000000b5', 'a6700000-0000-4000-8000-0000000000b7', 'a6700000-0000-4000-8000-0000000000b8')
       AND (content IS NOT NULL OR attachment_url IS NOT NULL OR attachment_name IS NOT NULL OR attachment_size IS NOT NULL OR attachment_mime IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'ordinary deleted message content or attachment reference was not scrubbed';
  END IF;
  IF (SELECT body FROM public.push_queue WHERE id = 'a6700000-0000-4000-8000-0000000000e1') IS NOT NULL
     OR (SELECT status FROM public.push_queue WHERE id = 'a6700000-0000-4000-8000-0000000000e1') <> 'suppressed'
     OR (SELECT route FROM public.push_queue WHERE id = 'a6700000-0000-4000-8000-0000000000e1') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'queued deleted-message notification was not suppressed and scrubbed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.reports WHERE message_id = 'a6700000-0000-4000-8000-0000000000b2' AND (content_snapshot IS NOT NULL OR attachment_snapshot IS NOT NULL)) THEN
    RAISE EXCEPTION 'ordinary report row retained private message evidence';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.report_message_evidence WHERE source_message_id = 'a6700000-0000-4000-8000-0000000000b2' AND content_snapshot = 'DAY10F REPORT EVIDENCE') THEN
    RAISE EXCEPTION 'pre-deletion report evidence was not retained privately';
  END IF;
  IF (SELECT deletion_kind FROM public.messages WHERE id = 'a6700000-0000-4000-8000-0000000000b4') <> 'group_admin_removed'
     OR (SELECT action_type FROM private.message_deletion_operations WHERE message_id = 'a6700000-0000-4000-8000-0000000000b4') <> 'group_admin_moderation' THEN
    RAISE EXCEPTION 'authorized group moderation was not distinct from sender deletion';
  END IF;
END;
$$;

-- Enforcement outcomes retain the same pre-captured evidence for 180 days.
UPDATE public.reports SET status = 'resolved' WHERE message_id = 'a6700000-0000-4000-8000-0000000000b8';
INSERT INTO public.report_decision_history (
  report_id, sequence_no, previous_status, new_status, resolution_outcome,
  internal_decision_note, public_category, public_explanation,
  enforcement_action, enforcement_target_type, enforcement_target_id, enforcement_status,
  notification_status, actor_user_id, actor_email, correlation_id
)
SELECT id, 1, 'pending', 'resolved', 'content_violation',
       'Day 10F enforcement retention test.', 'privacy_violation', 'A valid public enforcement explanation.',
       'schedule_deletion', 'user', 'a6700000-0000-4000-8000-000000000001', 'applied',
       'pending', 'a6700000-0000-4000-8000-000000000004', 'day10f-founder@test.invalid', 'a6700000-0000-4000-8000-0000000000d7'
  FROM public.reports WHERE message_id = 'a6700000-0000-4000-8000-0000000000b8';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.report_message_evidence WHERE source_message_id = 'a6700000-0000-4000-8000-0000000000b8' AND retention_basis = 'enforcement_180_days' AND retention_expires_at > now() + interval '179 days') THEN
    RAISE EXCEPTION 'enforcement evidence retention is not 180 days';
  END IF;
END;
$$;

-- The service worker lease does the only physical-storage reconciliation. The
-- harness records successful object work through its completion RPC; it never
-- treats a failed object removal as success.
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.claim_message_attachment_cleanup_for_message('day10f-harness', 'a6700000-0000-4000-8000-0000000000b1');
  IF v.job_id IS NULL THEN RAISE EXCEPTION 'missing attachment cleanup lease for sender deletion'; END IF;
  PERFORM public.complete_message_attachment_cleanup(v.job_id, v.claim_token, NULL);

  SELECT * INTO v FROM public.claim_message_attachment_cleanup_for_message('day10f-harness', 'a6700000-0000-4000-8000-0000000000b2');
  IF v.job_id IS NULL OR NOT v.requires_evidence_copy THEN RAISE EXCEPTION 'report-evidence attachment was not safely leased for copy'; END IF;
  PERFORM public.complete_message_attachment_cleanup(v.job_id, v.claim_token, 'report-evidence/day10f/m2-evidence.jpg');

  SELECT * INTO v FROM public.claim_message_attachment_cleanup_for_message('day10f-harness', 'a6700000-0000-4000-8000-0000000000b3');
  IF v.job_id IS NULL THEN RAISE EXCEPTION 'missing attachment cleanup lease for reconciliation test'; END IF;
  PERFORM public.fail_message_attachment_cleanup(v.job_id, v.claim_token, 'storage_delete_failed', false);
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.report_message_evidence WHERE source_message_id = 'a6700000-0000-4000-8000-0000000000b2' AND (source_attachment_path IS NOT NULL OR retained_attachment_path <> 'report-evidence/day10f/m2-evidence.jpg' OR attachment_state <> 'retained')) THEN
    RAISE EXCEPTION 'retained evidence attachment copy state is incorrect';
  END IF;
  IF (SELECT reconciliation_state FROM private.message_deletion_operations WHERE message_id = 'a6700000-0000-4000-8000-0000000000b3') <> 'reconciliation_required' THEN
    RAISE EXCEPTION 'storage failure did not require reconciliation';
  END IF;
END;
$$;

-- Terminal no-enforcement decisions retain evidence for 30 days. Active
-- appeals defer purge; final appeal resolution restarts a 90-day window.
UPDATE public.reports SET status = 'dismissed' WHERE message_id = 'a6700000-0000-4000-8000-0000000000b2';
INSERT INTO public.report_decision_history (
  report_id, sequence_no, previous_status, new_status, resolution_outcome,
  internal_decision_note, enforcement_action, enforcement_status,
  notification_status, actor_user_id, actor_email, correlation_id
)
SELECT id, 1, 'pending', 'dismissed', 'duplicate_or_invalid',
       'Day 10F terminal retention test.', 'none', 'not_requested',
       'not_required', 'a6700000-0000-4000-8000-000000000004', 'day10f-founder@test.invalid', 'a6700000-0000-4000-8000-0000000000aa'
  FROM public.reports WHERE message_id = 'a6700000-0000-4000-8000-0000000000b2';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.report_message_evidence WHERE source_message_id = 'a6700000-0000-4000-8000-0000000000b2' AND retention_basis = 'terminal_30_days' AND retention_expires_at > now() + interval '29 days') THEN
    RAISE EXCEPTION 'terminal non-enforcement evidence retention is not 30 days';
  END IF;
END;
$$;

-- A deliberately failing audit trigger proves the hold mutation is rolled back
-- when its required durable audit event cannot be written.
CREATE FUNCTION private.day10f_force_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'day10f forced audit failure'; END; $$;
CREATE TRIGGER trg_day10f_force_audit_failure BEFORE INSERT ON public.admin_audit_events FOR EACH ROW EXECUTE FUNCTION private.day10f_force_audit_failure();
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$
DECLARE v_report uuid;
BEGIN
  SELECT id INTO v_report FROM public.reports WHERE message_id = 'a6700000-0000-4000-8000-0000000000b2';
  BEGIN
    PERFORM public.admin_tx_apply_report_evidence_hold('a6700000-0000-4000-8000-000000000004', 'day10f-founder@test.invalid', 'Audit must succeed before hold commits.', 'a6700000-0000-4000-8000-0000000000ab', v_report, 'legal');
    RAISE EXCEPTION 'hold committed despite audit failure';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'day10f forced audit failure' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;
DROP TRIGGER trg_day10f_force_audit_failure ON public.admin_audit_events;
DROP FUNCTION private.day10f_force_audit_failure();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.report_evidence_holds h JOIN public.reports r ON r.id = h.report_id WHERE r.message_id = 'a6700000-0000-4000-8000-0000000000b2') THEN
    RAISE EXCEPTION 'hold survived an audit failure';
  END IF;
END;
$$;

SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$
DECLARE v_report uuid; v_appeal uuid;
BEGIN
  SELECT id INTO v_report FROM public.reports WHERE message_id = 'a6700000-0000-4000-8000-0000000000b2';
  v_appeal := public.admin_tx_set_report_evidence_appeal('a6700000-0000-4000-8000-000000000004', 'day10f-founder@test.invalid', 'Appeal is active.', 'a6700000-0000-4000-8000-0000000000ac', v_report, 'active');
  IF v_appeal IS NULL OR NOT EXISTS (SELECT 1 FROM private.report_message_evidence WHERE report_id = v_report AND retention_basis = 'appeal_active' AND retention_expires_at IS NULL) THEN
    RAISE EXCEPTION 'active appeal did not defer evidence purge';
  END IF;
  v_appeal := public.admin_tx_set_report_evidence_appeal('a6700000-0000-4000-8000-000000000004', 'day10f-founder@test.invalid', 'Appeal is finally resolved.', 'a6700000-0000-4000-8000-0000000000ad', v_report, 'resolved');
  IF v_appeal IS NULL OR NOT EXISTS (SELECT 1 FROM private.report_message_evidence WHERE report_id = v_report AND retention_basis = 'appeal_90_days' AND retention_expires_at > now() + interval '89 days') THEN
    RAISE EXCEPTION 'resolved appeal did not start 90-day retention';
  END IF;
END;
$$;
RESET ROLE;

UPDATE private.report_message_evidence
   SET retention_expires_at = now() - interval '1 minute', retention_basis = 'appeal_90_days'
 WHERE source_message_id = 'a6700000-0000-4000-8000-0000000000b2';

SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$
DECLARE v_report uuid; v_hold uuid; v record;
BEGIN
  SELECT id INTO v_report FROM public.reports WHERE message_id = 'a6700000-0000-4000-8000-0000000000b2';
  v_hold := public.admin_tx_apply_report_evidence_hold('a6700000-0000-4000-8000-000000000004', 'day10f-founder@test.invalid', 'Legal preservation hold.', 'a6700000-0000-4000-8000-0000000000ae', v_report, 'legal');
  IF EXISTS (SELECT 1 FROM public.claim_expired_report_message_evidence('day10f-harness', 10)) THEN
    RAISE EXCEPTION 'active legal/safety hold did not block purge claim';
  END IF;
  PERFORM public.admin_tx_release_report_evidence_hold('a6700000-0000-4000-8000-000000000004', 'day10f-founder@test.invalid', 'Hold is explicitly released.', 'a6700000-0000-4000-8000-0000000000af', v_hold);
  SELECT * INTO v FROM public.claim_expired_report_message_evidence('day10f-harness', 10);
  IF v.evidence_id IS NULL OR v.retained_bucket <> 'deleted-message-evidence' OR v.retained_object_path <> 'report-evidence/day10f/m2-evidence.jpg' THEN
    RAISE EXCEPTION 'expired evidence was not safely leased with its retained object';
  END IF;
  PERFORM public.complete_report_message_evidence_purge(v.evidence_id, v.claim_token);

END;
$$;
RESET ROLE;

UPDATE private.message_deletion_operations
   SET purge_after = now() - interval '1 minute'
 WHERE message_id IN ('a6700000-0000-4000-8000-0000000000b1', 'a6700000-0000-4000-8000-0000000000b2', 'a6700000-0000-4000-8000-0000000000b3');
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT public.purge_expired_message_deletion_metadata(100);
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.messages WHERE id IN ('a6700000-0000-4000-8000-0000000000b1', 'a6700000-0000-4000-8000-0000000000b2'))
     OR EXISTS (SELECT 1 FROM private.message_deletion_operations WHERE message_id IN ('a6700000-0000-4000-8000-0000000000b1', 'a6700000-0000-4000-8000-0000000000b2')) THEN
    RAISE EXCEPTION 'expired reconciled deleted-message metadata was not irreversibly purged';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE id = 'a6700000-0000-4000-8000-0000000000b3')
     OR NOT EXISTS (SELECT 1 FROM private.message_deletion_operations WHERE message_id = 'a6700000-0000-4000-8000-0000000000b3' AND reconciliation_state = 'reconciliation_required') THEN
    RAISE EXCEPTION 'reconciliation-required deletion was purged or hidden as success';
  END IF;
END;
$$;

ROLLBACK;

SELECT '067 deleted-message privacy database/security harness passed' AS result;
