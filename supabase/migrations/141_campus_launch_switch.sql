-- We Glue - Campus launch switch
--
-- This migration makes the second campus visible to students. It is intended
-- to be applied on its own after founder approval. Reverting means setting
-- both values back; it does not delete anything.

DO $$
DECLARE
  v_single_campus_before BOOLEAN;
  v_single_campus_after  BOOLEAN;
  v_app_config_found     BOOLEAN;
  v_campus_id            UUID;
  v_is_active_before     BOOLEAN;
  v_is_active_after      BOOLEAN;
  v_email_mode           TEXT;
  v_email_domains        TEXT[];
  v_email_denied_message TEXT;
BEGIN
  SELECT ac.single_campus_mode
    INTO v_single_campus_before
    FROM public.app_config AS ac
   WHERE ac.id = TRUE;

  v_app_config_found := FOUND;
  IF NOT v_app_config_found THEN
    RAISE EXCEPTION
      '141: app_config singleton is missing; refusing to apply campus launch switch';
  END IF;

  SELECT u.id,
         u.is_active,
         u.email_mode,
         u.email_domains,
         u.email_denied_message
    INTO v_campus_id,
         v_is_active_before,
         v_email_mode,
         v_email_domains,
         v_email_denied_message
    FROM public.universities AS u
   WHERE u.slug = 'texas-am-college-station';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      '141: Texas A&M University – College Station row is missing; refusing to apply campus launch switch';
  END IF;

  IF v_email_mode IS DISTINCT FROM 'allowlist'
     OR v_email_domains IS DISTINCT FROM ARRAY['tamu.edu']::TEXT[]
     OR v_email_denied_message IS NULL THEN
    RAISE EXCEPTION
      '141: Texas A&M email policy is invalid; expected allowlist over exactly {tamu.edu} with a non-null rejection message (mode=%, domains=%, rejection_message_is_nonnull=%)',
      v_email_mode,
      v_email_domains,
      v_email_denied_message IS NOT NULL;
  END IF;

  RAISE NOTICE
    '141: app_config.single_campus_mode before = %',
    v_single_campus_before;
  RAISE NOTICE
    '141: universities(texas-am-college-station).is_active before = %',
    v_is_active_before;

  UPDATE public.app_config
     SET single_campus_mode = FALSE
   WHERE id = TRUE;

  UPDATE public.universities
     SET is_active = TRUE
   WHERE id = v_campus_id;

  SELECT ac.single_campus_mode
    INTO v_single_campus_after
    FROM public.app_config AS ac
   WHERE ac.id = TRUE;

  SELECT u.is_active
    INTO v_is_active_after
    FROM public.universities AS u
   WHERE u.id = v_campus_id;

  RAISE NOTICE
    '141: app_config.single_campus_mode after = %',
    v_single_campus_after;
  RAISE NOTICE
    '141: universities(texas-am-college-station).is_active after = %',
    v_is_active_after;
END;
$$;
