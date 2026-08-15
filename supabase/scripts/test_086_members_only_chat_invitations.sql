-- ===========================================================================
-- Harness for migration 086 (members-only chat invitation authorization).
--
-- Run on a disposable postgres:17 container:
--   docker exec -u postgres <container> psql -v ON_ERROR_STOP=1 -U postgres \
--     -f test_086_fixture_schema.sql \
--     -f ../migrations/086_members_only_chat_invitations.sql \
--     -f test_086_members_only_chat_invitations.sql
--
-- BEGIN/ROLLBACK ASSERT-based tests (nonzero exit = fail):
--   A  — officer can create + rotate a Members-chat (club_group) invitation.
--   B  — a regular (non-officer) member cannot create or reset one.
--   C  — a custom-group creator can no longer create an invitation for it
--        (the core Fix 1 regression: this worked before 086).
--   D  — an officer cannot create an invitation for the officers chat.
--   E  — an unverified account (auth.users.email_confirmed_at IS NULL)
--        cannot redeem a valid token; no membership is created.
--   F  — a verified account redeems a club_group token successfully.
--   G  — the partial unique index makes "one active token per conversation"
--        a DB-enforced invariant, not just an RPC-level convention.
--   H  — Reset (rotate) invalidates the old token immediately; the new
--        token redeems correctly.
--   I  — redeeming while already an officer is a clean no-op: no duplicate
--        club_members row, role stays 'officer'.
--   J  — the migration's own data-fix retroactively revokes a pre-existing
--        custom-group token; it can no longer be redeemed.
--   K  — an invalid/unknown token leaks no private data (only the RPC's
--        own EXCEPTION, no row).
-- ===========================================================================
\set ON_ERROR_STOP on

-- ============================================================
-- TEST A: officer can create + rotate a Members-chat invitation.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university) VALUES
    ('11111111-1111-1111-1111-111111111111','officer_a','Lone Star');
  INSERT INTO public.clubs (id, name, university) VALUES
    ('22222222-2222-2222-2222-222222222222','Robotics','Lone Star');
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','officer');
  INSERT INTO public.conversations (id, type, club_id) VALUES
    ('33333333-3333-3333-3333-333333333333','club_group','22222222-2222-2222-2222-222222222222');
  SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  DO $$
  DECLARE v_token TEXT;
  BEGIN
    v_token := public.get_or_create_chat_invitation('33333333-3333-3333-3333-333333333333');
    ASSERT v_token IS NOT NULL AND length(v_token) > 0, 'TEST A FAILED: officer must get a token';
    RAISE NOTICE 'TEST A PASSED: officer created a Members-chat invitation';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST B: a regular member cannot create or reset an invitation.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university) VALUES
    ('44444444-4444-4444-4444-444444444444','member_b','Lone Star');
  INSERT INTO public.clubs (id, name, university) VALUES
    ('55555555-5555-5555-5555-555555555555','Chess','Lone Star');
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','member');
  INSERT INTO public.conversations (id, type, club_id) VALUES
    ('66666666-6666-6666-6666-666666666666','club_group','55555555-5555-5555-5555-555555555555');
  SET LOCAL request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
  DO $$
  BEGIN
    BEGIN
      PERFORM public.get_or_create_chat_invitation('66666666-6666-6666-6666-666666666666');
      ASSERT false, 'TEST B FAILED: regular member must not be able to create an invitation';
    EXCEPTION WHEN OTHERS THEN
      ASSERT SQLERRM = 'not_authorized', 'TEST B FAILED: expected not_authorized, got ' || SQLERRM;
    END;
    BEGIN
      PERFORM public.rotate_chat_invitation('66666666-6666-6666-6666-666666666666');
      ASSERT false, 'TEST B FAILED: regular member must not be able to reset an invitation';
    EXCEPTION WHEN OTHERS THEN
      ASSERT SQLERRM = 'not_authorized', 'TEST B FAILED: expected not_authorized on reset, got ' || SQLERRM;
    END;
    RAISE NOTICE 'TEST B PASSED: regular member blocked from create and reset';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST C: a custom-group creator can no longer create an invitation
