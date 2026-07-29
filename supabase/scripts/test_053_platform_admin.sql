-- ============================================================
-- Regression suite for 053_platform_admin_accounts.sql
--
-- Run INSIDE a transaction that is ROLLED BACK (Management API:
-- BEGIN; <053 migration>; <this file>; ROLLBACK;) — it writes fake
-- auth users and must never persist anything.
--
-- Every check RAISES on failure, so a clean run = all assertions hold.
--
-- What this proves, in order:
--   T1  ordinary .edu password signup still creates a full student profile
--   T2  a platform-admin auth user creates NO student footprint at all
--   T3  the .edu eligibility gate is untouched (gmail still rejected)
--   T4  ensure_profile() still repairs an ordinary student
--   T5  ensure_profile() returns NULL for a platform admin (no re-mint)
--   T6  clients cannot spoof the marker via user_metadata
--   T7  the auth.users row and its UUID survive deleting the profile
--   T8  Microsoft (azure) onboarding-pending behavior is unchanged
-- ============================================================

DO $$
DECLARE
  v_student  UUID := gen_random_uuid();
  v_admin    UUID := gen_random_uuid();
  v_spoofer  UUID := gen_random_uuid();
  v_ms       UUID := gen_random_uuid();
  v_profile  profiles%ROWTYPE;
  v_count    INT;
  v_repaired profiles%ROWTYPE;
  v_kept     UUID;
