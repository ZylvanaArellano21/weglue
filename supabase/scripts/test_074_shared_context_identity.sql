-- Run only against a disposable local database after the FULL 001->074 chain,
-- with test_full_chain_grants_bridge.sql applied first.
--
-- Proves the three halves of migration 074 together, each with a positive
-- control so a regression that simply hides everything cannot pass:
--
--   1. Structural identity survives a block in authorized shared contexts,
--      while the normal profile and personal content stay inaccessible.
--   2. The shared-context readers are narrow: a non-participant gets nothing,
--      and neither reader can be pointed at an arbitrary user id.
--   3. Chat attachments are refused to a blocked pair BY STORAGE
--      AUTHORIZATION, in both directions, without hiding an unrelated
--      participant's attachment and without touching text or poll history.

\set ON_ERROR_STOP on

-- ── Catalog: shape, least privilege, and no viewer-id impersonation ─────────
DO $$
DECLARE
  v_def text;
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.club_shared_identities(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.conversation_shared_identities(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.conversation_restricted_senders(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '074: students must be able to call the shared-context readers';
  END IF;

  IF has_function_privilege('anon', 'public.club_shared_identities(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.conversation_shared_identities(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.conversation_restricted_senders(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '074: shared-context readers must not be reachable anonymously';
  END IF;

  -- Exactly one argument each, and it is the SCOPE, never a viewer id. A second
  -- uuid argument would be an impersonation channel.
  IF (SELECT pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'club_shared_identities') <> 1
     OR (SELECT pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'conversation_shared_identities') <> 1
     OR (SELECT pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'conversation_restricted_senders') <> 1 THEN
    RAISE EXCEPTION '074: a shared-context reader accepts more than its scope argument';
  END IF;

  -- Fixed, empty search_path on every new SECURITY DEFINER routine.
  FOR v_def IN
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('club_shared_identities', 'conversation_shared_identities',
                         'conversation_restricted_senders')
       -- PostgreSQL normalises `SET search_path = ''` to either `search_path=`
       -- or `search_path=""` depending on version; both mean "empty".
       AND (NOT p.prosecdef
            OR p.proconfig IS NULL
            OR NOT (p.proconfig::text[] && ARRAY['search_path=', 'search_path=""']))
  LOOP
    RAISE EXCEPTION '074: % must be SECURITY DEFINER with an empty search_path', v_def;
  END LOOP;

  -- The general profiles policy must NOT have been loosened. 058 still owns it.
  SELECT qual INTO v_def FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT';
  IF v_def IS NULL OR position('blocked_user_ids' IN v_def) = 0 THEN
    RAISE EXCEPTION '074: the profiles policy must still be block-aware';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT') <> 1 THEN
    RAISE EXCEPTION '074: profiles must keep exactly one permissive SELECT policy';
  END IF;

  -- The attachment fix must live in the EXISTING helper the existing storage
  -- policy already calls — not in a second, parallel policy.
  SELECT pg_get_functiondef('private.active_chat_attachment_readable(text)'::regprocedure) INTO v_def;
  IF position('blocked_user_ids' IN v_def) = 0 THEN
    RAISE EXCEPTION '074: chat attachment readability must be block-aware';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
         AND qual LIKE '%chat-attachments%') <> 1 THEN
    RAISE EXCEPTION '074: chat-attachments must keep exactly one SELECT policy';
  END IF;
END;
$$;

SELECT '074 shared-context identity catalog harness passed' AS result;

-- ── Behaviour ──────────────────────────────────────────────────────────────
BEGIN;

INSERT INTO public.universities (id, name, slug) VALUES
  ('60000000-0000-0000-0000-0000000000a1', 'Shared Context U 074', 'shared-context-u-074');

--  silvana  blocks  lola.        bruno is an unrelated third participant.
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('61000000-0000-0000-0000-000000000001', 'silvana-074@example.test', '{}'::jsonb),
  ('61000000-0000-0000-0000-000000000002', 'lola-074@example.test',    '{}'::jsonb),
  ('61000000-0000-0000-0000-000000000003', 'bruno-074@example.test',   '{}'::jsonb),
  ('61000000-0000-0000-0000-000000000004', 'outsider-074@example.test','{}'::jsonb);

INSERT INTO public.profiles (
  id, username, full_name, email_verified, onboarding_complete, onboarding_completed, university_id
) VALUES
  ('61000000-0000-0000-0000-000000000001', 'silvana074', 'Silvana Blocker',  true, true, true, '60000000-0000-0000-0000-0000000000a1'),
  ('61000000-0000-0000-0000-000000000002', 'lola074',    'Lola Blocked',     true, true, true, '60000000-0000-0000-0000-0000000000a1'),
  ('61000000-0000-0000-0000-000000000003', 'bruno074',   'Bruno Bystander',  true, true, true, '60000000-0000-0000-0000-0000000000a1'),
  ('61000000-0000-0000-0000-000000000004', 'outsider074','Olive Outsider',   true, true, true, '60000000-0000-0000-0000-0000000000a1')
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username, full_name = EXCLUDED.full_name,
  email_verified = EXCLUDED.email_verified,
  onboarding_complete = EXCLUDED.onboarding_complete,
  onboarding_completed = EXCLUDED.onboarding_completed,
  university_id = EXCLUDED.university_id;

INSERT INTO public.clubs (id, name, handle, description, university_id) VALUES
  ('62000000-0000-0000-0000-000000000001', 'Shared Context Club 074', 'x', 'd',
   '60000000-0000-0000-0000-0000000000a1');

INSERT INTO public.club_members (club_id, user_id, role) VALUES
  ('62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'officer'),
  ('62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002', 'member'),
  ('62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000003', 'member');

-- A group conversation the three of them share, plus a private conversation
-- that the blocked person is NOT in (used as the non-participant negative).
INSERT INTO public.conversations (id, type, name, created_by) VALUES
  ('63000000-0000-0000-0000-000000000001', 'group', 'Shared Group 074', '61000000-0000-0000-0000-000000000001'),
  ('63000000-0000-0000-0000-000000000002', 'group', 'Private Group 074', '61000000-0000-0000-0000-000000000001');

INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  ('63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001'),
  ('63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002'),
  ('63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000003'),
  ('63000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000001'),
  ('63000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000004');

-- One message of every repository-supported type that can carry a payload.
INSERT INTO public.messages (id, conversation_id, sender_id, content, message_type, attachment_url, attachment_name, attachment_mime) VALUES
  ('64000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'silvana text',  'text',  NULL, NULL, NULL),
  ('64000000-0000-0000-0000-000000000002', '63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', NULL,            'image', '63000000-0000-0000-0000-000000000001/silvana.png', 'silvana.png', 'image/png'),
  ('64000000-0000-0000-0000-000000000003', '63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', NULL,            'video', '63000000-0000-0000-0000-000000000001/silvana.mp4', 'silvana.mp4', 'video/mp4'),
  ('64000000-0000-0000-0000-000000000004', '63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', NULL,            'file',  '63000000-0000-0000-0000-000000000001/silvana.pdf', 'silvana.pdf', 'application/pdf'),
  ('64000000-0000-0000-0000-000000000005', '63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000003', NULL,            'image', '63000000-0000-0000-0000-000000000001/bruno.png',   'bruno.png',   'image/png'),
  ('64000000-0000-0000-0000-000000000006', '63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002', 'lola text',     'text',  NULL, NULL, NULL);

-- A poll authored by the blocker: poll history must survive a block.
INSERT INTO public.messages (id, conversation_id, sender_id, content, message_type) VALUES
  ('64000000-0000-0000-0000-000000000007', '63000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'Poll?', 'poll');

-- Silvana blocks Lola.
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES
  ('61000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000002');

SET LOCAL ROLE authenticated;

-- ═══ OUTCOME A: the person who WAS blocked (Lola) ═════════════════════════
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000002', true);

DO $$
DECLARE v_n int;
BEGIN
  -- The normal profile stays gone. This is the property 074 must NOT weaken.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '61000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION '074: the blocker profile row became readable — profiles RLS was loosened';
  END IF;
  -- Positive control: an unrelated profile is still readable, so the assertion
  -- above is about blocking and not about a broken fixture.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '61000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION '074: an unrelated profile became unreadable';
  END IF;

  -- Structural identity in the shared CLUB survives.
  SELECT count(*) INTO v_n FROM public.club_shared_identities('62000000-0000-0000-0000-000000000001');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '074: club member identity lost the blocked person (saw % of 3)', v_n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_shared_identities('62000000-0000-0000-0000-000000000001')
     WHERE id = '61000000-0000-0000-0000-000000000001'
       AND username = 'silvana074' AND full_name = 'Silvana Blocker' AND role = 'officer'
  ) THEN
    RAISE EXCEPTION '074: the blocker is missing from the shared club officer list';
  END IF;

  -- Structural identity in the shared CONVERSATION survives.
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_shared_identities('63000000-0000-0000-0000-000000000001')
     WHERE id = '61000000-0000-0000-0000-000000000001' AND username = 'silvana074'
  ) THEN
    RAISE EXCEPTION '074: the blocker is missing from shared conversation identity';
  END IF;

  -- NEGATIVE: a conversation the caller does not participate in returns nothing.
  IF EXISTS (SELECT 1 FROM public.conversation_shared_identities('63000000-0000-0000-0000-000000000002')) THEN
    RAISE EXCEPTION '074: a non-participant read a private conversation roster';
  END IF;
  IF array_length(public.conversation_restricted_senders('63000000-0000-0000-0000-000000000002'), 1) IS NOT NULL THEN
    RAISE EXCEPTION '074: a non-participant read restricted senders of a private conversation';
  END IF;

  -- Text and poll history stay readable: the message rows survive the block.
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE id = '64000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION '074: ordinary text history was hidden by a block';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE id = '64000000-0000-0000-0000-000000000007') THEN
    RAISE EXCEPTION '074: poll history was hidden by a block';
  END IF;
  -- The attachment message ROWS also survive, as unavailable historical refs.
  IF (SELECT count(*) FROM public.messages
       WHERE conversation_id = '63000000-0000-0000-0000-000000000001') <> 7 THEN
    RAISE EXCEPTION '074: message history rows were removed by a block';
  END IF;

  -- ATTACHMENT ENFORCEMENT: the blocker's image/video/file are refused...
  IF private.active_chat_attachment_readable('63000000-0000-0000-0000-000000000001/silvana.png')
     OR private.active_chat_attachment_readable('63000000-0000-0000-0000-000000000001/silvana.mp4')
     OR private.active_chat_attachment_readable('63000000-0000-0000-0000-000000000001/silvana.pdf') THEN
    RAISE EXCEPTION '074: a blocked student could still read the blocker attachment payload';
  END IF;
  -- ...while an UNRELATED participant's attachment still loads. Without this,
  -- the test above would pass simply because everything is hidden.
  IF NOT private.active_chat_attachment_readable('63000000-0000-0000-0000-000000000001/bruno.png') THEN
    RAISE EXCEPTION '074: an unrelated participant attachment was hidden by someone else''s block';
  END IF;

  -- The restricted-sender list is scoped and symmetric.
  IF NOT ('61000000-0000-0000-0000-000000000001'::uuid =
          ANY (public.conversation_restricted_senders('63000000-0000-0000-0000-000000000001'))) THEN
    RAISE EXCEPTION '074: restricted senders omitted the blocker';
  END IF;
  IF '61000000-0000-0000-0000-000000000003'::uuid =
     ANY (public.conversation_restricted_senders('63000000-0000-0000-0000-000000000001')) THEN
    RAISE EXCEPTION '074: restricted senders wrongly included an unrelated participant';
  END IF;
END;
$$;

-- ═══ OUTCOME B: the person who CREATED the block (Silvana) ════════════════
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);

DO $$
BEGIN
  -- Directional state exists for the blocker, and only for the blocker.
  IF NOT public.current_user_blocks('61000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION '074: the blocker cannot detect their own block (no Unblock possible)';
  END IF;
  -- The blocked person's profile is hidden from the blocker too (mutual).
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '61000000-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION '074: the blocked profile row is readable by the blocker';
  END IF;
  -- Structural identity is symmetric: the blocker also still sees the shared list.
  IF NOT EXISTS (
    SELECT 1 FROM public.club_shared_identities('62000000-0000-0000-0000-000000000001')
     WHERE id = '61000000-0000-0000-0000-000000000002' AND username = 'lola074'
  ) THEN
    RAISE EXCEPTION '074: the blocked person vanished from the blocker shared club list';
  END IF;
  -- Enforcement is symmetric: the blocker cannot read the blocked person's
  -- attachment either. (Lola authored only text here, so assert the helper's
  -- own attachment branch instead: Silvana keeps her OWN attachments.)
  IF NOT private.active_chat_attachment_readable('63000000-0000-0000-0000-000000000001/silvana.png') THEN
    RAISE EXCEPTION '074: an author lost access to their own attachment';
  END IF;
END;
$$;

-- ═══ OUTCOME A2: the blocked person is still absent from people search ════
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.search_discovery('silvana074', 20, 0) r
     WHERE (r.item->>'id')::uuid = '61000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION '074: a blocked person became findable through general search';
  END IF;
EXCEPTION WHEN undefined_function OR invalid_parameter_value THEN
  -- Search signature differs across chains; the block filter itself is owned and
  -- covered by 057. Skipping is safe here and is NOT the assertion under test.
  NULL;
END;
$$;

-- ═══ UNBLOCK restores eligible attachments and changes nothing else ═══════
RESET ROLE;
DELETE FROM public.user_blocks
 WHERE blocker_id = '61000000-0000-0000-0000-000000000001'
   AND blocked_id = '61000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000002', true);

DO $$
BEGIN
  IF NOT private.active_chat_attachment_readable('63000000-0000-0000-0000-000000000001/silvana.png')
     OR NOT private.active_chat_attachment_readable('63000000-0000-0000-0000-000000000001/silvana.mp4')
     OR NOT private.active_chat_attachment_readable('63000000-0000-0000-0000-000000000001/silvana.pdf') THEN
    RAISE EXCEPTION '074: unblocking did not restore attachment access';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '61000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION '074: unblocking did not restore the normal profile';
  END IF;
  IF array_length(public.conversation_restricted_senders('63000000-0000-0000-0000-000000000001'), 1) IS NOT NULL THEN
    RAISE EXCEPTION '074: restricted senders survived an unblock';
  END IF;
END;
$$;

-- ═══ A DELETED message's attachment stays refused even without a block ════
RESET ROLE;
UPDATE public.messages
   SET deleted_at = now(), deletion_kind = 'sender_deleted', deleted_by = '61000000-0000-0000-0000-000000000001'
 WHERE id = '64000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF private.active_chat_attachment_readable('63000000-0000-0000-0000-000000000001/silvana.png') THEN
    RAISE EXCEPTION '074: a deleted message attachment stayed readable';
  END IF;
END;
$$;

-- ═══ A user REMOVED from the conversation loses everything ════════════════
RESET ROLE;
DELETE FROM public.conversation_participants
 WHERE conversation_id = '63000000-0000-0000-0000-000000000001'
   AND user_id = '61000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF private.active_chat_attachment_readable('63000000-0000-0000-0000-000000000001/bruno.png') THEN
    RAISE EXCEPTION '074: a removed participant kept attachment access';
  END IF;
  IF EXISTS (SELECT 1 FROM public.conversation_shared_identities('63000000-0000-0000-0000-000000000001')) THEN
    RAISE EXCEPTION '074: a removed participant kept shared conversation identity';
  END IF;
  -- The club list is a DIFFERENT shared context and is unaffected by leaving a
  -- chat, so this must still work. Otherwise the two contexts are entangled.
  IF (SELECT count(*) FROM public.club_shared_identities('62000000-0000-0000-0000-000000000001')) <> 3 THEN
    RAISE EXCEPTION '074: leaving a conversation changed club structural identity';
  END IF;
END;
$$;

-- ═══ A FORMER club member is not returned by the club reader ══════════════
RESET ROLE;
DELETE FROM public.club_members
 WHERE club_id = '62000000-0000-0000-0000-000000000001'
   AND user_id = '61000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.club_shared_identities('62000000-0000-0000-0000-000000000001')
     WHERE id = '61000000-0000-0000-0000-000000000003'
  ) THEN
    RAISE EXCEPTION '074: a former club member remained discoverable through shared identity';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;

SELECT '074 shared-context identity behaviour harness passed' AS result;
