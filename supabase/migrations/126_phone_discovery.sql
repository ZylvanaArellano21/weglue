-- 126 — Phone-only Discovery RPCs for the ID-backed interest catalog.
-- Option B (strict): club_categories and the existing discovery RPCs remain
-- frozen; these new RPCs read club_interests directly for native phone paths.
-- Applies on prod ledger @ 121 after 122-125.

-- PostgreSQL cannot change a table-returning function's OUT-column list with
-- CREATE OR REPLACE, so replace the prior two-column definition when rerun.
DROP FUNCTION IF EXISTS public.get_phone_discovery_categories();

-- Every ACTIVE interest is a phone Discovery category — NOT gated on whether a
-- club is tagged with it yet. A category with no matching clubs still shows;
-- selecting it just returns 0 clubs (see get_phone_discovery_clubs__inner).
-- The shared `interests` catalog is the single source of truth.
CREATE OR REPLACE FUNCTION public.get_phone_discovery_categories()
RETURNS TABLE(slug text, label text, sort_order integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT i.slug, i.label, i.sort_order
  FROM public.interests i
  WHERE i.is_active = true
  ORDER BY i.sort_order, i.label;
$function$;

CREATE OR REPLACE FUNCTION public.get_phone_discovery_clubs__inner(
  p_user_id uuid,
  p_interest_slug text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  name text,
  avatar_url text,
  cover_image_url text,
  member_count integer,
  is_member boolean,
  categories text[],
  meeting_day text,
  meeting_time_start text,
  meeting_time_end text,
  meeting_building text,
  meeting_room text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_me uuid := public.assert_self_or_null(p_user_id);
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.avatar_url,
    c.cover_image_url,
    c.member_count,
    EXISTS(
      SELECT 1
      FROM public.club_members cm
      WHERE cm.club_id = c.id
        AND cm.user_id = v_me
    ) AS is_member,
    ARRAY(
      SELECT i.label
      FROM public.club_interests ci
      JOIN public.interests i ON i.id = ci.interest_id
      WHERE ci.club_id = c.id
        AND i.is_active = true
      ORDER BY i.label
    ) AS categories,
    c.meeting_day,
    c.meeting_time_start::TEXT,
    c.meeting_time_end::TEXT,
    c.meeting_building,
    c.meeting_room
  FROM public.clubs c
  WHERE c.is_active = true
    AND (
      p_interest_slug IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.club_interests ci
        JOIN public.interests i ON i.id = ci.interest_id
        WHERE ci.club_id = c.id
          AND i.slug = p_interest_slug
          AND i.is_active = true
      )
    )
  ORDER BY
    CASE WHEN p_interest_slug IS NULL THEN COALESCE((
      SELECT SUM(
        CASE ci.tier
          WHEN 'primary' THEN 3
          WHEN 'secondary' THEN 1
          ELSE 0
        END
      )
      FROM public.club_interests ci
      JOIN public.user_interests ui
        ON ui.interest_id = ci.interest_id
       AND ui.user_id = v_me
      JOIN public.interests i
        ON i.id = ui.interest_id
       AND i.is_active = true
      WHERE ci.club_id = c.id
    ), 0) ELSE 0 END DESC,
    CASE WHEN p_interest_slug IS NULL THEN c.member_count ELSE 0 END DESC,
    c.name ASC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_phone_discovery_clubs(
  p_user_id uuid,
  p_interest_slug text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  name text,
  avatar_url text,
  cover_image_url text,
  member_count integer,
  is_member boolean,
  categories text[],
  meeting_day text,
  meeting_time_start text,
  meeting_time_end text,
  meeting_building text,
  meeting_room text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT public.current_student_can_access_app() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.get_phone_discovery_clubs__inner(
    p_user_id,
    p_interest_slug,
    p_limit,
    p_offset
  );
END;
$function$;

-- Categories are authenticated-only because the legacy club_categories table
-- has no anon read grant. The inner phone RPC is server-only so restricted
-- students cannot bypass the wrapper's account-restriction check.
REVOKE ALL ON FUNCTION public.get_phone_discovery_categories() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_phone_discovery_categories() TO authenticated;

REVOKE ALL ON FUNCTION public.get_phone_discovery_clubs__inner(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_phone_discovery_clubs__inner(uuid, text, integer, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_phone_discovery_clubs(uuid, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_phone_discovery_clubs(uuid, text, integer, integer)
  TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_phone_discovery_categories'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_phone_discovery_clubs__inner'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_phone_discovery_clubs'
  ) THEN
    RAISE EXCEPTION '126 phone discovery RPC registration incomplete';
  END IF;

  RAISE NOTICE '126 ok';
END
$$;