BEGIN
  -- ══════════════════════════════════════════════════════════════════════
  -- T1 — ordinary .edu password signup is COMPLETELY unchanged
  -- ══════════════════════════════════════════════════════════════════════
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_student, 'authenticated',
    'authenticated', 't053_student@my.lonestar.edu', '',
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"t053student","full_name":"t053student",
      "interests":["Music","Gaming"],"activities":["Projects"]}',
    NOW(), NOW()
  );

  SELECT * INTO v_profile FROM profiles WHERE id = v_student;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T1: .edu signup no longer creates a profile';
  END IF;
  IF v_profile.username <> 't053student' THEN
    RAISE EXCEPTION 'T1: explicit username not honored (got %)', v_profile.username;
  END IF;
  IF NOT v_profile.onboarding_completed THEN
    RAISE EXCEPTION 'T1: password signup must be onboarding_completed';
  END IF;
  IF v_profile.university_id IS NULL THEN
    RAISE EXCEPTION 'T1: campus not assigned';
  END IF;

  SELECT COUNT(*) INTO v_count FROM user_interests WHERE user_id = v_student;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'T1: expected 2 interests, got %', v_count;
  END IF;
  SELECT COUNT(*) INTO v_count FROM user_activities WHERE user_id = v_student;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'T1: expected 1 activity, got %', v_count;
  END IF;
  SELECT COUNT(*) INTO v_count
  FROM club_recommendation_batches WHERE user_id = v_student;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'T1: recommendation batch not generated';
  END IF;
  SELECT COUNT(*) INTO v_count
  FROM social_proof_events WHERE actor_id = v_student;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'T1: social-proof event missing for a real student (got %)', v_count;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- T2 — a platform-admin auth user creates NO student footprint
  -- ══════════════════════════════════════════════════════════════════════
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_admin, 'authenticated',
    'authenticated', 't053_admin@example.com', '',
    NOW(),
    '{"provider":"email","providers":["email"],"account_type":"platform_admin"}',
    -- Deliberately carries survey metadata too: even a fully "student-looking"
    -- payload must produce nothing once the marker is present.
    '{"username":"t053admin","full_name":"Admin",
      "interests":["Music"],"activities":["Projects"]}',
    NOW(), NOW()
  );

  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_admin) THEN
    RAISE EXCEPTION 'T2: platform admin was given a student profile';
  END IF;
  IF EXISTS (SELECT 1 FROM user_interests WHERE user_id = v_admin) THEN
    RAISE EXCEPTION 'T2: platform admin was given interests';
  END IF;
  IF EXISTS (SELECT 1 FROM user_activities WHERE user_id = v_admin) THEN
    RAISE EXCEPTION 'T2: platform admin was given activities';
  END IF;
  IF EXISTS (SELECT 1 FROM club_recommendation_batches WHERE user_id = v_admin) THEN
    RAISE EXCEPTION 'T2: platform admin was given a recommendation batch';
  END IF;
  IF EXISTS (SELECT 1 FROM social_proof_events WHERE actor_id = v_admin) THEN
    RAISE EXCEPTION 'T2: platform admin produced a social-proof event';
  END IF;
  IF EXISTS (SELECT 1 FROM notifications WHERE actor_id = v_admin) THEN
    RAISE EXCEPTION 'T2: platform admin produced student notifications';
  END IF;
  -- And the auth identity itself must exist and be untouched.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_admin) THEN
    RAISE EXCEPTION 'T2: the auth.users row must survive — only the profile is skipped';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- T3 — .edu eligibility is untouched
  -- ══════════════════════════════════════════════════════════════════════
  IF is_educational_email('someone@gmail.com') THEN
    RAISE EXCEPTION 'T3: gmail.com must remain ineligible for student signup';
  END IF;
  IF NOT is_educational_email('someone@my.lonestar.edu') THEN
    RAISE EXCEPTION 'T3: .edu must remain eligible';
  END IF;
  -- The hook still rejects a consumer domain with a 422 error object…
  IF (before_user_created(
        '{"user":{"email":"someone@gmail.com"}}'::jsonb
      ) -> 'error' ->> 'http_code') <> '422' THEN
    RAISE EXCEPTION 'T3: before_user_created no longer rejects gmail signups';
  END IF;
  -- …and still allows a school address through unmodified.
  IF before_user_created(
       '{"user":{"email":"someone@my.lonestar.edu"}}'::jsonb
     ) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'T3: before_user_created no longer allows .edu signups';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- T4 — ensure_profile() still repairs an ordinary student
  -- ══════════════════════════════════════════════════════════════════════
  DELETE FROM profiles WHERE id = v_student;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_student::text)::text, true);
  SELECT * INTO v_repaired FROM ensure_profile();
  IF v_repaired.id IS NULL THEN
    RAISE EXCEPTION 'T4: ensure_profile failed to repair a student profile';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_student) THEN
    RAISE EXCEPTION 'T4: ensure_profile did not persist the repaired row';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- T5 — ensure_profile() returns NULL for a platform admin
  --       (this is what stops iOS/Android re-minting the deleted profile)
  -- ══════════════════════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_admin::text)::text, true);
  SELECT * INTO v_repaired FROM ensure_profile();
  IF v_repaired.id IS NOT NULL THEN
    RAISE EXCEPTION 'T5: ensure_profile returned a row for a platform admin';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_admin) THEN
    RAISE EXCEPTION 'T5: ensure_profile created a profile for a platform admin';
  END IF;
  IF EXISTS (SELECT 1 FROM social_proof_events WHERE actor_id = v_admin) THEN
    RAISE EXCEPTION 'T5: the repair path re-fired the social-proof fan-out';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- T6 — the marker cannot be spoofed from the client
  --       user_metadata is client-writable; app_metadata is not.
  -- ══════════════════════════════════════════════════════════════════════
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_spoofer, 'authenticated',
    'authenticated', 't053_spoofer@my.lonestar.edu', '',
    NOW(),
    '{"provider":"email","providers":["email"]}',
    -- The attacker's best attempt: the marker in the metadata they CAN set.
    '{"username":"t053spoof","account_type":"platform_admin"}',
    NOW(), NOW()
  );
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_spoofer) THEN
    RAISE EXCEPTION 'T6: a user_metadata claim was honored — spoofable marker!';
  END IF;

  -- Near-miss values in app_metadata must not match either.
  IF is_platform_admin_auth('{"account_type":"Platform_Admin"}'::jsonb) THEN
    RAISE EXCEPTION 'T6: marker matching is case-insensitive';
  END IF;
  IF is_platform_admin_auth('{"account_type":"admin"}'::jsonb) THEN
    RAISE EXCEPTION 'T6: marker matched a different value';
  END IF;
  IF is_platform_admin_auth('{"account_type":true}'::jsonb) THEN
    RAISE EXCEPTION 'T6: marker matched a non-string value';
  END IF;
  IF is_platform_admin_auth('{}'::jsonb) THEN
    RAISE EXCEPTION 'T6: marker matched an empty object';
  END IF;
  IF is_platform_admin_auth(NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'T6: marker is not NULL-safe';
  END IF;
  IF NOT is_platform_admin_auth('{"account_type":"platform_admin"}'::jsonb) THEN
    RAISE EXCEPTION 'T6: the real marker does not match';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- T7 — deleting a profile never touches the auth identity or its UUID
  -- ══════════════════════════════════════════════════════════════════════
  DELETE FROM profiles WHERE id = v_student;
  SELECT id INTO v_kept FROM auth.users WHERE id = v_student;
  IF v_kept IS NULL THEN
    RAISE EXCEPTION 'T7: deleting a profile removed the auth user';
  END IF;
  IF v_kept <> v_student THEN
    RAISE EXCEPTION 'T7: the immutable UUID changed';
  END IF;
  -- Dependent student rows cascade away with the profile, as designed.
  IF EXISTS (SELECT 1 FROM user_interests WHERE user_id = v_student) THEN
    RAISE EXCEPTION 'T7: interests did not cascade with the profile';
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- T8 — Microsoft (azure) onboarding is unchanged by this migration
  -- ══════════════════════════════════════════════════════════════════════
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_ms, 'authenticated',
    'authenticated', 't053_ms@my.lonestar.edu', '',
    NOW(),
    '{"provider":"azure","providers":["azure"]}',
    '{"full_name":"Provider Display Name"}',
    NOW(), NOW()
  );
  SELECT * INTO v_profile FROM profiles WHERE id = v_ms;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'T8: azure signup no longer creates a placeholder profile';
  END IF;
  IF v_profile.onboarding_completed THEN
    RAISE EXCEPTION 'T8: azure signup must remain onboarding-pending';
  END IF;
  IF v_profile.full_name <> '' THEN
    RAISE EXCEPTION 'T8: provider display name must not be adopted';
  END IF;
  IF EXISTS (SELECT 1 FROM club_recommendation_batches WHERE user_id = v_ms) THEN
    RAISE EXCEPTION 'T8: azure batch generation must still be deferred';
  END IF;

  RAISE NOTICE '053 platform-admin suite: ALL 8 GROUPS PASSED';
END;
$$;
