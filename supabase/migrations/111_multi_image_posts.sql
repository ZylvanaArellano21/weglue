-- ============================================================================
-- 111 — Ordered multi-image posts
--
-- `posts.image_url` remains the position-0 public URL for old clients. New
-- clients read post_images in position order. The table stores the same
-- canonical URL string supplied by the existing `posts` storage bucket; the
-- column name is retained as the storage reference contract.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.post_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  storage_path text NOT NULL CHECK (btrim(storage_path) <> ''),
  position     smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  width        integer,
  height       integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, position)
);

CREATE INDEX IF NOT EXISTS idx_post_images_post_position
  ON public.post_images(post_id, position);

ALTER TABLE public.post_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.post_images FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.post_images TO authenticated, service_role;

DROP POLICY IF EXISTS "post_images: viewers of the post can read" ON public.post_images;
CREATE POLICY "post_images: viewers of the post can read"
  ON public.post_images FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_images.post_id));

-- Five distinct positions (0..4) already form a hard upper bound, but keep an
-- explicit trigger so the max-row invariant is visible and remains true if
-- the position range is ever widened in a future migration.
CREATE OR REPLACE FUNCTION public.enforce_post_images_max_five()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    SELECT count(*)
      FROM public.post_images pi
     WHERE pi.post_id = NEW.post_id
       AND pi.id <> NEW.id
  ) >= 5 THEN
    RAISE EXCEPTION 'post_image_limit_exceeded' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_images_max_five ON public.post_images;
CREATE TRIGGER trg_post_images_max_five
  BEFORE INSERT OR UPDATE OF post_id ON public.post_images
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_images_max_five();

-- Every existing image post gets a position-0 row. `ON CONFLICT` makes this
-- safe to rerun in a shadow harness or during a repaired deployment.
INSERT INTO public.post_images (post_id, storage_path, position)
SELECT p.id, p.image_url, 0
  FROM public.posts p
 WHERE p.image_url IS NOT NULL
ON CONFLICT (post_id, position) DO NOTHING;

-- Old clients may still insert/update posts directly. Keep image_url synced to
-- the position-0 image for all such writes, and let the RPCs insert positions
-- 1..4 in the same transaction.
CREATE OR REPLACE FUNCTION public.sync_post_image_position_zero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.image_url IS NOT NULL THEN
    INSERT INTO public.post_images (post_id, storage_path, position)
    VALUES (NEW.id, NEW.image_url, 0)
    ON CONFLICT (post_id, position)
    DO UPDATE SET storage_path = EXCLUDED.storage_path;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_image_legacy_sync ON public.posts;
CREATE TRIGGER trg_post_image_legacy_sync
  AFTER INSERT OR UPDATE OF image_url ON public.posts
  FOR EACH ROW
  WHEN (NEW.image_url IS NOT NULL)
  EXECUTE FUNCTION public.sync_post_image_position_zero();

-- Club-authored posts are represented directly by posts rows in the club
-- Photos feed. Legacy student-tagged posts continue to fan out into
-- club_photos; otherwise one club post would be returned twice.
CREATE OR REPLACE FUNCTION public.handle_post_tagged_club_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.author_kind = 'user' AND NEW.club_id IS NOT NULL AND NEW.image_url IS NOT NULL THEN
    INSERT INTO public.club_photos (club_id, url, uploaded_by, source, post_id, is_visible)
    VALUES (NEW.club_id, NEW.image_url, NEW.author_id, 'tagged_post', NEW.id, true)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_post_club_tag_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post public.posts%ROWTYPE;
