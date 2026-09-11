-- ============================================================================
-- 133 — Admin Dashboard club management
--
-- The service-role client is deliberately read-only for canonical tables after
-- migration 075. These SECURITY DEFINER functions are the narrow, server-only
-- write path for creating and editing clubs. Officer mutations continue to use
-- the atomic migration-054/056 functions already used by the admin actions.
--
-- Additive only: no table columns, RLS policies, or existing triggers change.
-- ============================================================================

BEGIN;

-- The audit catalog is append-only and admin_audit_events.action is an FK into
-- it. Register the two new club actions before the functions can emit them.
INSERT INTO public.admin_audit_actions
  (action, target_type, sensitivity, requires_reason, description)
VALUES
  ('club.create', 'club', 'sensitive', FALSE, 'Create a club'),
  ('club.edit',   'club', 'ordinary',  FALSE, 'Edit club information')
ON CONFLICT (action) DO UPDATE SET
  target_type = EXCLUDED.target_type,
  sensitivity = EXCLUDED.sensitivity,
  requires_reason = EXCLUDED.requires_reason,
  description = EXCLUDED.description;

-- --------------------------------------------------------------------------
-- Shared club snapshot. The JSON keys are restricted by the existing audit
-- sanitizer/DB validator; no private or credential-bearing values enter it.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.admin_snap_club(p_club_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'handle', c.handle,
    'description', c.description,
    'avatar_url', c.avatar_url,
    'cover_image_url', c.cover_image_url,
    'banner_url', c.banner_url,
    'university_id', c.university_id,
    'meeting_day', c.meeting_day,
    'meeting_time_start', c.meeting_time_start,
    'meeting_time_end', c.meeting_time_end,
    'meeting_location', c.meeting_location,
    'meeting_building', c.meeting_building,
    'meeting_room', c.meeting_room,
    'is_active', c.is_active,
    'claimed', c.claimed,
    'member_count', c.member_count,
    'updated_at', c.updated_at
  )
  FROM public.clubs c
  WHERE c.id = p_club_id;
$$;

