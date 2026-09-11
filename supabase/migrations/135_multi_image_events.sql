-- ============================================================================
-- 135 — Ordered multi-image events
--
-- `events.cover_image_url` remains the position-0 public URL for old clients.
-- New clients write the complete ordered image set through
-- insert_event_images_with_dimensions after the existing direct event write.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.event_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  storage_path text NOT NULL CHECK (btrim(storage_path) <> ''),
  position     smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  width        integer,
  height       integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, position)
);

CREATE INDEX IF NOT EXISTS idx_event_images_event_position
  ON public.event_images(event_id, position);

ALTER TABLE public.event_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_images FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.event_images TO authenticated, service_role;

-- This is the same visibility predicate used by the final event relationship
-- policies. It includes public/member/specific visibility, creator and hosting
-- club officer exceptions, current-student access, and lifecycle visibility.
DROP POLICY IF EXISTS "event_images: viewers of the event can read" ON public.event_images;
CREATE POLICY "event_images: viewers of the event can read"
  ON public.event_images FOR SELECT TO authenticated
  USING (private.can_current_user_access_event(event_id));

-- Five distinct positions (0..4) already form a hard upper bound, but keep an
-- explicit trigger so the max-row invariant remains visible if the position
-- range is widened in a future migration.
CREATE OR REPLACE FUNCTION public.enforce_event_images_max_five()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    SELECT count(*)
      FROM public.event_images ei
     WHERE ei.event_id = NEW.event_id
       AND ei.id <> NEW.id
  ) >= 5 THEN
    RAISE EXCEPTION 'event_image_limit_exceeded' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_images_max_five ON public.event_images;
CREATE TRIGGER trg_event_images_max_five
  BEFORE INSERT OR UPDATE OF event_id ON public.event_images
  FOR EACH ROW EXECUTE FUNCTION public.enforce_event_images_max_five();

-- Old clients may still insert/update events directly. Keep cover_image_url
-- synchronized with position 0. Clearing the legacy cover clears the gallery;
-- this prevents a legacy single-image edit from leaving a stale multi-image
-- carousel behind.
CREATE OR REPLACE FUNCTION public.sync_event_image_position_zero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.cover_image_url IS NULL THEN
    DELETE FROM public.event_images
     WHERE event_id = NEW.id;
  ELSE
    INSERT INTO public.event_images (event_id, storage_path, position)
    VALUES (NEW.id, NEW.cover_image_url, 0)
    ON CONFLICT (event_id, position)
    DO UPDATE SET storage_path = EXCLUDED.storage_path;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_image_legacy_sync ON public.events;
CREATE TRIGGER trg_event_image_legacy_sync
  AFTER INSERT OR UPDATE OF cover_image_url ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_event_image_position_zero();

-- Every existing image event gets a position-0 row. `ON CONFLICT` makes this
-- safe to rerun in a shadow harness or during a repaired deployment.
INSERT INTO public.event_images (event_id, storage_path, position)
SELECT e.id, e.cover_image_url, 0
  FROM public.events e
 WHERE e.cover_image_url IS NOT NULL
ON CONFLICT (event_id, position) DO NOTHING;

-- Events are intentionally still created/updated by the existing direct
-- PostgREST writes. This helper is the narrow second step for media: its
-- array is the COMPLETE desired ordered set, so create and edit flows use the
-- same idempotent contract. It also refreshes cover_image_url to position 0
-- for old readers.
CREATE OR REPLACE FUNCTION public.insert_event_images_with_dimensions(
  p_event_id          uuid,
  p_image_paths       text[],
  p_image_dimensions  jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_club_id     uuid;
  v_paths       text[] := COALESCE(p_image_paths, ARRAY[]::text[]);
  v_index       integer;
  v_item        jsonb;
  v_width       integer;
  v_height      integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT e.club_id
    INTO v_club_id
    FROM public.events e
   WHERE e.id = p_event_id;

  -- This matches the final event write policies: the caller must currently be
  -- an officer of the hosting club, an active student, and editing content
  -- that is still student-visible. There is no creator-only write exception
  -- in the current events INSERT/UPDATE RLS contract.
  IF v_club_id IS NULL
     OR NOT public.is_club_officer(v_club_id)
     OR NOT public.current_student_can_access_app()
     OR NOT public.content_is_student_visible('event', p_event_id) THEN
    RAISE EXCEPTION 'event_officer_required' USING ERRCODE = '42501';
  END IF;

  IF cardinality(v_paths) > 5 THEN
    RAISE EXCEPTION 'event_requires_0_to_5_images' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_paths) path WHERE btrim(path) = '') THEN
    RAISE EXCEPTION 'image_path_required' USING ERRCODE = '22023';
  END IF;

  IF p_image_dimensions IS NOT NULL
     AND jsonb_typeof(p_image_dimensions) <> 'array' THEN
    RAISE EXCEPTION 'image_dimensions_must_be_array' USING ERRCODE = '22023';
  END IF;
  IF p_image_dimensions IS NOT NULL
     AND jsonb_array_length(p_image_dimensions) <> cardinality(v_paths) THEN
    RAISE EXCEPTION 'image_dimensions_must_match_image_paths' USING ERRCODE = '22023';
  END IF;

  -- Replacing the child set makes updates/removals deterministic and makes a
  -- retry with the same uploaded paths safe. The parent row remains governed
  -- by its existing direct-write RLS policies.
  DELETE FROM public.event_images
   WHERE event_id = p_event_id;

  FOR v_index IN 1..cardinality(v_paths) LOOP
    v_item := CASE
      WHEN p_image_dimensions IS NULL THEN '{}'::jsonb
      ELSE p_image_dimensions -> (v_index - 1)
    END;
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'image_dimension_item_must_be_object' USING ERRCODE = '22023';
    END IF;
    IF (v_item ? 'width') AND v_item->'width' <> 'null'
       AND jsonb_typeof(v_item->'width') <> 'number' THEN
      RAISE EXCEPTION 'image_width_must_be_number_or_null' USING ERRCODE = '22023';
    END IF;
    IF (v_item ? 'height') AND v_item->'height' <> 'null'
       AND jsonb_typeof(v_item->'height') <> 'number' THEN
      RAISE EXCEPTION 'image_height_must_be_number_or_null' USING ERRCODE = '22023';
    END IF;
    v_width := CASE WHEN (v_item ? 'width') AND v_item->'width' <> 'null'
      THEN (v_item->>'width')::integer ELSE NULL END;
    v_height := CASE WHEN (v_item ? 'height') AND v_item->'height' <> 'null'
      THEN (v_item->>'height')::integer ELSE NULL END;

    INSERT INTO public.event_images (event_id, storage_path, position, width, height)
    VALUES (p_event_id, v_paths[v_index], (v_index - 1)::smallint, v_width, v_height);
  END LOOP;

  UPDATE public.events
     SET cover_image_url = CASE
       WHEN cardinality(v_paths) > 0 THEN v_paths[1]
       ELSE NULL
     END
   WHERE id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_event_images_with_dimensions(uuid, text[], jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_event_images_with_dimensions(uuid, text[], jsonb)
  TO authenticated, service_role;

COMMENT ON TABLE public.event_images IS
  'Ordered event media, positions 0..4. events.cover_image_url is always the position-0 URL for legacy clients.';
COMMENT ON COLUMN public.event_images.storage_path IS
  'Reference in the existing events image storage bucket; current clients pass the canonical public URL.';
COMMENT ON FUNCTION public.insert_event_images_with_dimensions(uuid, text[], jsonb) IS
  'Officer-only complete replacement of an event image set; image_dimensions aligns with image_paths.';

COMMIT;
