#!/bin/bash
# ===========================================================================
# Verification harness for migration 129 (message reply_to_id + notifications).
#
# Run against a throwaway PostgreSQL/Supabase database after the migration
# ledger, including 129, has been applied. The manifest passes CONTAINER and
# DATABASE as the first two arguments. Every assertion runs in one transaction
# and is rolled back.
# ===========================================================================
set -euo pipefail

CONTAINER="${1:-weglue-harness-pg17}"
DATABASE="${2:-postgres}"

MIGRATION="$(cd "$(dirname "$0")" && pwd)/../migrations/129_message_reply_to.sql"
echo "Applying migration 129 to disposable clone ${DATABASE}…"
docker exec -i "$CONTAINER" psql -U postgres -d "$DATABASE" -v ON_ERROR_STOP=1 -q < "$MIGRATION"

docker exec -i "$CONTAINER" psql -U postgres -d "$DATABASE" -v ON_ERROR_STOP=1 -q <<'SQL'
BEGIN;

\echo '=== 129 MESSAGE REPLY_TO HARNESS ========================================='

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('12300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test123-a@example.com', 'x', now(), '{"provider":"email"}', '{"username":"test123a","full_name":"Test 123 A"}', now(), now()),
  ('12300000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test123-b@example.com', 'x', now(), '{"provider":"email"}', '{"username":"test123b","full_name":"Test 123 B"}', now(), now()),
  ('12300000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test123-c@example.com', 'x', now(), '{"provider":"email"}', '{"username":"test123c","full_name":"Test 123 C"}', now(), now())
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_a uuid := '12300000-0000-4000-8000-000000000001';
  v_b uuid := '12300000-0000-4000-8000-000000000002';
  v_c uuid := '12300000-0000-4000-8000-000000000003';
  v_direct uuid := '12300000-0000-4000-8000-000000000101';
  v_group uuid := '12300000-0000-4000-8000-000000000102';
  v_direct_target uuid;
  v_group_target uuid;
  v_direct_reply uuid;
  v_group_reply uuid;
  v_self_reply uuid;
  v_blocked_reply uuid;
  v_muted_reply uuid;
  v_deleted_target uuid;
  v_deleted_reply uuid;
  v_cross_rejected boolean := false;
  v_count integer;
BEGIN
  INSERT INTO public.conversations (id, type, name)
  VALUES (v_direct, 'direct', '123 direct'), (v_group, 'group', '123 group');

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES
    (v_direct, v_a), (v_direct, v_b),
    (v_group, v_a), (v_group, v_b), (v_group, v_c);

  -- Direct conversation: the target and a reply are stored and notify only A.
  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (v_direct, v_a, 'direct target')
  RETURNING id INTO v_direct_target;
  INSERT INTO public.messages (conversation_id, sender_id, content, reply_to_id)
  VALUES (v_direct, v_b, 'direct reply', v_direct_target)
  RETURNING id INTO v_direct_reply;

  SELECT count(*) INTO v_count
    FROM public.notifications
   WHERE type = 'message_reply' AND entity_type = 'message'
     AND entity_id = v_direct_reply AND user_id = v_a;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'direct reply notification count expected 1, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count
    FROM public.notifications
   WHERE type = 'message_reply' AND entity_id = v_direct_reply AND user_id <> v_a;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'direct reply notified a non-target recipient';
  END IF;

  -- Self-reply is stored but must not create a notification.
  INSERT INTO public.messages (conversation_id, sender_id, content, reply_to_id)
  VALUES (v_direct, v_a, 'self reply', v_direct_target)
  RETURNING id INTO v_self_reply;
  SELECT count(*) INTO v_count
    FROM public.notifications
   WHERE type = 'message_reply' AND entity_id = v_self_reply;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'self reply created a notification';
  END IF;

  -- A group reply still targets only the replied-to sender, not every member.
  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (v_group, v_a, 'group target')
  RETURNING id INTO v_group_target;
  INSERT INTO public.messages (conversation_id, sender_id, content, reply_to_id)
  VALUES (v_group, v_b, 'group reply', v_group_target)
  RETURNING id INTO v_group_reply;
  SELECT count(*) INTO v_count
    FROM public.notifications
   WHERE type = 'message_reply' AND entity_id = v_group_reply AND user_id = v_a;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'group reply notification count expected 1, got %', v_count;
  END IF;
  SELECT count(*) INTO v_count
    FROM public.notifications
   WHERE type = 'message_reply' AND entity_id = v_group_reply AND user_id IN (v_b, v_c);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'group reply notified a non-target member';
  END IF;

  -- Cross-conversation reply targets are rejected before the row is stored.
  BEGIN
    INSERT INTO public.messages (conversation_id, sender_id, content, reply_to_id)
    VALUES (v_direct, v_b, 'cross conversation', v_group_target);
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_cross_rejected := true;
  END;
  IF NOT v_cross_rejected THEN
    RAISE EXCEPTION 'cross-conversation reply_to_id was accepted';
  END IF;

  -- A symmetric block suppresses the notification but does not make a shared
  -- group message fail or disappear.
  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (v_a, v_c);
  INSERT INTO public.messages (conversation_id, sender_id, content, reply_to_id)
  VALUES (v_group, v_c, 'blocked reply', v_group_target)
  RETURNING id INTO v_blocked_reply;
  SELECT count(*) INTO v_count
    FROM public.notifications
   WHERE type = 'message_reply' AND entity_id = v_blocked_reply;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'blocked reply created a notification';
  END IF;

  -- Parent-conversation mute suppresses the target sender's notification.
  UPDATE public.conversation_participants
     SET muted_at = now()
   WHERE conversation_id = v_group AND user_id = v_a;
  INSERT INTO public.messages (conversation_id, sender_id, content, reply_to_id)
  VALUES (v_group, v_b, 'muted reply', v_group_target)
  RETURNING id INTO v_muted_reply;
  SELECT count(*) INTO v_count
    FROM public.notifications
   WHERE type = 'message_reply' AND entity_id = v_muted_reply;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'muted reply created a notification';
  END IF;

  -- ON DELETE SET NULL preserves a reply when its target row is physically
  -- removed; this is separate from soft unsend, which retains the target row.
  INSERT INTO public.messages (conversation_id, sender_id, content)
  VALUES (v_direct, v_b, 'deleted target')
  RETURNING id INTO v_deleted_target;
  INSERT INTO public.messages (conversation_id, sender_id, content, reply_to_id)
  VALUES (v_direct, v_a, 'reply survives target deletion', v_deleted_target)
  RETURNING id INTO v_deleted_reply;
  DELETE FROM public.messages WHERE id = v_deleted_target;
  IF EXISTS (SELECT 1 FROM public.messages WHERE id = v_deleted_target) THEN
    RAISE EXCEPTION 'deleted reply target still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.messages WHERE id = v_deleted_reply AND reply_to_id IS NOT NULL) THEN
    RAISE EXCEPTION 'reply_to_id was not nulled after target deletion';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.messages WHERE id = v_deleted_reply) THEN
    RAISE EXCEPTION 'reply row did not survive target deletion';
  END IF;

  RAISE NOTICE 'PASS: reply link, same-conversation guard, direct/group fan-out, self/block/mute suppression, and target deletion';
END
$$;

ROLLBACK;
SQL
