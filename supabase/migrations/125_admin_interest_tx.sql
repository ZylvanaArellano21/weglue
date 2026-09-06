-- 125 — Transactional Admin Dashboard mutations for the interest catalog.
-- Registers the controlled audit vocabulary and adds service-role-only RPCs
-- for catalog and club-interest administration.
-- Applies on prod ledger @ 121 after 122-124.

INSERT INTO public.admin_audit_actions
  (action, target_type, sensitivity, requires_reason, description)
VALUES
  ('interest.create',       'system', 'ordinary',  FALSE, 'Create an interest in the shared catalog'),
  ('interest.rename',       'system', 'ordinary',  FALSE, 'Rename an interest label'),
  ('interest.deactivate',   'system', 'sensitive', TRUE,  'Deactivate an interest (hidden from both surveys; history kept)'),
  ('interest.reactivate',   'system', 'sensitive', TRUE,  'Reactivate a previously deactivated interest'),
  ('club.interestAssign',   'club',   'ordinary',  FALSE, 'Assign an interest to a club at a tier'),
  ('club.interestRetier',   'club',   'ordinary',  FALSE, 'Change a club interest between primary and secondary'),
  ('club.interestRemove',   'club',   'sensitive', TRUE,  'Remove an interest assignment from a club')
ON CONFLICT (action) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_tx_interest_create(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_label text, p_slug text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  meta      JSONB;
  v_label   TEXT;
  new_slug  TEXT;
  new_id    UUID;
  after_row JSONB;
BEGIN
  v_label := btrim(COALESCE(p_label, ''));
  meta := jsonb_build_object('label', p_label, 'slug', p_slug);

  IF char_length(v_label) < 2 OR char_length(v_label) > 40 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'interest.create', 'system', NULL, meta, p_correlation_id, 'invalid_label');
  END IF;

  IF p_slug IS NULL THEN
    new_slug := lower(v_label);
    new_slug := replace(new_slug, '&', 'and');
    new_slug := regexp_replace(new_slug, '[^a-z0-9]+', '-', 'g');
    new_slug := btrim(new_slug, '-');
  ELSE
    new_slug := p_slug;
  END IF;

  meta := jsonb_build_object('label', v_label, 'slug', new_slug);

  IF new_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(new_slug) > 60 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'interest.create', 'system', NULL, meta, p_correlation_id, 'invalid_slug');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.interests i
    WHERE i.is_active = true
      AND lower(i.label) = lower(v_label)
  ) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'interest.create', 'system', NULL, meta, p_correlation_id, 'label_taken');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.interests i
    WHERE i.slug = new_slug
  ) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'interest.create', 'system', NULL, meta, p_correlation_id, 'slug_taken');
  END IF;

  INSERT INTO public.interests (slug, label, sort_order)
  VALUES (
    new_slug,
    v_label,
    COALESCE((SELECT max(i.sort_order) + 1 FROM public.interests i), 0)
  )
  RETURNING id INTO new_id;

  SELECT jsonb_build_object(
           'id', i.id,
           'slug', i.slug,
           'label', i.label,
           'is_active', i.is_active
         )
  INTO after_row
  FROM public.interests i
  WHERE i.id = new_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'interest.create', 'system', NULL,
                             p_reason, NULL, after_row, meta, p_correlation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_tx_interest_rename(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_interest_id uuid, p_label text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  meta       JSONB;
  new_label  TEXT;
  before_row JSONB;
  after_row  JSONB;
BEGIN
  new_label := btrim(COALESCE(p_label, ''));
  meta := jsonb_build_object('interestId', p_interest_id, 'label', new_label);

  IF char_length(new_label) < 2 OR char_length(new_label) > 40 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'interest.rename', 'system', NULL, meta, p_correlation_id, 'invalid_label');
  END IF;

  SELECT jsonb_build_object(
           'id', i.id,
           'slug', i.slug,
           'label', i.label,
           'is_active', i.is_active
         )
  INTO before_row
  FROM public.interests i
  WHERE i.id = p_interest_id;

  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'interest.rename', 'system', NULL, meta, p_correlation_id, 'interest_not_found');
  END IF;

  IF lower(before_row ->> 'label') = lower(new_label) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'interest.rename', 'system', NULL, meta, p_correlation_id, 'no_change');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.interests i
    WHERE i.id <> p_interest_id
      AND i.is_active = true
      AND lower(i.label) = lower(new_label)
  ) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'interest.rename', 'system', NULL, meta, p_correlation_id, 'label_taken');
  END IF;

  UPDATE public.interests
  SET label = new_label
  WHERE id = p_interest_id;

  SELECT jsonb_build_object(
           'id', i.id,
           'slug', i.slug,
           'label', i.label,
           'is_active', i.is_active
         )
  INTO after_row
  FROM public.interests i
  WHERE i.id = p_interest_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'interest.rename', 'system', NULL,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_tx_interest_set_active(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_interest_id uuid, p_active boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  meta          JSONB;
  before_row    JSONB;
  after_row     JSONB;
  interest_slug TEXT;
  current_state BOOLEAN;
  action_name   TEXT;
BEGIN
  action_name := CASE WHEN p_active THEN 'interest.reactivate' ELSE 'interest.deactivate' END;

  SELECT jsonb_build_object(
           'id', i.id,
           'slug', i.slug,
           'label', i.label,
           'is_active', i.is_active,
           'archived_at', i.archived_at
         ),
         i.slug,
         i.is_active
  INTO before_row, interest_slug, current_state
  FROM public.interests i
  WHERE i.id = p_interest_id;

  meta := jsonb_build_object('interestId', p_interest_id, 'slug', interest_slug);

  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, action_name, 'system', NULL, meta, p_correlation_id, 'interest_not_found');
  END IF;

  meta := jsonb_build_object('interestId', p_interest_id, 'slug', interest_slug);

  IF current_state = p_active THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, action_name, 'system', NULL, meta, p_correlation_id, 'no_change');
  END IF;

  IF p_active AND EXISTS (
    SELECT 1
    FROM public.interests i
    WHERE i.id <> p_interest_id
      AND i.is_active = true
      AND lower(i.label) = lower(before_row ->> 'label')
  ) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, action_name, 'system', NULL, meta, p_correlation_id, 'label_taken');
  END IF;

  UPDATE public.interests
  SET is_active = p_active,
      archived_at = CASE WHEN p_active THEN NULL ELSE now() END
  WHERE id = p_interest_id;

  SELECT jsonb_build_object(
           'id', i.id,
           'slug', i.slug,
           'label', i.label,
           'is_active', i.is_active,
           'archived_at', i.archived_at
         )
  INTO after_row
  FROM public.interests i
  WHERE i.id = p_interest_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, action_name, 'system', NULL,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_tx_assign_club_interest(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_club_id uuid, p_interest_id uuid, p_tier text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  meta          JSONB := jsonb_build_object('clubId', p_club_id, 'interestId', p_interest_id, 'tier', p_tier);
  interest_label TEXT;
  interest_active BOOLEAN;
  new_id        UUID;
  after_row     JSONB;
BEGIN
  IF p_tier IS NULL OR p_tier NOT IN ('primary', 'secondary') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.interestAssign', 'club', p_club_id, meta, p_correlation_id, 'invalid_tier');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.interestAssign', 'club', p_club_id, meta, p_correlation_id, 'club_not_found');
  END IF;

  SELECT i.label, i.is_active
  INTO interest_label, interest_active
  FROM public.interests i
  WHERE i.id = p_interest_id;

  IF NOT FOUND THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.interestAssign', 'club', p_club_id, meta, p_correlation_id, 'interest_not_found');
  END IF;

  IF NOT interest_active THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.interestAssign', 'club', p_club_id, meta, p_correlation_id, 'interest_inactive');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.club_interests ci
    WHERE ci.club_id = p_club_id
      AND ci.interest_id = p_interest_id
  ) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.interestAssign', 'club', p_club_id, meta, p_correlation_id, 'already_assigned');
  END IF;

  INSERT INTO public.club_interests (club_id, interest_id, tier, interest)
  VALUES (p_club_id, p_interest_id, p_tier, interest_label)
  ON CONFLICT (club_id, interest_id) DO NOTHING
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.interestAssign', 'club', p_club_id, meta, p_correlation_id, 'already_assigned');
  END IF;

  SELECT jsonb_build_object(
           'id', ci.id,
           'club_id', ci.club_id,
           'interest_id', ci.interest_id,
           'interest', ci.interest,
           'tier', ci.tier
         )
  INTO after_row
  FROM public.club_interests ci
  WHERE ci.id = new_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'club.interestAssign', 'club', p_club_id,
                             p_reason, NULL, after_row, meta, p_correlation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_tx_remove_club_interest(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_club_id uuid, p_interest_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  meta       JSONB := jsonb_build_object('clubId', p_club_id, 'interestId', p_interest_id);
  before_row JSONB;
BEGIN
  SELECT jsonb_build_object(
           'id', ci.id,
           'club_id', ci.club_id,
           'interest_id', ci.interest_id,
           'interest', ci.interest,
           'tier', ci.tier
         )
  INTO before_row
  FROM public.club_interests ci
  WHERE ci.club_id = p_club_id
    AND ci.interest_id = p_interest_id;

  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.interestRemove', 'club', p_club_id, meta, p_correlation_id, 'not_assigned');
  END IF;

  DELETE FROM public.club_interests
  WHERE club_id = p_club_id
    AND interest_id = p_interest_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'club.interestRemove', 'club', p_club_id,
                             p_reason, before_row, NULL, meta, p_correlation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_tx_set_club_interest_tier(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_club_id uuid, p_interest_id uuid, p_tier text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  meta       JSONB := jsonb_build_object('clubId', p_club_id, 'interestId', p_interest_id, 'tier', p_tier);
  before_row JSONB;
  after_row  JSONB;
BEGIN
  IF p_tier IS NULL OR p_tier NOT IN ('primary', 'secondary') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.interestRetier', 'club', p_club_id, meta, p_correlation_id, 'invalid_tier');
  END IF;

  SELECT jsonb_build_object(
           'id', ci.id,
           'club_id', ci.club_id,
           'interest_id', ci.interest_id,
           'interest', ci.interest,
           'tier', ci.tier
         )
  INTO before_row
  FROM public.club_interests ci
  WHERE ci.club_id = p_club_id
    AND ci.interest_id = p_interest_id;

  IF before_row IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.interestRetier', 'club', p_club_id, meta, p_correlation_id, 'not_assigned');
  END IF;

  IF before_row ->> 'tier' = p_tier THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.interestRetier', 'club', p_club_id, meta, p_correlation_id, 'no_change');
  END IF;

  UPDATE public.club_interests
  SET tier = p_tier
  WHERE club_id = p_club_id
    AND interest_id = p_interest_id;

  SELECT jsonb_build_object(
           'id', ci.id,
           'club_id', ci.club_id,
           'interest_id', ci.interest_id,
           'interest', ci.interest,
           'tier', ci.tier
         )
  INTO after_row
  FROM public.club_interests ci
  WHERE ci.club_id = p_club_id
    AND ci.interest_id = p_interest_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, 'club.interestRetier', 'club', p_club_id,
                             p_reason, before_row, after_row, meta, p_correlation_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_tx_interest_create(uuid, text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_interest_create(uuid, text, text, uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.admin_tx_interest_rename(uuid, text, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_interest_rename(uuid, text, text, uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.admin_tx_interest_set_active(uuid, text, text, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_interest_set_active(uuid, text, text, uuid, uuid, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.admin_tx_assign_club_interest(uuid, text, text, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_assign_club_interest(uuid, text, text, uuid, uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.admin_tx_remove_club_interest(uuid, text, text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_remove_club_interest(uuid, text, text, uuid, uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.admin_tx_set_club_interest_tier(uuid, text, text, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_set_club_interest_tier(uuid, text, text, uuid, uuid, uuid, text)
  TO service_role;

DO $$
DECLARE
  v_missing integer;
BEGIN
  SELECT count(*)
  INTO v_missing
  FROM (VALUES
    ('interest.create'),
    ('interest.rename'),
    ('interest.deactivate'),
    ('interest.reactivate'),
    ('club.interestAssign'),
    ('club.interestRetier'),
    ('club.interestRemove')
  ) AS expected(action)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.admin_audit_actions a
    WHERE a.action = expected.action
  );

  IF v_missing <> 0 THEN
    RAISE EXCEPTION '125 audit action registration incomplete: % missing', v_missing;
  END IF;

  RAISE NOTICE '125 ok';
END
$$;
