-- ============================================================
-- Verification for migration 118's sync_store_app_release() push gate
-- (2026-09-04 security correction): the function must be safe BY
-- CONSTRUCTION, not merely by deployment order (seeding app_releases
-- before the poller's Vault secret is created). It must only enqueue an
-- app_update push when it has confirmed a genuinely newer public release
-- than the previously known public release for that platform:
--
--   1. first-ever baseline insert for a platform  -> NO push
--   2. same version/build detected again          -> NO push (idempotent)
--   3. genuinely newer version/build               -> ONE push per eligible user
--   4. repeated detection of that newer release    -> NO duplicate push
--
-- Exercised for both iOS (matched by version) and Android (matched by
-- build_number) since sync_store_app_release takes different branches for
-- each. Everything happens inside one transaction and is rolled back.
-- ============================================================
BEGIN;

CREATE TEMP TABLE t_results (test text, ok boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  v_ios_a  UUID := gen_random_uuid(); -- ios user, has a token
  v_ios_b  UUID := gen_random_uuid(); -- second ios user, has a token (proves "per eligible user")
  v_ios_c  UUID := gen_random_uuid(); -- ios user, NO token (must never get pushed)
  v_droid  UUID := gen_random_uuid(); -- android user, has a token
  v_cnt    INT;
  v_rows   INT;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    (v_ios_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-118-ios-a@example.com', 'x', now(), '{"username":"test118a","full_name":"iOS A"}'::jsonb, '{}'::jsonb, now(), now()),
    (v_ios_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-118-ios-b@example.com', 'x', now(), '{"username":"test118b","full_name":"iOS B"}'::jsonb, '{}'::jsonb, now(), now()),
    (v_ios_c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-118-ios-c@example.com', 'x', now(), '{"username":"test118c","full_name":"iOS C"}'::jsonb, '{}'::jsonb, now(), now()),
    (v_droid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-118-android@example.com', 'x', now(), '{"username":"test118d","full_name":"Droid"}'::jsonb, '{}'::jsonb, now(), now());
  INSERT INTO profiles (id, username, full_name)
  VALUES (v_ios_a, 'test118a', 'iOS A'), (v_ios_b, 'test118b', 'iOS B'),
         (v_ios_c, 'test118c', 'iOS C'), (v_droid, 'test118d', 'Droid')
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ios_a::text, 'role', 'authenticated')::text, true);
  PERFORM register_push_token('ExponentPushToken[test-118-ios-a]', 'ios', 'production', 'iPhone A');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ios_b::text, 'role', 'authenticated')::text, true);
  PERFORM register_push_token('ExponentPushToken[test-118-ios-b]', 'ios', 'production', 'iPhone B');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_droid::text, 'role', 'authenticated')::text, true);
  PERFORM register_push_token('ExponentPushToken[test-118-android]', 'android', 'production', 'Pixel');
  -- v_ios_c deliberately gets no token.

  RESET request.jwt.claims;

  -- sync_store_app_release is service_role-only; the Edge Function is the
  -- only real caller. Assume that identity directly, as the deployed
  -- function does — it reads request.jwt.claim.role (the flattened GUC
  -- PostgREST derives from the JWT), not the raw request.jwt.claims blob.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- ════ iOS ════════════════════════════════════════════════════════════
  -- 1) First-ever baseline for iOS: nothing was publicly known before this.
  PERFORM sync_store_app_release('ios', '1.0.5', 'https://apps.apple.com/us/app/we-glue/id6786491344');
  SELECT count(*) INTO v_cnt FROM push_queue WHERE route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('1a iOS baseline insert sends no push', v_cnt = 0, 'rows=' || v_cnt);
  SELECT is_public::int INTO v_rows FROM app_releases WHERE platform = 'ios' AND version = '1.0.5';
  INSERT INTO t_results VALUES ('1b iOS baseline row IS recorded as public', v_rows = 1, 'is_public=' || v_rows);

  -- 2) Same version re-detected: idempotent, still no push.
  PERFORM sync_store_app_release('ios', '1.0.5', 'https://apps.apple.com/us/app/we-glue/id6786491344');
  SELECT count(*) INTO v_cnt FROM push_queue WHERE route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('2a iOS re-detecting the SAME version sends no push', v_cnt = 0, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM app_releases WHERE platform = 'ios';
  INSERT INTO t_results VALUES ('2b iOS re-detection does not create a second row', v_cnt = 1, 'rows=' || v_cnt);

  -- 3) Genuinely newer iOS version: exactly one push per eligible user.
  PERFORM sync_store_app_release('ios', '1.0.6', 'https://apps.apple.com/us/app/we-glue/id6786491344');
  SELECT count(*) INTO v_cnt FROM push_queue
   WHERE user_id IN (v_ios_a, v_ios_b) AND route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('3a iOS genuinely newer version pushes exactly one per eligible user (2 tokens)', v_cnt = 2, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_ios_c;
  INSERT INTO t_results VALUES ('3b iOS user with no token still gets nothing', v_cnt = 0, 'rows=' || v_cnt);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_droid AND route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('3c android user gets nothing from an iOS release', v_cnt = 0, 'rows=' || v_cnt);

  -- 4) Repeated detection of that same newer version: no duplicate push.
  PERFORM sync_store_app_release('ios', '1.0.6', 'https://apps.apple.com/us/app/we-glue/id6786491344');
  SELECT count(*) INTO v_cnt FROM push_queue
   WHERE user_id IN (v_ios_a, v_ios_b) AND route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('4a iOS re-detecting the newer version never double-sends', v_cnt = 2, 'rows=' || v_cnt);

  -- ════ Android (matched by build_number, not version) ═══════════════════
  -- 1) First-ever baseline for Android.
  PERFORM sync_store_app_release('android', NULL, 'https://play.google.com/store/apps/details?id=com.weglue.app', 40);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_droid AND route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('5a android baseline insert sends no push', v_cnt = 0, 'rows=' || v_cnt);

  -- 2) Same build re-detected: idempotent.
  PERFORM sync_store_app_release('android', NULL, 'https://play.google.com/store/apps/details?id=com.weglue.app', 40);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_droid AND route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('6a android re-detecting the SAME build sends no push', v_cnt = 0, 'rows=' || v_cnt);

  -- 2b) The same build later gains a marketing name from Play: still the
  -- same release, not a new one — must not push.
  PERFORM sync_store_app_release('android', '1.0.7', 'https://play.google.com/store/apps/details?id=com.weglue.app', 40);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_droid AND route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('6b android build gaining a marketing name is not a new release: no push', v_cnt = 0, 'rows=' || v_cnt);

  -- 3) Genuinely newer Android build: exactly one push.
  PERFORM sync_store_app_release('android', NULL, 'https://play.google.com/store/apps/details?id=com.weglue.app', 41);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_droid AND route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('7a android genuinely newer build pushes exactly once', v_cnt = 1, 'rows=' || v_cnt);

  -- 4) Repeated detection of that newer build: no duplicate.
  PERFORM sync_store_app_release('android', NULL, 'https://play.google.com/store/apps/details?id=com.weglue.app', 41);
  SELECT count(*) INTO v_cnt FROM push_queue WHERE user_id = v_droid AND route ->> 'screen' = 'update';
  INSERT INTO t_results VALUES ('8a android re-detecting the newer build never double-sends', v_cnt = 1, 'rows=' || v_cnt);

  RESET request.jwt.claims;
  RAISE NOTICE '=== END ===';
END $$;

SELECT test, ok, detail FROM t_results ORDER BY test;

DO $$
DECLARE v_failed int;
BEGIN
  SELECT count(*) INTO v_failed FROM t_results WHERE ok IS NOT TRUE;
  IF v_failed > 0 THEN
    RAISE EXCEPTION '% of % assertions failed', v_failed, (SELECT count(*) FROM t_results);
  END IF;
END $$;

ROLLBACK;