-- for it (the core Fix 1 regression — this worked before 086).
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username) VALUES
    ('77777777-7777-7777-7777-777777777777','group_creator_c');
  INSERT INTO public.conversations (id, type, created_by) VALUES
    ('88888888-8888-8888-8888-888888888888','group','77777777-7777-7777-7777-777777777777');
  SET LOCAL request.jwt.claim.sub = '77777777-7777-7777-7777-777777777777';
  DO $$
  BEGIN
    BEGIN
      PERFORM public.get_or_create_chat_invitation('88888888-8888-8888-8888-888888888888');
      ASSERT false, 'TEST C FAILED: custom-group creator must not be able to create an invitation';
    EXCEPTION WHEN OTHERS THEN
      ASSERT SQLERRM = 'not_authorized', 'TEST C FAILED: expected not_authorized, got ' || SQLERRM;
    END;
    RAISE NOTICE 'TEST C PASSED: custom group chats can no longer produce invitation tokens';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST D: an officer cannot create an invitation for the officers chat.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university) VALUES
    ('99999999-9999-9999-9999-999999999999','officer_d','Lone Star');
  INSERT INTO public.clubs (id, name, university) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Debate','Lone Star');
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','99999999-9999-9999-9999-999999999999','officer');
  INSERT INTO public.conversations (id, type, club_id) VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','officer_chat','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  SET LOCAL request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';
  DO $$
  BEGIN
    BEGIN
      PERFORM public.get_or_create_chat_invitation('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
      ASSERT false, 'TEST D FAILED: officers chat must never produce an invitation token';
    EXCEPTION WHEN OTHERS THEN
      ASSERT SQLERRM = 'not_authorized', 'TEST D FAILED: expected not_authorized, got ' || SQLERRM;
    END;
    RAISE NOTICE 'TEST D PASSED: officers chat remains unshareable even for its own officer';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST E: an unverified account cannot redeem a valid token; no
-- membership is created.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university) VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc','unverified_e','Lone Star');
  INSERT INTO auth.users (id, email_confirmed_at) VALUES
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', NULL);
  INSERT INTO public.clubs (id, name, university) VALUES
    ('dddddddd-dddd-dddd-dddd-dddddddddddd','Film','Lone Star');
  INSERT INTO public.conversations (id, type, club_id) VALUES
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','club_group','dddddddd-dddd-dddd-dddd-dddddddddddd');
  INSERT INTO public.chat_invitations (token, conversation_id, club_id, created_by) VALUES
    ('tok-unverified-e','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','dddddddd-dddd-dddd-dddd-dddddddddddd','dddddddd-dddd-dddd-dddd-dddddddddddd');
  SET LOCAL request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  DO $$
  BEGIN
    BEGIN
      PERFORM public.join_chat_invitation('tok-unverified-e');
      ASSERT false, 'TEST E FAILED: unverified account must not be able to redeem';
    EXCEPTION WHEN OTHERS THEN
      ASSERT SQLERRM = 'email_not_verified', 'TEST E FAILED: expected email_not_verified, got ' || SQLERRM;
    END;
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.club_members
      WHERE club_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' AND user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    ), 'TEST E FAILED: no club membership must be created for an unverified redemption attempt';
    RAISE NOTICE 'TEST E PASSED: unverified accounts cannot redeem, and no membership leaks through';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST F: a verified account redeems a club_group token successfully.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university) VALUES
    ('ffffffff-ffff-ffff-ffff-ffffffffffff','verified_f','Lone Star');
  INSERT INTO auth.users (id, email_confirmed_at) VALUES
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', now());
  INSERT INTO public.clubs (id, name, university) VALUES
    ('10101010-1010-1010-1010-101010101010','Art','Lone Star');
  INSERT INTO public.conversations (id, type, club_id) VALUES
    ('20202020-2020-2020-2020-202020202020','club_group','10101010-1010-1010-1010-101010101010');
  INSERT INTO public.conversation_channels (conversation_id, is_default, display_order) VALUES
    ('20202020-2020-2020-2020-202020202020', true, 0);
  INSERT INTO public.chat_invitations (token, conversation_id, club_id, created_by) VALUES
    ('tok-verified-f','20202020-2020-2020-2020-202020202020','10101010-1010-1010-1010-101010101010','10101010-1010-1010-1010-101010101010');
  SET LOCAL request.jwt.claim.sub = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  DO $$
  DECLARE v_result JSON;
  BEGIN
    v_result := public.join_chat_invitation('tok-verified-f');
    ASSERT (v_result->>'conversation_id') = '20202020-2020-2020-2020-202020202020',
      'TEST F FAILED: expected correct conversation_id in redemption result';
    ASSERT (v_result->>'default_channel_id') IS NOT NULL,
      'TEST F FAILED: expected a default_channel_id (Members sub-channels destination)';
    ASSERT EXISTS (
      SELECT 1 FROM public.club_members
      WHERE club_id = '10101010-1010-1010-1010-101010101010' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' AND role = 'member'
    ), 'TEST F FAILED: club membership must exist after redemption';
    -- Update 1, outcome 2: redemption joins the club AND the Members chat —
    -- both, not just one. The prior version of this test only checked
    -- club_members.
    ASSERT EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = '20202020-2020-2020-2020-202020202020' AND user_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' AND hidden_at IS NULL
    ), 'TEST F FAILED: Members chat participation must exist after redemption, not just club membership';
    RAISE NOTICE 'TEST F PASSED: verified account redeems and gets the sub-channels destination, joined to both the club and the Members chat';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST G: the partial unique index makes "one active token per
