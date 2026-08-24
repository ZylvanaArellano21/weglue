-- ============================================================================
-- 094 — Authorization boundary hardening
--
-- Client code, browser state, and mobile binaries are untrusted. This migration
-- removes the public email-only account deletion RPC and adds the one canonical
-- server-authorized path for transferring ownership of a custom group chat.
-- ============================================================================

BEGIN;

-- The old signup flow could delete any unconfirmed auth user by supplying that
-- user's email. A confirmation email is now resent by the clients instead; no
-- client role may execute the destructive legacy function.
REVOKE ALL ON FUNCTION public.replace_pending_signup(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Consent is bound to the Auth row created by GoTrue. The value is accepted
-- only as signup metadata and the trigger always writes it to NEW.id. There is
-- no post-signup service-role action that accepts an arbitrary profile UUID.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_university_id uuid;
  v_email_domain text;
  v_interests text[];
  v_activities text[];
  v_provider text;
  v_oauth_pending boolean;
  v_agreed_to_terms boolean;
BEGIN
  IF public.is_platform_admin_auth(NEW.raw_app_meta_data) THEN
    RETURN NEW;
  END IF;

  v_provider := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  v_oauth_pending := v_provider <> 'email'
    AND NOT (NEW.raw_user_meta_data ? 'interests')
    AND NOT (NEW.raw_user_meta_data ? 'activities');
  v_agreed_to_terms := NEW.raw_user_meta_data->>'agreed_to_terms' = 'true';

  BEGIN
    v_university_id := resolve_signup_university_id(NEW.email);
    v_email_domain := NULLIF(LOWER(SPLIT_PART(NEW.email, '@', 2)), '');

    INSERT INTO public.profiles (
      id, username, full_name, university_id, email_domain,
      picture_prompt_status, onboarding_completed, push_permission_prompt_pending,
      agreed_to_terms, agreed_at
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::text, 8)),
      CASE WHEN v_oauth_pending THEN ''
           ELSE COALESCE(NEW.raw_user_meta_data->>'full_name', '') END,
      v_university_id,
      v_email_domain,
      'pending',
      NOT v_oauth_pending,
      true,
      v_agreed_to_terms,
      CASE WHEN v_agreed_to_terms THEN now() ELSE NULL END
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
  END;

  BEGIN
    SELECT COALESCE(ARRAY_AGG(value::text), ARRAY[]::text[])
      INTO v_interests
      FROM JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(NEW.raw_user_meta_data->'interests', '[]'::jsonb)) AS value;
    SELECT COALESCE(ARRAY_AGG(value::text), ARRAY[]::text[])
      INTO v_activities
      FROM JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(NEW.raw_user_meta_data->'activities', '[]'::jsonb)) AS value;

    INSERT INTO public.user_interests (user_id, interest)
    SELECT NEW.id, i
      FROM UNNEST(v_interests) AS i
     WHERE i IN (
       'Finance & Business', 'Social Events', 'Music', 'Fashion',
       'Art & Culture', 'Social Justice & Activism', 'Numbers & Economics',
       'Gaming', 'Health & Wellness', 'Environment', 'Sports & Athletics',
       'Community Service', 'Crafts', 'Religion', 'Technology and Computer',
       'Film & Media', 'Photography', 'Strategy and Critical Thinking',
       'Writing', 'Theater', 'Travel & Languages', 'Debate & Politics'
     )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.user_activities (user_id, activity)
    SELECT NEW.id, a
      FROM UNNEST(v_activities) AS a
     WHERE a IN (
       'Projects', 'Volunteering', 'Workshops', 'Campus Fairs', 'Trips',
       'Study Groups', 'Networking', 'Tournaments', 'Social Events', 'Campus Tours'
     )
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: survey insert failed for %: %', NEW.id, SQLERRM;
  END;

  IF NOT v_oauth_pending THEN
    BEGIN
      PERFORM generate_club_recommendation_batch(NEW.id, 'onboarding');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: batch generation failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_profile()
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_meta jsonb;
  v_app_meta jsonb;
  v_provider text;
  v_pending boolean;
  v_agreed_to_terms boolean;
  v_profile profiles;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT email, raw_user_meta_data, raw_app_meta_data,
         COALESCE(raw_app_meta_data->>'provider', 'email')
    INTO v_email, v_meta, v_app_meta, v_provider
    FROM auth.users WHERE id = v_user_id;

  IF public.is_platform_admin_auth(v_app_meta) THEN RETURN NULL; END IF;

  v_pending := v_provider <> 'email'
    AND NOT (v_meta ? 'interests')
    AND NOT (v_meta ? 'activities')
    AND NOT EXISTS (SELECT 1 FROM user_interests WHERE user_id = v_user_id);
  v_agreed_to_terms := v_meta->>'agreed_to_terms' = 'true';

  INSERT INTO profiles (
    id, username, full_name, university_id, email_domain,
    picture_prompt_status, onboarding_completed, push_permission_prompt_pending,
    agreed_to_terms, agreed_at
  )
  VALUES (
    v_user_id,
    COALESCE(v_meta->>'username', 'user_' || LEFT(v_user_id::text, 8)) || '_' || LEFT(gen_random_uuid()::text, 4),
    CASE WHEN v_pending THEN '' ELSE COALESCE(v_meta->>'full_name', '') END,
    resolve_signup_university_id(v_email),
    NULLIF(LOWER(SPLIT_PART(v_email, '@', 2)), ''),
    'pending', NOT v_pending, true,
    v_agreed_to_terms,
    CASE WHEN v_agreed_to_terms THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;

  UPDATE profiles
     SET university_id = resolve_signup_university_id(v_email)
   WHERE id = v_user_id AND university_id IS NULL;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  RETURN v_profile;
END;
$$;

-- Group-admin transfer must derive the caller from auth.uid() and verify both
-- ownership and target membership inside the database. The browser/mobile UI
-- is not an authorization boundary.
CREATE OR REPLACE FUNCTION public.transfer_group_admin(
  p_conversation_id uuid,
  p_new_admin uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_type text;
  v_current_admin uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_new_admin IS NULL OR p_new_admin = v_me THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  SELECT c.type, c.created_by
    INTO v_type, v_current_admin
    FROM public.conversations AS c
   WHERE c.id = p_conversation_id
   FOR UPDATE;

  IF NOT FOUND OR v_type <> 'group' OR v_current_admin <> v_me THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.conversation_participants AS cp
     WHERE cp.conversation_id = p_conversation_id
       AND cp.user_id = p_new_admin
       AND cp.hidden_at IS NULL
  ) THEN
    RAISE EXCEPTION 'target_not_active_member';
  END IF;

  UPDATE public.conversations
     SET created_by = p_new_admin
   WHERE id = p_conversation_id
     AND type = 'group'
     AND created_by = v_me;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_group_admin(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_group_admin(uuid, uuid)
  TO authenticated;

COMMIT;
