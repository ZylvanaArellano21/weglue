-- Run only against a disposable/local database with migration 150 installed.
-- All fixtures and the dispatcher spy are rolled back. No HTTP is sent.
BEGIN;

DO $$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.invoke_push_dispatch()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.invoke_push_dispatch()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.invoke_push_dispatch()', 'EXECUTE') THEN
    RAISE EXCEPTION 'dispatcher EXECUTE permissions are not service-role-only';
  END IF;
END;
$$;

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
        v_inserted integer;
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

  -- Hundreds of nested UPDATE statements still belong to one outer INSERT.
  INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, message)
  SELECT target.id, actor.id, 'comment', v_entity, 'post', 'bulk merged comment'
  FROM test_150_users target, test_150_users actor
  WHERE target.n = 1 AND actor.n BETWEEN 4 AND 501;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 0 OR
     (SELECT count(*) FROM test_150_wakeups) <> 7 OR
     (SELECT max(group_count) FROM public.notifications WHERE type = 'comment' AND entity_id = v_entity) <> 500 THEN
    RAISE EXCEPTION 'large nested group merge amplified wakeups or lost updates';
  END IF;
END;
$$;

-- Exercise the database claim contract against more than 500 due fixtures.
-- Snapshot queue status before each call so the test proves both the number
-- returned and the exact rows transitioned, even if other local rows exist.
DO $$
DECLARE
  v_limit integer;
  v_expected integer;
  v_returned integer;
  v_transitioned integer;
  v_round integer;
  v_max_returned integer := 0;
  v_max_transitioned integer := 0;
BEGIN
  IF (SELECT count(*) FROM public.push_queue pq
      JOIN test_150_users u ON u.id = pq.user_id
      WHERE pq.status = 'pending' AND pq.scheduled_for <= now()) < 500 THEN
    RAISE EXCEPTION 'claim contract fixtures contain fewer than 500 due rows';
  END IF;

  CREATE TEMP TABLE test_150_claim_before (id uuid PRIMARY KEY, status text, attempts integer) ON COMMIT DROP;
  CREATE TEMP TABLE test_150_claim_returned (id uuid PRIMARY KEY) ON COMMIT DROP;

  FOR v_round IN 1..28 LOOP
    v_limit := CASE v_round
      WHEN 1 THEN 1 WHEN 2 THEN 199 WHEN 3 THEN 200
      WHEN 4 THEN 201 WHEN 5 THEN 500 WHEN 6 THEN 501
      WHEN 7 THEN 0 WHEN 8 THEN -1 ELSE 200 END;
    v_expected := LEAST(GREATEST(v_limit, 1), 500);
    TRUNCATE test_150_claim_before, test_150_claim_returned;
    INSERT INTO test_150_claim_before
    SELECT id, status, attempts FROM public.push_queue;
    INSERT INTO test_150_claim_returned
    SELECT id FROM public.claim_push_batch(v_limit);

    SELECT count(*) INTO v_returned FROM test_150_claim_returned;
    SELECT count(*) INTO v_transitioned
    FROM public.push_queue q
    JOIN test_150_claim_before b USING (id)
    WHERE b.status = 'pending' AND q.status = 'processing'
      AND q.attempts = b.attempts + 1;

    IF v_returned <> v_expected OR v_transitioned <> v_expected
       OR v_returned <> v_transitioned
       OR EXISTS (
         (SELECT id FROM test_150_claim_returned
          EXCEPT
          SELECT q.id FROM public.push_queue q
          JOIN test_150_claim_before b USING (id)
          WHERE b.status = 'pending' AND q.status = 'processing'
            AND q.attempts = b.attempts + 1)
         UNION ALL
         (SELECT q.id FROM public.push_queue q
          JOIN test_150_claim_before b USING (id)
          WHERE b.status = 'pending' AND q.status = 'processing'
            AND q.attempts = b.attempts + 1
          EXCEPT
          SELECT id FROM test_150_claim_returned)
       ) THEN
      RAISE EXCEPTION 'claim contract failed: round %, requested %, returned %, transitioned %',
        v_round, v_limit, v_returned, v_transitioned;
    END IF;
    IF v_round > 8 THEN
      v_max_returned := GREATEST(v_max_returned, v_returned);
      v_max_transitioned := GREATEST(v_max_transitioned, v_transitioned);
    END IF;
    IF v_round <= 8 THEN
      RAISE NOTICE 'claim limit %: returned %, transitioned %',
        v_limit, v_returned, v_transitioned;
    END IF;

    -- Restore only rows this test claimed; the enclosing transaction rolls
    -- back every fixture and replacement function when this script exits.
    UPDATE public.push_queue q
    SET status = 'pending', attempts = b.attempts, claimed_at = NULL
    FROM test_150_claim_returned r
    JOIN test_150_claim_before b USING (id)
    WHERE q.id = r.id;
  END LOOP;
  RAISE NOTICE '20 repeated claim(200) calls: max returned %, max transitioned %',
    v_max_returned, v_max_transitioned;
END;
$$;

ROLLBACK;
