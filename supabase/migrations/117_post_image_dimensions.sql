-- ============================================================================
-- 117 — client-supplied post image dimensions
--
-- Migration 111 already contains these nullable columns in the current schema
-- snapshot. IF NOT EXISTS makes this migration safe for both a database that
-- includes that 111 definition and an older shadow database. No Storage
-- objects are read and existing rows remain NULL.
-- ============================================================================

BEGIN;

ALTER TABLE public.post_images
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer;

-- New callers can pass one JSON object per image, aligned with p_image_paths:
-- [{"width": 1080, "height": 1350}, {"width": null, "height": null}].
-- The existing four-argument identities are replaced with a trailing defaulted
-- parameter, so old named-argument PostgREST calls remain valid.
CREATE OR REPLACE FUNCTION public.insert_post_images_with_dimensions(
  p_post_id          uuid,
  p_image_paths      text[],
  p_image_dimensions jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_index integer;
  v_item jsonb;
  v_width integer;
  v_height integer;
BEGIN
  IF p_image_dimensions IS NOT NULL AND jsonb_typeof(p_image_dimensions) <> 'array' THEN
    RAISE EXCEPTION 'image_dimensions_must_be_array' USING ERRCODE = '22023';
  END IF;
  IF p_image_dimensions IS NOT NULL
     AND jsonb_array_length(p_image_dimensions) <> cardinality(p_image_paths) THEN
    RAISE EXCEPTION 'image_dimensions_must_match_image_paths' USING ERRCODE = '22023';
  END IF;

  FOR v_index IN 1..cardinality(p_image_paths) LOOP
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

    INSERT INTO public.post_images (post_id, storage_path, position, width, height)
    VALUES (p_post_id, p_image_paths[v_index], (v_index - 1)::smallint, v_width, v_height)
    ON CONFLICT (post_id, position) DO UPDATE
      SET storage_path = EXCLUDED.storage_path,
          width = EXCLUDED.width,
          height = EXCLUDED.height;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_post_images_with_dimensions(uuid, text[], jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.insert_post_images_with_dimensions(uuid, text[], jsonb) IS
  'Internal helper for dimension-aware post creation; not a client RPC.';

-- Replace the 111 functions rather than leaving divergent overloads behind.
DROP FUNCTION public.create_club_post(uuid, text[], text, uuid);
CREATE OR REPLACE FUNCTION public.create_club_post(
  p_club_id         uuid,
  p_image_paths     text[],
  p_caption         text,
  p_client_tag      uuid DEFAULT NULL,
  p_image_dimensions jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post public.posts%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'club_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.club_members
     WHERE club_id = p_club_id AND user_id = v_actor AND role = 'officer'
  ) THEN
    RAISE EXCEPTION 'club_officer_required' USING ERRCODE = '42501';
  END IF;
  IF p_image_paths IS NULL OR cardinality(p_image_paths) NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'club_post_requires_1_to_5_images' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_image_paths) path WHERE btrim(path) = '') THEN
    RAISE EXCEPTION 'image_path_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.posts (author_id, club_id, author_kind, post_type, image_url, caption, client_tag)
  VALUES (v_actor, p_club_id, 'club', 'picture', p_image_paths[1], NULLIF(btrim(p_caption), ''), p_client_tag)
  ON CONFLICT (author_id, client_tag) WHERE client_tag IS NOT NULL DO NOTHING
  RETURNING * INTO v_post;

  -- A retry with the same compose tag returns the original post, including
  -- its already-persisted ordered images, instead of creating a duplicate.
  IF v_post.id IS NULL THEN
    SELECT * INTO v_post FROM public.posts
     WHERE author_id = v_actor AND client_tag = p_client_tag;
    IF v_post.id IS NULL THEN
      RAISE EXCEPTION 'post_create_conflict_unresolved' USING ERRCODE = '23505';
    END IF;
    RETURN public.post_feed_json(v_post.id);
  END IF;

  PERFORM public.insert_post_images_with_dimensions(v_post.id, p_image_paths, p_image_dimensions);
  RETURN public.post_feed_json(v_post.id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_club_post(uuid, text[], text, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_club_post(uuid, text[], text, uuid, jsonb)
  TO authenticated, service_role;

DROP FUNCTION public.create_post(text, text[], uuid, uuid);
CREATE OR REPLACE FUNCTION public.create_post(
  p_caption          text,
  p_image_paths      text[],
  p_club_id          uuid DEFAULT NULL,
  p_client_tag       uuid DEFAULT NULL,
  p_image_dimensions jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post public.posts%ROWTYPE;
  v_actor uuid := auth.uid();
  v_club_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_club_id IS NOT NULL THEN
    v_club_result := public.create_club_post(
      p_club_id, p_image_paths, p_caption, p_client_tag, p_image_dimensions
    );
    RETURN jsonb_build_object(
      'post_id', (v_club_result->>'id')::uuid,
      'post', v_club_result
    );
  END IF;
  IF p_image_paths IS NULL OR cardinality(p_image_paths) NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'post_requires_1_to_5_images' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_image_paths) path WHERE btrim(path) = '') THEN
    RAISE EXCEPTION 'image_path_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.posts (author_id, club_id, author_kind, post_type, image_url, caption, client_tag)
  VALUES (v_actor, NULL, 'user', 'picture', p_image_paths[1], NULLIF(btrim(p_caption), ''), p_client_tag)
  ON CONFLICT (author_id, client_tag) WHERE client_tag IS NOT NULL DO NOTHING
  RETURNING * INTO v_post;

  -- The same client tag is the same logical post. Reuse its complete feed
  -- shape, including the ordered image rows written by the first attempt.
  IF v_post.id IS NULL THEN
    SELECT * INTO v_post FROM public.posts
     WHERE author_id = v_actor AND client_tag = p_client_tag;
    IF v_post.id IS NULL THEN
      RAISE EXCEPTION 'post_create_conflict_unresolved' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'post_id', v_post.id,
      'post', public.post_feed_json(v_post.id)
    );
  END IF;

  PERFORM public.insert_post_images_with_dimensions(v_post.id, p_image_paths, p_image_dimensions);
  RETURN jsonb_build_object('post_id', v_post.id, 'post', public.post_feed_json(v_post.id));
END;
$$;

REVOKE ALL ON FUNCTION public.create_post(text, text[], uuid, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_post(text, text[], uuid, uuid, jsonb)
  TO authenticated, service_role;

COMMENT ON COLUMN public.post_images.width IS
  'Optional client-supplied source pixel width; existing rows remain NULL.';
COMMENT ON COLUMN public.post_images.height IS
  'Optional client-supplied source pixel height; existing rows remain NULL.';

COMMIT;
