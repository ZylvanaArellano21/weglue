-- Run only against a disposable/local database with migration 150 installed.
-- All fixtures and the dispatcher spy are rolled back. No HTTP is sent.
BEGIN;

CREATE TEMP TABLE test_150_wakeups (id bigint GENERATED ALWAYS AS IDENTITY);
CREATE TEMP TABLE test_150_users (n integer PRIMARY KEY, id uuid NOT NULL DEFAULT gen_random_uuid());

CREATE OR REPLACE FUNCTION public.invoke_push_dispatch()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO pg_temp.test_150_wakeups DEFAULT VALUES;
END;
$$;

INSERT INTO test_150_users (n) SELECT generate_series(1, 501);
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_user_meta_data, created_at, updated_at
)
SELECT id, '00000000-0000-0000-0000-000000000000', 'authenticated',
       'authenticated', 'test150-' || n || '@example.com', 'x', now(),
       jsonb_build_object('username', 'test150_' || n), now(), now()
FROM test_150_users;
INSERT INTO public.profiles (id, username, full_name)
SELECT id, 'test150_' || n, 'Test 150 ' || n FROM test_150_users
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.push_tokens (user_id, token, platform)
SELECT id, 'ExponentPushToken[test150-' || n || ']', 'ios'
FROM test_150_users WHERE n <= 500;
TRUNCATE test_150_wakeups;

-- One row: one queued push and one immediate wakeup.
INSERT INTO public.notifications (user_id, type, message)
SELECT id, 'club_post', 'test single' FROM test_150_users WHERE n = 1;
DO $$
BEGIN
  IF (SELECT count(*) FROM test_150_wakeups) <> 1 OR
     (SELECT count(*) FROM public.push_queue pq JOIN test_150_users u ON u.id = pq.user_id
      WHERE u.n = 1) <> 1 THEN
    RAISE EXCEPTION 'single notification enqueue/wakeup failed';
  END IF;
END;
$$;

-- One SQL statement with 500 recipients: 500 queue rows, one more wakeup.
INSERT INTO public.notifications (user_id, type, message)
SELECT id, 'club_post', 'test bulk' FROM test_150_users WHERE n <= 500;
DO $$
BEGIN
  IF (SELECT count(*) FROM test_150_wakeups) <> 2 OR
     (SELECT count(*) FROM public.push_queue pq JOIN test_150_users u ON u.id = pq.user_id
      WHERE u.n <= 500) <> 501 THEN
    RAISE EXCEPTION 'bulk notification did not enqueue 500 pushes with one wakeup';
  END IF;
END;
$$;

-- An ineligible recipient still causes a harmless statement wakeup.
INSERT INTO public.notifications (user_id, type, message)
SELECT id, 'club_post', 'test no token' FROM test_150_users WHERE n = 501;
DO $$
BEGIN
  IF (SELECT count(*) FROM test_150_wakeups) <> 3 OR
     (SELECT count(*) FROM public.push_queue pq JOIN test_150_users u ON u.id = pq.user_id
      WHERE u.n = 501) <> 0 THEN
    RAISE EXCEPTION 'skipped recipient behavior changed';
  END IF;
END;
$$;

-- One direct UPDATE statement merges 500 existing notifications. It retains
-- row enqueue semantics and produces one more statement wakeup.
UPDATE public.notifications n
SET group_count = group_count + 1
FROM test_150_users u
WHERE n.user_id = u.id AND u.n <= 500 AND n.message = 'test bulk';
DO $$
BEGIN
  IF (SELECT count(*) FROM test_150_wakeups) <> 4 OR
     (SELECT count(*) FROM public.push_queue pq JOIN test_150_users u ON u.id = pq.user_id
      WHERE u.n <= 500) <> 1001 THEN
    RAISE EXCEPTION 'bulk group UPDATE did not coalesce wakeups';
  END IF;
END;
$$;

-- A BEFORE INSERT group merge executes a nested UPDATE. Its wakeup belongs
-- to the outer INSERT statement, including when no new row survives.
INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, message)
SELECT target.id, actor.id, 'comment', gen_random_uuid(), 'post', 'first comment'
FROM test_150_users target, test_150_users actor
WHERE target.n = 1 AND actor.n = 2;
DO $$
DECLARE v_entity uuid;
BEGIN
  SELECT entity_id INTO v_entity FROM public.notifications
  WHERE type = 'comment' AND message = 'first comment' AND user_id = (SELECT id FROM test_150_users WHERE n = 1);
  INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, message)
  SELECT target.id, actor.id, 'comment', v_entity, 'post', 'second comment'
  FROM test_150_users target, test_150_users actor
  WHERE target.n = 1 AND actor.n = 3;
  IF (SELECT count(*) FROM test_150_wakeups) <> 6 OR
     (SELECT max(group_count) FROM public.notifications WHERE type = 'comment' AND entity_id = v_entity) <> 2 THEN
    RAISE EXCEPTION 'nested group merge created extra wakeup or lost merge';
  END IF;
END;
$$;

ROLLBACK;
