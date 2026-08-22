-- ============================================================
-- Verification for migration 090 (app_releases + update push).
-- Everything happens inside one transaction and is rolled back.
-- ============================================================
BEGIN;

CREATE TEMP TABLE t_results (test text, ok boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  v_founder UUID := gen_random_uuid();
  v_ua UUID := gen_random_uuid(); -- ordinary ios user with a token
  v_ub UUID := gen_random_uuid(); -- ordinary android user with a token
  v_uc UUID := gen_random_uuid(); -- ordinary ios user, NO token (should never get pushed)
  v_cnt INT;
  v_ver TEXT;
  v_caught BOOLEAN;
  v_pub BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    (v_founder, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-090-founder@example.com', 'x', now(), '{}'::jsonb, '{"account_type":"platform_admin"}'::jsonb, now(), now()),
    (v_ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-090-a@example.com', 'x', now(), '{"username":"test090a","full_name":"Test A"}'::jsonb, '{}'::jsonb, now(), now()),
    (v_ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-090-b@example.com', 'x', now(), '{"username":"test090b","full_name":"Test B"}'::jsonb, '{}'::jsonb, now(), now()),
    (v_uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-090-c@example.com', 'x', now(), '{"username":"test090c","full_name":"Test C"}'::jsonb, '{}'::jsonb, now(), now());
  INSERT INTO profiles (id, username, full_name)
  VALUES (v_ua, 'test090a', 'Test A'), (v_ub, 'test090b', 'Test B'), (v_uc, 'test090c', 'Test C')
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ua::text, 'role', 'authenticated')::text, true);
  PERFORM register_push_token('ExponentPushToken[test-090-a]', 'ios', 'production', 'iPhone A');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ub::text, 'role', 'authenticated')::text, true);
  PERFORM register_push_token('ExponentPushToken[test-090-b]', 'android', 'production', 'Pixel B');
  -- C deliberately gets no token.

  -- ════ RLS: an ordinary authenticated user cannot see a non-public row ════
  -- The draft row is seeded as the privileged session (mirrors how a real
  -- draft would only ever get created via a trusted path, never a client
  -- INSERT — clients aren't even GRANTed INSERT on this table, confirmed
  -- separately below).
  INSERT INTO app_releases (platform, version, is_public) VALUES ('ios', '9.9.9-draft', false);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ua::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_cnt FROM app_releases WHERE version = '9.9.9-draft';
  RESET ROLE;
  RESET request.jwt.claims;
  INSERT INTO t_results VALUES ('0a draft (is_public=false) row invisible under RLS to an ordinary client',
    v_cnt = 0, 'visible_rows=' || v_cnt);

  v_caught := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ua::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO app_releases (platform, version, is_public) VALUES ('ios', '9.9.9-client-insert', false);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  RESET ROLE;
  RESET request.jwt.claims;
  INSERT INTO t_results VALUES ('0b ordinary client has no INSERT privilege on app_releases at all', v_caught, '');

  -- ════ Authorization: a non-admin cannot call publish_app_release ════════
  v_caught := false;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ua::text, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM publish_app_release('ios', '1.0.99');
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO t_results VALUES ('1a non-admin cannot call publish_app_release', v_caught, '');

  RESET request.jwt.claims;

  -- ════ The real path: platform_admin publishes ios 1.0.4 ════════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_founder::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM publish_app_release('ios', '1.0.4');
  RESET ROLE;
  RESET request.jwt.claims;

  SELECT is_public INTO v_pub FROM app_releases WHERE platform = 'ios' AND version = '1.0.4';
  INSERT INTO t_results VALUES ('2a release row created and marked public', v_pub = true, 'is_public=' || v_pub);

  -- iOS user (A) with a token gets pushed; Android user (B) does not
  -- (wrong platform); iOS user (C) with NO token does not (no eligible device).
  SELECT count(*) INTO v_cnt FROM push_queue
   WHERE user_id = v_ua AND category = 'account' AND route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('2b iOS user with a token gets exactly one push', v_cnt = 1, 'rows=' || v_cnt);

  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_ub;
  INSERT INTO t_results VALUES ('2c android user gets nothing from an ios release', v_cnt = 0, 'rows=' || v_cnt);

  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_uc;
  INSERT INTO t_results VALUES ('2d ios user with no token gets nothing', v_cnt = 0, 'rows=' || v_cnt);

  -- Re-publishing the SAME version must never double-send.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_founder::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM publish_app_release('ios', '1.0.4');
  RESET ROLE;
  RESET request.jwt.claims;

  SELECT count(*) INTO v_cnt FROM push_queue
   WHERE user_id = v_ua AND category = 'account' AND route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('3a re-publishing the same version never double-sends', v_cnt = 1, 'rows=' || v_cnt);

  -- Client-side read contract: SELECT ... WHERE platform=ios AND is_public=true
  -- ORDER BY released_at DESC LIMIT 1 returns exactly the published version.
  SELECT version INTO v_ver FROM app_releases WHERE platform = 'ios' AND is_public = true ORDER BY released_at DESC LIMIT 1;
  INSERT INTO t_results VALUES ('4a client read query returns the published version', v_ver = '1.0.4', COALESCE(v_ver, 'null'));

  RAISE NOTICE '=== END ===';
END $$;

SELECT test, ok, detail FROM t_results ORDER BY test;

ROLLBACK;
