#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${1:?container is required}"
DB="${2:?database is required}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATION="${SCRIPT_DIR}/../migrations/128_comment_replies.sql"

psql() {
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -P pager=off "$@"
}

echo "Applying migration 128 to disposable clone ${DB}…"
docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -P pager=off < "$MIGRATION"

echo "Running comment-thread and notification assertions…"
psql <<'SQL'
BEGIN;

-- Stable ids make the disposable-clone setup and cleanup deterministic.
DELETE FROM public.user_blocks
 WHERE blocker_id IN (
   'a1220000-0000-4000-8000-000000000001',
   'a1220000-0000-4000-8000-000000000002',
   'a1220000-0000-4000-8000-000000000003'
 )
    OR blocked_id IN (
   'a1220000-0000-4000-8000-000000000001',
   'a1220000-0000-4000-8000-000000000002',
   'a1220000-0000-4000-8000-000000000003'
 );
DELETE FROM public.notifications
 WHERE user_id IN (
   'a1220000-0000-4000-8000-000000000001',
   'a1220000-0000-4000-8000-000000000002',
   'a1220000-0000-4000-8000-000000000003'
 )
    OR actor_id IN (
   'a1220000-0000-4000-8000-000000000001',
   'a1220000-0000-4000-8000-000000000002',
   'a1220000-0000-4000-8000-000000000003'
 );
DELETE FROM public.posts
 WHERE id IN (
   'a1220000-0000-4000-8000-000000000011',
   'a1220000-0000-4000-8000-000000000012'
 );
DELETE FROM public.profiles
 WHERE id IN (
   'a1220000-0000-4000-8000-000000000001',
   'a1220000-0000-4000-8000-000000000002',
   'a1220000-0000-4000-8000-000000000003'
 );
DELETE FROM auth.users
 WHERE id IN (
   'a1220000-0000-4000-8000-000000000001',
   'a1220000-0000-4000-8000-000000000002',
   'a1220000-0000-4000-8000-000000000003'
 );

INSERT INTO auth.users (id, email, raw_app_meta_data)
VALUES
  ('a1220000-0000-4000-8000-000000000001', 'post-owner-122@example.test', '{}'::jsonb),
  ('a1220000-0000-4000-8000-000000000002', 'parent-author-122@example.test', '{}'::jsonb),
  ('a1220000-0000-4000-8000-000000000003', 'reply-author-122@example.test', '{}'::jsonb);
INSERT INTO public.profiles (id, username, full_name)
VALUES
  ('a1220000-0000-4000-8000-000000000001', 'owner122', 'Post Owner 122'),
  ('a1220000-0000-4000-8000-000000000002', 'parent122', 'Parent Author 122'),
  ('a1220000-0000-4000-8000-000000000003', 'reply122', 'Reply Author 122')
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  full_name = EXCLUDED.full_name;
INSERT INTO public.posts (id, author_id, post_type, image_url, caption)
VALUES
  ('a1220000-0000-4000-8000-000000000011',
   'a1220000-0000-4000-8000-000000000001', 'picture',
   'https://example.test/comment-reply-122-1.jpg', 'Comment reply harness post'),
  ('a1220000-0000-4000-8000-000000000012',
   'a1220000-0000-4000-8000-000000000001', 'picture',
   'https://example.test/comment-reply-122-2.jpg', 'Different post for parent validation');

-- Top-level comments retain the existing post-author notification.
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1220000-0000-4000-8000-000000000003', 'role', 'authenticated')::text,
  true
);
INSERT INTO public.post_comments (id, post_id, user_id, content)
VALUES ('a1220000-0000-4000-8000-000000000021',
        'a1220000-0000-4000-8000-000000000011',
        'a1220000-0000-4000-8000-000000000003', 'Top-level comment');
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.notifications
       WHERE user_id = 'a1220000-0000-4000-8000-000000000001'
         AND actor_id = 'a1220000-0000-4000-8000-000000000003'
         AND type = 'comment'
         AND entity_id = 'a1220000-0000-4000-8000-000000000011'
         AND entity_type = 'post') <> 1 THEN
    RAISE EXCEPTION 'FAIL: top-level comment did not notify post author';
  END IF;
  RAISE NOTICE 'PASS: top-level comment still notifies post author';
END
$$;

-- Seed the parent as a different actor so the normal reply path has a target.
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1220000-0000-4000-8000-000000000002', 'role', 'authenticated')::text,
  true
);
INSERT INTO public.post_comments (id, post_id, user_id, content)
VALUES ('a1220000-0000-4000-8000-000000000022',
        'a1220000-0000-4000-8000-000000000011',
        'a1220000-0000-4000-8000-000000000002', 'Parent comment');
RESET ROLE;

-- (a) + (b) The reply keeps its immediate parent link and notifies only that
-- parent author. Its existing server route resolves the reply row to its post.
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1220000-0000-4000-8000-000000000003', 'role', 'authenticated')::text,
  true
);
INSERT INTO public.post_comments (id, post_id, user_id, content, parent_comment_id)
VALUES ('a1220000-0000-4000-8000-000000000023',
        'a1220000-0000-4000-8000-000000000011',
        'a1220000-0000-4000-8000-000000000003', 'A reply',
        'a1220000-0000-4000-8000-000000000022');
RESET ROLE;