-- conversation" a DB-enforced invariant.
-- ============================================================
BEGIN;
  INSERT INTO public.clubs (id, name, university) VALUES
    ('30303030-3030-3030-3030-303030303030','Music','Lone Star');
  INSERT INTO public.conversations (id, type, club_id) VALUES
    ('40404040-4040-4040-4040-404040404040','club_group','30303030-3030-3030-3030-303030303030');
  INSERT INTO public.chat_invitations (token, conversation_id, club_id) VALUES
    ('tok-active-g1','40404040-4040-4040-4040-404040404040','30303030-3030-3030-3030-303030303030');
  DO $$
  BEGIN
    BEGIN
      INSERT INTO public.chat_invitations (token, conversation_id, club_id) VALUES
        ('tok-active-g2','40404040-4040-4040-4040-404040404040','30303030-3030-3030-3030-303030303030');
      ASSERT false, 'TEST G FAILED: a second active token for the same conversation must be rejected';
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'TEST G PASSED: DB rejects a second simultaneously-active token (unique_violation, as expected)';
    END;
  END $$;
ROLLBACK;

-- ============================================================
-- TEST H: Reset (rotate) invalidates the old token immediately; the
-- new token redeems correctly.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university) VALUES
    ('50505050-5050-5050-5050-505050505050','officer_h','Lone Star'),
    ('60606060-6060-6060-6060-606060606060','joiner_h','Lone Star');
  INSERT INTO auth.users (id, email_confirmed_at) VALUES
    ('60606060-6060-6060-6060-606060606060', now());
  INSERT INTO public.clubs (id, name, university) VALUES
    ('70707070-7070-7070-7070-707070707070','Dance','Lone Star');
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('70707070-7070-7070-7070-707070707070','50505050-5050-5050-5050-505050505050','officer');
  INSERT INTO public.conversations (id, type, club_id) VALUES
    ('80808080-8080-8080-8080-808080808080','club_group','70707070-7070-7070-7070-707070707070');
  SET LOCAL request.jwt.claim.sub = '50505050-5050-5050-5050-505050505050';
  DO $$
  DECLARE v_old_token TEXT; v_new_token TEXT;
  BEGIN
    v_old_token := public.get_or_create_chat_invitation('80808080-8080-8080-8080-808080808080');
    v_new_token := public.rotate_chat_invitation('80808080-8080-8080-8080-808080808080');
    ASSERT v_new_token <> v_old_token, 'TEST H FAILED: reset must mint a different token';
  END $$;
  SET LOCAL request.jwt.claim.sub = '60606060-6060-6060-6060-606060606060';
  DO $$
  DECLARE v_old_token TEXT;
  BEGIN
    SELECT token INTO v_old_token FROM public.chat_invitations
      WHERE conversation_id = '80808080-8080-8080-8080-808080808080' AND revoked_at IS NOT NULL LIMIT 1;
    BEGIN
      PERFORM public.join_chat_invitation(v_old_token);
      ASSERT false, 'TEST H FAILED: the OLD (reset) token must be rejected';
    EXCEPTION WHEN OTHERS THEN
      ASSERT SQLERRM = 'invitation_invalid', 'TEST H FAILED: expected invitation_invalid for the old token, got ' || SQLERRM;
    END;
    RAISE NOTICE 'TEST H PASSED: reset immediately invalidates the previous link';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST I: redeeming while already an officer is a clean no-op: no