BEGIN
  SELECT * INTO v_post FROM public.posts WHERE id = NEW.post_id;
  IF v_post.id IS NOT NULL
     AND v_post.author_kind = 'user'
     AND v_post.image_url IS NOT NULL THEN
    INSERT INTO public.club_photos (club_id, url, uploaded_by, source, post_id, is_visible)
    VALUES (NEW.club_id, v_post.image_url, v_post.author_id, 'tagged_post', v_post.id, true)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_feed_json(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post public.posts%ROWTYPE;
  v_club public.clubs%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_images jsonb;
  v_tags jsonb;
  v_author jsonb;
  v_club_json jsonb;
BEGIN
  SELECT * INTO v_post FROM public.posts WHERE id = p_post_id;
  IF v_post.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_club FROM public.clubs WHERE id = v_post.club_id;
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_post.author_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'path', pi.storage_path,
      'position', pi.position,
      'width', pi.width,
      'height', pi.height
    ) ORDER BY pi.position
  ), '[]'::jsonb)
    INTO v_images
    FROM public.post_images pi
   WHERE pi.post_id = v_post.id;

  IF v_post.author_kind = 'club' THEN
    v_tags := '[]'::jsonb;
    v_club_json := jsonb_build_object('id', v_club.id, 'name', v_club.name, 'avatar_url', v_club.avatar_url);
    v_author := jsonb_build_object(
      'id', v_club.id,
      'username', v_club.name,
      'avatar_url', v_club.avatar_url,
      'is_following', false,
      'is_requested', false,
      'follows_me', false,
      'profile_is_private', false
    );
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.name), '[]'::jsonb)
      INTO v_tags
      FROM (
        SELECT c.id, c.name
          FROM public.clubs c
         WHERE c.id = v_post.club_id
        UNION
        SELECT c.id, c.name
          FROM public.post_club_tags t
          JOIN public.clubs c ON c.id = t.club_id
         WHERE t.post_id = v_post.id
      ) x;
    v_club_json := NULL;
    v_author := jsonb_build_object(
      'id', v_profile.id,
      'username', v_profile.username,
      'avatar_url', v_profile.avatar_url,
      'is_following', false,
      'is_requested', false,
      'follows_me', false,
      'profile_is_private', false
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_post.id,
    'image_url', v_post.image_url,
    'caption', v_post.caption,
    'created_at', v_post.created_at,
    'author_kind', v_post.author_kind,
    'author', v_author,
    'club', v_club_json,
    'images', v_images,
    'tagged_clubs', v_tags,
    'likes_count', (SELECT count(*) FROM public.post_likes WHERE post_id = v_post.id),
    'comments_count', (SELECT count(*) FROM public.post_comments WHERE post_id = v_post.id),
    'user_has_liked', EXISTS (
      SELECT 1 FROM public.post_likes WHERE post_id = v_post.id AND user_id = auth.uid()
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_feed_json(uuid) FROM PUBLIC, anon, authenticated;

-- Replace the 110 bootstrap definition with the full ordered response now
-- that post_images and post_feed_json exist.
DROP FUNCTION IF EXISTS public.create_club_post(uuid, text[], text);
CREATE OR REPLACE FUNCTION public.create_club_post(
  p_club_id uuid,
  p_image_paths text[],
  p_caption text,
  p_client_tag uuid DEFAULT NULL
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
    SELECT * INTO v_post
      FROM public.posts
     WHERE author_id = v_actor AND client_tag = p_client_tag;
    IF v_post.id IS NULL THEN
      RAISE EXCEPTION 'post_create_conflict_unresolved' USING ERRCODE = '23505';
    END IF;
    RETURN public.post_feed_json(v_post.id);
  END IF;

  INSERT INTO public.post_images (post_id, storage_path, position)
  SELECT v_post.id, path, (ord - 1)::smallint
    FROM unnest(p_image_paths) WITH ORDINALITY AS u(path, ord)
  ON CONFLICT (post_id, position) DO UPDATE
    SET storage_path = EXCLUDED.storage_path;

  RETURN public.post_feed_json(v_post.id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_club_post(uuid, text[], text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_club_post(uuid, text[], text, uuid)
  TO authenticated, service_role;

-- One RPC supports both a student multi-image post and a club-authored post.
-- A NULL p_club_id never changes the existing tagged-club semantics: callers
-- add post_club_tags after this row is created and the author_kind stays user.
DROP FUNCTION IF EXISTS public.create_post(text, text[], uuid);
CREATE OR REPLACE FUNCTION public.create_post(
  p_caption text,
  p_image_paths text[],
  p_club_id uuid DEFAULT NULL,
  p_client_tag uuid DEFAULT NULL
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
    v_club_result := public.create_club_post(p_club_id, p_image_paths, p_caption, p_client_tag);
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
    SELECT * INTO v_post
      FROM public.posts
     WHERE author_id = v_actor AND client_tag = p_client_tag;
    IF v_post.id IS NULL THEN
      RAISE EXCEPTION 'post_create_conflict_unresolved' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'post_id', v_post.id,
      'post', public.post_feed_json(v_post.id)
    );
  END IF;

  INSERT INTO public.post_images (post_id, storage_path, position)
  SELECT v_post.id, path, (ord - 1)::smallint
    FROM unnest(p_image_paths) WITH ORDINALITY AS u(path, ord)
  ON CONFLICT (post_id, position) DO UPDATE
    SET storage_path = EXCLUDED.storage_path;

  RETURN jsonb_build_object('post_id', v_post.id, 'post', public.post_feed_json(v_post.id));
END;
$$;

REVOKE ALL ON FUNCTION public.create_post(text, text[], uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_post(text, text[], uuid, uuid) TO authenticated, service_role;

COMMENT ON TABLE public.post_images IS
  'Ordered post media, positions 0..4. posts.image_url is always the position-0 URL for legacy clients.';
COMMENT ON COLUMN public.post_images.storage_path IS
  'Reference in the existing posts storage bucket; current clients pass the canonical public URL.';

COMMIT;