DO $$
DECLARE
  v_reply uuid := 'a1220000-0000-4000-8000-000000000023';
  v_parent uuid := 'a1220000-0000-4000-8000-000000000022';
  v_route jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.post_comments
     WHERE id = v_reply AND parent_comment_id = v_parent
  ) THEN
    RAISE EXCEPTION 'FAIL: reply parent link was not stored';
  END IF;

  IF (SELECT count(*) FROM public.notifications
       WHERE user_id = 'a1220000-0000-4000-8000-000000000002'
         AND actor_id = 'a1220000-0000-4000-8000-000000000003'
         AND type = 'comment_reply'
         AND entity_id = v_reply
         AND entity_type = 'comment') <> 1 THEN
    RAISE EXCEPTION 'FAIL: reply did not create exactly one parent-author notification';
  END IF;

  SELECT route INTO v_route FROM public.notifications
   WHERE user_id = 'a1220000-0000-4000-8000-000000000002'
     AND type = 'comment_reply' AND entity_id = v_reply;
  IF v_route ->> 'screen' <> 'post'
     OR v_route ->> 'postId' <> 'a1220000-0000-4000-8000-000000000011'
     OR v_route ->> 'commentId' <> v_reply::text THEN
    RAISE EXCEPTION 'FAIL: reply route payload is incomplete: %', v_route;
  END IF;
  RAISE NOTICE 'PASS: reply keeps parent link, routes to the exact thread, notifies parent author only';
END
$$;

-- (c) A self-reply is a valid comment but must not create a notification.
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1220000-0000-4000-8000-000000000002', 'role', 'authenticated')::text,
  true
);
INSERT INTO public.post_comments (id, post_id, user_id, content, parent_comment_id)
VALUES ('a1220000-0000-4000-8000-000000000024',
        'a1220000-0000-4000-8000-000000000011',
        'a1220000-0000-4000-8000-000000000002', 'Self reply',
        'a1220000-0000-4000-8000-000000000022');
RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.notifications
       WHERE user_id = 'a1220000-0000-4000-8000-000000000002'
         AND type = 'comment_reply') <> 1 THEN
    RAISE EXCEPTION 'FAIL: self-reply created a notification';
  END IF;
  RAISE NOTICE 'PASS: self-reply creates no notification';
END
$$;

-- (f) A reply whose parent belongs to a different post is rejected by the
-- parent-integrity trigger, without consulting a post_comments RLS policy.
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1220000-0000-4000-8000-000000000003', 'role', 'authenticated')::text,
  true
);
DO $$
DECLARE
  v_raised boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.post_comments (post_id, user_id, content, parent_comment_id)
    VALUES ('a1220000-0000-4000-8000-000000000012',
            'a1220000-0000-4000-8000-000000000003', 'Wrong-post reply',
            'a1220000-0000-4000-8000-000000000022');
  EXCEPTION WHEN check_violation THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'FAIL: cross-post parent insert unexpectedly succeeded';
  END IF;
  RAISE NOTICE 'PASS: cross-post parent is rejected by trigger';
END
$$;
RESET ROLE;

-- (d) A blocked parent/replier pair may create the reply, but must not create
-- a reply notification. The parent-author relationship is enforced in the
-- notification path, not in comment INSERT policy.
INSERT INTO public.user_blocks (blocker_id, blocked_id)
VALUES ('a1220000-0000-4000-8000-000000000002',
        'a1220000-0000-4000-8000-000000000003');
SET ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'a1220000-0000-4000-8000-000000000003', 'role', 'authenticated')::text,
  true
);
INSERT INTO public.post_comments (id, post_id, user_id, content, parent_comment_id)
VALUES ('a1220000-0000-4000-8000-000000000025',
        'a1220000-0000-4000-8000-000000000011',
        'a1220000-0000-4000-8000-000000000003', 'Blocked reply',
        'a1220000-0000-4000-8000-000000000022');
RESET ROLE;

DO $$
DECLARE
  v_blocked_reply uuid := 'a1220000-0000-4000-8000-000000000025';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.post_comments
     WHERE id = v_blocked_reply
       AND parent_comment_id = 'a1220000-0000-4000-8000-000000000022'
  ) THEN
    RAISE EXCEPTION 'FAIL: blocked reply row was not created';
  END IF;
  IF (SELECT count(*) FROM public.notifications
       WHERE user_id = 'a1220000-0000-4000-8000-000000000002'
         AND type = 'comment_reply') <> 1 THEN
    RAISE EXCEPTION 'FAIL: blocked reply created a notification';
  END IF;
  RAISE NOTICE 'PASS: blocked reply is stored but creates no notification';
END
$$;

-- (e) Deleting a middle comment preserves replies and nulls only their
-- immediate parent link.
DELETE FROM public.post_comments
 WHERE id = 'a1220000-0000-4000-8000-000000000022';

DO $$
DECLARE
  v_reply uuid := 'a1220000-0000-4000-8000-000000000023';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.post_comments
     WHERE id = v_reply AND parent_comment_id IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL: deleting parent did not preserve reply with NULL link';
  END IF;
  RAISE NOTICE 'PASS: parent delete preserves reply and sets parent_comment_id NULL';
END
$$;

ROLLBACK;
SQL

echo "All comment-reply harness checks passed."
