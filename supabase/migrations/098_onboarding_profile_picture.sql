-- 098_onboarding_profile_picture.sql
--
-- A new mandatory "profile picture" onboarding step (Interests → Activities →
-- Profile Picture → username/email → verify) lets a student choose a preset
-- avatar, type initials, or pick/take a photo BEFORE the account exists.
-- Onboarding has no session (email confirmation is ON — see 042/094), so:
--
--   - Preset and text choices are small strings and travel exactly like
--     interests/activities already do: through the user's own signup
--     metadata, materialized by handle_new_user() at account-creation time.
--   - A photo/camera image can't fit in signup metadata, and nothing may
--     write an authenticated-owned row before auth.uid() exists (the
--     `no unauthenticated client write path` rule from 042's commit message).
--     So the client uploads it, pre-auth, to a NEW narrowly-scoped
--     `pending-avatars` bucket: anon may INSERT only an object literally
--     named `<32 lowercase hex chars>.jpg` (a client-generated token, not a
--     credential — see generatePendingAvatarToken in @weglue/shared). The
--     trigger below re-derives the public URL itself from that token; it
--     never trusts an arbitrary URL out of metadata.
--
-- Cross-device note: verifying the confirmation email on a DIFFERENT device
-- than the one a Camera/Photo pick happened on still works — the token was
-- already resolved into profiles.avatar_url at signup time on the ORIGINAL
-- device, before the confirmation email was even sent. Preset and text are
-- durable the same way. Nothing here is picture_prompt_status-eligible: a
-- picture was mandatory, so `picture_prompt_status` goes straight to
-- 'hidden' whenever a choice was actually captured.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pending-avatars', 'pending-avatars', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "pending-avatars: public read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'pending-avatars');

-- Deliberately open to `anon` (no auth.uid() to scope a folder to) — bounded
-- by bucket-level size/mime limits above and this exact filename shape.
-- Nobody can overwrite (upsert:false client-side, no UPDATE policy here) or
-- target any other object.
CREATE POLICY "pending-avatars: upload own token" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'pending-avatars'
    AND name ~ '^[0-9a-f]{32}\.jpg$'
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_university_id uuid;
  v_email_domain text;
  v_interests text[];
  v_activities text[];
  v_provider text;
  v_oauth_pending boolean;
  v_agreed_to_terms boolean;
  v_avatar_choice_type text;
  v_avatar_choice_value text;
  v_avatar_url text;
  v_picture_prompt_status text;
BEGIN
  IF public.is_platform_admin_auth(NEW.raw_app_meta_data) THEN
    RETURN NEW;
  END IF;

  v_provider := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  v_oauth_pending := v_provider <> 'email'
    AND NOT (NEW.raw_user_meta_data ? 'interests')
    AND NOT (NEW.raw_user_meta_data ? 'activities');
  v_agreed_to_terms := COALESCE(NEW.raw_user_meta_data->>'agreed_to_terms' = 'true', false);

  v_avatar_choice_type := NEW.raw_user_meta_data->>'avatar_choice_type';
  v_avatar_choice_value := NEW.raw_user_meta_data->>'avatar_choice_value';
  v_avatar_url := CASE
    WHEN v_avatar_choice_type = 'preset' AND v_avatar_choice_value IN (
      'avatar_01', 'avatar_02', 'avatar_03', 'avatar_04', 'avatar_05',
      'avatar_06', 'avatar_07', 'avatar_08', 'avatar_09', 'avatar_10',
      'avatar_11', 'avatar_12', 'avatar_13', 'avatar_14', 'avatar_15',
      'avatar_16', 'avatar_17', 'avatar_18', 'avatar_19', 'avatar_20',
      'avatar_21', 'avatar_22', 'avatar_23', 'avatar_24', 'avatar_25',
      'avatar_26', 'avatar_27', 'avatar_28', 'avatar_29', 'avatar_30'
    ) THEN 'preset:' || v_avatar_choice_value
    WHEN v_avatar_choice_type = 'text' AND v_avatar_choice_value IS NOT NULL
      AND length(trim(v_avatar_choice_value)) BETWEEN 1 AND 4
    THEN 'text:' || upper(trim(v_avatar_choice_value))
    WHEN v_avatar_choice_type IN ('photo', 'camera')
      AND v_avatar_choice_value ~ '^[0-9a-f]{32}$'
    THEN 'https://yoozrnosmqtaiksgcixc.supabase.co/storage/v1/object/public/pending-avatars/'
      || v_avatar_choice_value || '.jpg'
    ELSE NULL
  END;
  v_picture_prompt_status := CASE WHEN v_avatar_url IS NOT NULL THEN 'hidden' ELSE 'pending' END;

  BEGIN
    v_university_id := resolve_signup_university_id(NEW.email);
    v_email_domain := NULLIF(LOWER(SPLIT_PART(NEW.email, '@', 2)), '');

    INSERT INTO public.profiles (
      id, username, full_name, university_id, email_domain,
      picture_prompt_status, avatar_url, onboarding_completed, push_permission_prompt_pending,
      agreed_to_terms, agreed_at
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::text, 8)),
      CASE WHEN v_oauth_pending THEN ''
           ELSE COALESCE(NEW.raw_user_meta_data->>'full_name', '') END,
      v_university_id,
      v_email_domain,
      v_picture_prompt_status,
      v_avatar_url,
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
$function$;