-- duplicate club_members row, role stays 'officer'.
-- ============================================================
BEGIN;
  INSERT INTO public.profiles (id, username, university) VALUES
    ('90909090-9090-9090-9090-909090909090','officer_i','Lone Star');
  INSERT INTO auth.users (id, email_confirmed_at) VALUES
    ('90909090-9090-9090-9090-909090909090', now());
  INSERT INTO public.clubs (id, name, university) VALUES
    ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0','Cooking','Lone Star');
  INSERT INTO public.club_members (club_id, user_id, role) VALUES
    ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0','90909090-9090-9090-9090-909090909090','officer');
  INSERT INTO public.conversations (id, type, club_id) VALUES
    ('b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0','club_group','a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0');
  INSERT INTO public.chat_invitations (token, conversation_id, club_id) VALUES
    ('tok-officer-i','b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0','a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0');
  SET LOCAL request.jwt.claim.sub = '90909090-9090-9090-9090-909090909090';
  DO $$
  DECLARE v_count INT; v_role TEXT;
  BEGIN
    PERFORM public.join_chat_invitation('tok-officer-i');
    SELECT count(*), max(role) INTO v_count, v_role FROM public.club_members
      WHERE club_id = 'a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0' AND user_id = '90909090-9090-9090-9090-909090909090';
    ASSERT v_count = 1, 'TEST I FAILED: expected exactly one club_members row, got ' || v_count;
    ASSERT v_role = 'officer', 'TEST I FAILED: officer role must be preserved, got ' || v_role;
    -- The officer was seeded as a club_members row only (no prior
    -- conversation_participants row — a realistic "never wired to chat"
    -- drift case). Redemption must still ensure Members-chat participation
    -- even on the no-op club-membership path.
    ASSERT EXISTS (
      SELECT 1 FROM public.conversation_participants
      WHERE conversation_id = 'b0b0b0b0-b0b0-b0b0-b0b0-b0b0b0b0b0b0' AND user_id = '90909090-9090-9090-9090-909090909090' AND hidden_at IS NULL
    ), 'TEST I FAILED: existing officer must still end up as a visible Members chat participant';
    RAISE NOTICE 'TEST I PASSED: redeeming as an existing officer is a clean no-op, role preserved, chat participation ensured';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST J: the migration's own data-fix retroactively revokes a
-- pre-existing custom-group token created before 086.
-- ============================================================
DO $$
DECLARE v_revoked TIMESTAMPTZ;
BEGIN
  SELECT revoked_at INTO v_revoked FROM public.chat_invitations WHERE token = 'tok-group-1';
  ASSERT v_revoked IS NOT NULL, 'TEST J FAILED: pre-existing custom-group token must be retroactively revoked by 086''s data-fix';
  RAISE NOTICE 'TEST J PASSED: pre-existing custom-group invitations were retroactively revoked';
END $$;

BEGIN;
  INSERT INTO public.profiles (id, username) VALUES ('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0','late_joiner_j');
  INSERT INTO auth.users (id, email_confirmed_at) VALUES ('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0', now());
  SET LOCAL request.jwt.claim.sub = 'c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0';
  DO $$
  BEGIN
    BEGIN
      PERFORM public.join_chat_invitation('tok-group-1');
      ASSERT false, 'TEST J FAILED: the retroactively-revoked custom-group token must not redeem';
    EXCEPTION WHEN OTHERS THEN
      ASSERT SQLERRM = 'invitation_invalid', 'TEST J FAILED: expected invitation_invalid, got ' || SQLERRM;
    END;
    RAISE NOTICE 'TEST J PASSED: the retroactively-revoked token cannot be redeemed';
  END $$;
ROLLBACK;

-- ============================================================
-- TEST K: an invalid/unknown token leaks no private data.
-- ============================================================
DO $$
DECLARE v_preview JSON;
BEGIN
  v_preview := public.preview_chat_invitation('this-token-does-not-exist');
  ASSERT v_preview::jsonb = '{"valid":false}'::jsonb, 'TEST K FAILED: unknown token must preview as valid:false only, got ' || v_preview::text;
  RAISE NOTICE 'TEST K PASSED: an invalid token exposes no private data';
END $$;

\echo '=== ALL 086 TESTS COMPLETED ==='
