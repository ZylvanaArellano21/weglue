-- ============================================================
-- Regression suite for 047_microsoft_oauth_onboarding.sql
--
-- Run INSIDE a transaction that is ROLLED BACK (Management API:
-- BEGIN; \i 047…; \i this file; ROLLBACK;) — it writes fake auth
-- users and must never persist anything.
--
-- Every check RAISES on failure, so a clean run = all assertions hold.
-- ============================================================

DO $$
DECLARE
  v_ms_user  UUID := gen_random_uuid();
  v_pw_user  UUID := gen_random_uuid();
  v_thief    UUID := gen_random_uuid();
  v_result   JSONB;
  v_profile  profiles%ROWTYPE;
  v_count    INT;
BEGIN
  -- ── 1. Brand-new Microsoft (azure) signup: pending, no batch ──────────────
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_ms_user, 'authenticated',
    'authenticated', 'ms_new_user_test@lonestar.edu', '',
    NOW(),
    '{"provider":"azure","providers":["azure"]}',
    '{"full_name":"Provider Display Name","email":"ms_new_user_test@lonestar.edu"}',
    NOW(), NOW()
  );

  SELECT * INTO v_profile FROM profiles WHERE id = v_ms_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T1: trigger did not create a profile for the azure user';
  END IF;
  IF v_profile.onboarding_completed THEN
    RAISE EXCEPTION 'T1: azure signup without survey metadata must be onboarding-pending';
  END IF;
  IF v_profile.full_name <> '' THEN
    RAISE EXCEPTION 'T1: provider display name must not be adopted (got %)', v_profile.full_name;
  END IF;
  IF v_profile.university_id IS NULL THEN
    RAISE EXCEPTION 'T1: campus not assigned by resolve_signup_university_id';
  END IF;
  IF v_profile.picture_prompt_status <> 'pending' THEN
    RAISE EXCEPTION 'T1: first-login picture prompt must stay pending';
  END IF;
  SELECT COUNT(*) INTO v_count FROM club_recommendation_batches WHERE user_id = v_ms_user;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'T1: batch must be deferred for a pending OAuth signup (found %)', v_count;
  END IF;

  -- ── 2. complete_oauth_onboarding as that user ─────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ms_user, 'role', 'authenticated')::text, true);

  v_result := complete_oauth_onboarding(
    '  @chosen_name  ',
    ARRAY['Music', 'Gaming', 'NOT_A_REAL_INTEREST'],
    ARRAY['Trips', 'NOT_A_REAL_ACTIVITY']
  );
  IF v_result->>'status' <> 'completed' THEN
    RAISE EXCEPTION 'T2: expected completed, got %', v_result->>'status';
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_ms_user;
  IF v_profile.username <> 'chosen_name' THEN
    RAISE EXCEPTION 'T2: username not the explicit choice (got %)', v_profile.username;
  END IF;
  IF v_profile.full_name <> 'chosen_name' THEN
    RAISE EXCEPTION 'T2: full_name must mirror the username like password signup';
  END IF;
  IF NOT v_profile.onboarding_completed THEN
    RAISE EXCEPTION 'T2: onboarding_completed must be true after completion';
  END IF;
  SELECT COUNT(*) INTO v_count FROM user_interests WHERE user_id = v_ms_user;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'T2: exactly the 2 valid interests must persist (got %)', v_count;
  END IF;
  SELECT COUNT(*) INTO v_count FROM user_activities WHERE user_id = v_ms_user;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'T2: exactly the 1 valid activity must persist (got %)', v_count;
  END IF;
  SELECT COUNT(*) INTO v_count FROM club_recommendation_batches
  WHERE user_id = v_ms_user AND status = 'active' AND source = 'onboarding';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'T2: exactly one active onboarding batch (got %)', v_count;
  END IF;

  -- ── 3. Idempotence: calling again must change nothing ─────────────────────
  v_result := complete_oauth_onboarding('different_name', ARRAY['Music'], ARRAY['Trips']);
  IF v_result->>'status' <> 'already_completed' THEN
    RAISE EXCEPTION 'T3: expected already_completed, got %', v_result->>'status';
  END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = v_ms_user;
  IF v_profile.username <> 'chosen_name' THEN
    RAISE EXCEPTION 'T3: replay must never overwrite the username (got %)', v_profile.username;
  END IF;
  SELECT COUNT(*) INTO v_count FROM club_recommendation_batches WHERE user_id = v_ms_user;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'T3: replay must not create another batch (got %)', v_count;
  END IF;

  -- ── 4. Password signup path is untouched by 047 ───────────────────────────
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_pw_user, 'authenticated',
    'authenticated', 'pw_regression_test@lonestar.edu', 'x',
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"pw_regression","full_name":"pw_regression","interests":["Music"],"activities":["Trips"]}',
    NOW(), NOW()
  );
  SELECT * INTO v_profile FROM profiles WHERE id = v_pw_user;
  IF NOT v_profile.onboarding_completed THEN
    RAISE EXCEPTION 'T4: password signup must stay onboarding-complete at creation';
  END IF;
  IF v_profile.username <> 'pw_regression' THEN
    RAISE EXCEPTION 'T4: password signup username regressed (got %)', v_profile.username;
  END IF;
  SELECT COUNT(*) INTO v_count FROM club_recommendation_batches
  WHERE user_id = v_pw_user AND status = 'active';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'T4: password signup must still get its batch at creation (got %)', v_count;
  END IF;

  -- ── 5. Username collision surfaces as username_taken ──────────────────────
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_thief, 'authenticated',
    'authenticated', 'ms_thief_test@lonestar.edu', '',
    NOW(),
    '{"provider":"azure","providers":["azure"]}',
    '{"email":"ms_thief_test@lonestar.edu"}',
    NOW(), NOW()
  );
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_thief, 'role', 'authenticated')::text, true);

  v_result := complete_oauth_onboarding('CHOSEN_NAME', ARRAY['Music'], ARRAY['Trips']);
  IF v_result->>'status' <> 'username_taken' THEN
    RAISE EXCEPTION 'T5: case-insensitive duplicate must be username_taken, got %', v_result->>'status';
  END IF;

  v_result := complete_oauth_onboarding('   ', ARRAY['Music'], ARRAY['Trips']);
  IF v_result->>'status' <> 'username_invalid' THEN
    RAISE EXCEPTION 'T5: blank username must be username_invalid, got %', v_result->>'status';
  END IF;

  -- ── 6. Eligibility + verification backstops ───────────────────────────────
  UPDATE auth.users SET email = 'personal_test@outlook.com' WHERE id = v_thief;
  v_result := complete_oauth_onboarding('thief_name', ARRAY['Music'], ARRAY['Trips']);
  IF v_result->>'status' <> 'not_eligible' THEN
    RAISE EXCEPTION 'T6: ineligible email must be not_eligible, got %', v_result->>'status';
  END IF;

  UPDATE auth.users
  SET email = 'ms_thief_test@lonestar.edu', email_confirmed_at = NULL
  WHERE id = v_thief;
  v_result := complete_oauth_onboarding('thief_name', ARRAY['Music'], ARRAY['Trips']);
  IF v_result->>'status' <> 'email_unverified' THEN
    RAISE EXCEPTION 'T6: unverified email must be email_unverified, got %', v_result->>'status';
  END IF;

  -- ── 7. No session → not_authenticated ─────────────────────────────────────
  PERFORM set_config('request.jwt.claims', NULL, true);
  v_result := complete_oauth_onboarding('nobody', ARRAY[]::TEXT[], ARRAY[]::TEXT[]);
  IF v_result->>'status' <> 'not_authenticated' THEN
    RAISE EXCEPTION 'T7: anonymous call must be not_authenticated, got %', v_result->>'status';
  END IF;

  -- ── 8. Atomic deletion still removes an azure account + identities ────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_ms_user, 'role', 'authenticated')::text, true);
  PERFORM delete_own_account_atomic();
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_ms_user)
     OR EXISTS (SELECT 1 FROM profiles WHERE id = v_ms_user)
     OR EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_ms_user) THEN
    RAISE EXCEPTION 'T8: atomic deletion left traces of the azure account';
  END IF;

  RAISE NOTICE 'test_047_microsoft_auth: ALL ASSERTIONS PASSED';
END;
$$;