-- --------------------------------------------------------------------------
-- Create club
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_tx_club_create(
  p_actor_id uuid,
  p_actor_email text,
  p_reason text,
  p_correlation_id uuid,
  p_name text,
  -- Kept as an optional compatibility parameter. The derive-handle trigger
  -- deliberately ignores it; the server never validates or writes it.
  p_handle text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_university_id uuid DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_cover_image_url text DEFAULT NULL,
  p_banner_url text DEFAULT NULL,
  p_meeting_day text DEFAULT NULL,
  p_meeting_time_start text DEFAULT NULL,
  p_meeting_time_end text DEFAULT NULL,
  p_meeting_location text DEFAULT NULL,
  p_meeting_building text DEFAULT NULL,
  p_meeting_room text DEFAULT NULL,
  p_meeting_schedule jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_description text := btrim(COALESCE(p_description, ''));
  v_id uuid;
  v_after jsonb;
  v_meta jsonb := jsonb_build_object('universityId', p_university_id);
BEGIN
  IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.create', 'club', NULL, v_meta, p_correlation_id, 'invalid_club_name');
  END IF;
  IF char_length(v_description) < 1 OR char_length(v_description) > 5000 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.create', 'club', NULL, v_meta, p_correlation_id, 'invalid_description');
  END IF;
  IF p_university_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.universities u WHERE u.id = p_university_id) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.create', 'club', NULL, v_meta, p_correlation_id, 'university_not_found');
  END IF;

  BEGIN
    INSERT INTO public.clubs (
      name, description, university_id, avatar_url, cover_image_url,
      banner_url, meeting_day, meeting_time_start, meeting_time_end,
      meeting_location, meeting_building, meeting_room, meeting_schedule
    )
    VALUES (
      v_name,
      v_description,
      p_university_id,
      NULLIF(btrim(p_avatar_url), ''),
      NULLIF(btrim(p_cover_image_url), ''),
      NULLIF(btrim(p_banner_url), ''),
      NULLIF(btrim(p_meeting_day), ''),
      NULLIF(btrim(p_meeting_time_start), '')::time,
      NULLIF(btrim(p_meeting_time_end), '')::time,
      NULLIF(btrim(p_meeting_location), ''),
      NULLIF(btrim(p_meeting_building), ''),
      NULLIF(btrim(p_meeting_room), ''),
      p_meeting_schedule
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.create', 'club', NULL, v_meta, p_correlation_id, 'name_taken_at_university');
  WHEN check_violation THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.create', 'club', NULL, v_meta, p_correlation_id, 'invalid_club_name');
  END;

  v_after := private.admin_snap_club(v_id);
  RETURN private.admin_tx_ok(
    p_actor_id, p_actor_email, 'club.create', 'club', v_id,
    p_reason, NULL, v_after, v_meta || jsonb_build_object('clubId', v_id), p_correlation_id
  );
END;
$$;

-- --------------------------------------------------------------------------
-- Edit club information. p_patch is an explicit allowlist consumed below;
-- arbitrary column names never reach a dynamic SQL statement.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_tx_club_update(
  p_actor_id uuid,
  p_actor_email text,
  p_reason text,
  p_correlation_id uuid,
  p_club_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_patch jsonb := CASE
    WHEN jsonb_typeof(p_patch) = 'object' THEN p_patch
    ELSE '{}'::jsonb
  END;
  v_name text;
  v_description text;
  v_meta jsonb := jsonb_build_object('clubId', p_club_id);
BEGIN
  v_before := private.admin_snap_club(p_club_id);
  IF v_before IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.edit', 'club', p_club_id, v_meta, p_correlation_id, 'not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(v_patch) AS key
    WHERE key NOT IN (
      'name', 'description', 'university_id', 'avatar_url',
      'cover_image_url', 'banner_url', 'meeting_day', 'meeting_time_start',
      'meeting_time_end', 'meeting_location', 'meeting_building',
      'meeting_room', 'meeting_schedule', 'is_active'
    )
  ) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.edit', 'club', p_club_id, v_meta, p_correlation_id, 'invalid_patch');
  END IF;
  IF v_patch = '{}'::jsonb THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.edit', 'club', p_club_id, v_meta, p_correlation_id, 'empty_patch');
  END IF;

  v_name := CASE WHEN v_patch ? 'name' THEN btrim(v_patch->>'name') ELSE v_before->>'name' END;
  v_description := CASE WHEN v_patch ? 'description' THEN btrim(v_patch->>'description') ELSE v_before->>'description' END;

  IF v_name IS NULL OR char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.edit', 'club', p_club_id, v_meta, p_correlation_id, 'invalid_club_name');
  END IF;
  IF v_description IS NULL OR char_length(v_description) < 1 OR char_length(v_description) > 5000 THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.edit', 'club', p_club_id, v_meta, p_correlation_id, 'invalid_description');
  END IF;
  IF v_patch ? 'university_id'
     AND v_patch->>'university_id' IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.universities u
       WHERE u.id = (v_patch->>'university_id')::uuid
     ) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.edit', 'club', p_club_id, v_meta, p_correlation_id, 'university_not_found');
  END IF;

  BEGIN
    UPDATE public.clubs AS c
    SET
      name = CASE WHEN v_patch ? 'name' THEN v_name ELSE c.name END,
      description = CASE WHEN v_patch ? 'description' THEN v_description ELSE c.description END,
      university_id = CASE WHEN v_patch ? 'university_id' THEN (v_patch->>'university_id')::uuid ELSE c.university_id END,
      avatar_url = CASE WHEN v_patch ? 'avatar_url' THEN NULLIF(v_patch->>'avatar_url', '') ELSE c.avatar_url END,
      cover_image_url = CASE WHEN v_patch ? 'cover_image_url' THEN NULLIF(v_patch->>'cover_image_url', '') ELSE c.cover_image_url END,
      banner_url = CASE WHEN v_patch ? 'banner_url' THEN NULLIF(v_patch->>'banner_url', '') ELSE c.banner_url END,
      meeting_day = CASE WHEN v_patch ? 'meeting_day' THEN NULLIF(v_patch->>'meeting_day', '') ELSE c.meeting_day END,
      meeting_time_start = CASE WHEN v_patch ? 'meeting_time_start' THEN NULLIF(v_patch->>'meeting_time_start', '')::time ELSE c.meeting_time_start END,
      meeting_time_end = CASE WHEN v_patch ? 'meeting_time_end' THEN NULLIF(v_patch->>'meeting_time_end', '')::time ELSE c.meeting_time_end END,
      meeting_location = CASE WHEN v_patch ? 'meeting_location' THEN NULLIF(v_patch->>'meeting_location', '') ELSE c.meeting_location END,
      meeting_building = CASE WHEN v_patch ? 'meeting_building' THEN NULLIF(v_patch->>'meeting_building', '') ELSE c.meeting_building END,
      meeting_room = CASE WHEN v_patch ? 'meeting_room' THEN NULLIF(v_patch->>'meeting_room', '') ELSE c.meeting_room END,
      meeting_schedule = CASE
        WHEN v_patch ? 'meeting_schedule' AND v_patch->'meeting_schedule' = 'null'::jsonb THEN NULL
        WHEN v_patch ? 'meeting_schedule' THEN v_patch->'meeting_schedule'
        ELSE c.meeting_schedule
      END,
      is_active = CASE WHEN v_patch ? 'is_active' THEN (v_patch->>'is_active')::boolean ELSE c.is_active END
    WHERE c.id = p_club_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.edit', 'club', p_club_id, v_meta, p_correlation_id, 'name_taken_at_university');
  WHEN check_violation THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, 'club.edit', 'club', p_club_id, v_meta, p_correlation_id, 'invalid_club_name');
  END;

  v_after := private.admin_snap_club(p_club_id);
  RETURN private.admin_tx_ok(
    p_actor_id, p_actor_email, 'club.edit', 'club', p_club_id,
    p_reason, v_before, v_after, v_meta, p_correlation_id
  );
END;
$$;

-- These functions are callable by the server's service-role client only.
REVOKE ALL ON FUNCTION public.admin_tx_club_create(
  uuid, text, text, uuid, text, text, text, uuid, text, text, text, text, text, text, text, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_club_create(
  uuid, text, text, uuid, text, text, text, uuid, text, text, text, text, text, text, text, text, text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_tx_club_update(uuid, text, text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_club_update(uuid, text, text, uuid, uuid, jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION private.admin_snap_club(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
