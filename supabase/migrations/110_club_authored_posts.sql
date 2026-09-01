-- ============================================================================
-- 110 — Club-authored posts
--
-- `posts.author_id` is the existing acting-user/audit column. The contract's
-- `posts.user_id` name does not exist in this database. It is retained for both
-- student and club posts and is never exposed as the author of a club post.
-- `posts.club_id` already exists and is also used by the historical
-- student-authored "tag a club" feature; author_kind is the discriminator.
-- ============================================================================

BEGIN;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS author_kind text NOT NULL DEFAULT 'user';

-- Existing rows are all student-authored, including rows with a legacy
-- primary club tag. Do not clear posts.club_id: that relationship is the
-- existing tagged-club concept and is intentionally not converted.
UPDATE public.posts
   SET author_kind = 'user'
 WHERE author_kind IS NULL;

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_author_kind_check;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_author_kind_check
  CHECK (author_kind IN ('user', 'club'));

-- The column is NOT NULL above; this statement makes the invariant explicit
-- for environments where the column pre-existed with a weaker definition.
ALTER TABLE public.posts
  ALTER COLUMN author_kind SET NOT NULL,
  ALTER COLUMN author_kind SET DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_posts_author_kind_club_id
  ON public.posts(author_kind, club_id, created_at DESC);

-- RLS cannot use the Admin Dashboard's server-only environment allow-list.
-- Platform-admin Auth identities are instead recognized by the same immutable
-- service-role-only app_metadata marker used by the existing admin boundary.
CREATE OR REPLACE FUNCTION public.current_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM auth.users u
     WHERE u.id = auth.uid()
       AND public.is_platform_admin_auth(u.raw_app_meta_data)
  );
$$;

REVOKE ALL ON FUNCTION public.current_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_platform_admin() TO authenticated, service_role;

-- Direct client inserts can only create student-authored posts. Club-authored
-- rows enter through the SECURITY DEFINER RPC below, after the officer check.
DROP POLICY IF EXISTS "posts: authors can insert" ON public.posts;
CREATE POLICY "posts: authors can insert"
  ON public.posts FOR INSERT TO authenticated
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND author_kind = 'user'
  );

DROP POLICY IF EXISTS "posts: authors can update" ON public.posts;
CREATE POLICY "posts: authors can update"
  ON public.posts FOR UPDATE TO authenticated
  USING (
    (
      author_kind = 'club'
      AND (public.is_club_officer(club_id) OR (SELECT public.current_platform_admin()))
    )
    OR (
      public.content_is_student_visible('post', id)
      AND author_kind = 'user'
      AND author_id = (SELECT auth.uid())
      AND (SELECT public.current_student_can_access_app())
    )
  )
  WITH CHECK (
    (
      author_kind = 'user'
      AND author_id = (SELECT auth.uid())
      AND (SELECT public.current_student_can_access_app())
    )
    OR (
      author_kind = 'club'
      AND (public.is_club_officer(club_id) OR (SELECT public.current_platform_admin()))
    )
  );

DROP POLICY IF EXISTS "posts: authors can delete" ON public.posts;
CREATE POLICY "posts: authors can delete"
  ON public.posts FOR DELETE TO authenticated
  USING (
    (
      author_kind = 'club'
      AND (public.is_club_officer(club_id) OR (SELECT public.current_platform_admin()))
    )
    OR (
      public.content_is_student_visible('post', id)
      AND author_kind = 'user'
      AND author_id = (SELECT auth.uid())
      AND (SELECT public.current_student_can_access_app())
    )
  );

-- The RPC is deliberately the only authenticated insert path for club posts.
-- It returns a temporary full shape; migration 111 replaces this definition
-- once post_images exists and includes the ordered image rows.
CREATE OR REPLACE FUNCTION public.create_club_post(
  p_club_id uuid,
  p_image_paths text[],
  p_caption text
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

  INSERT INTO public.posts (author_id, club_id, author_kind, post_type, image_url, caption)
  VALUES (v_actor, p_club_id, 'club', 'picture', p_image_paths[1], NULLIF(btrim(p_caption), ''))
  RETURNING * INTO v_post;

  RETURN jsonb_build_object(
    'id', v_post.id,
    'image_url', v_post.image_url,
    'caption', v_post.caption,
    'created_at', v_post.created_at,
    'author_kind', 'club',
    'club', (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'avatar_url', c.avatar_url)
               FROM public.clubs c WHERE c.id = v_post.club_id),
    'images', to_jsonb(p_image_paths),
    'tagged_clubs', jsonb_build_array(),
    'likes_count', 0,
    'comments_count', 0,
    'user_has_liked', false,
    'author', jsonb_build_object(
      'id', v_post.club_id,
      'username', (SELECT c.name FROM public.clubs c WHERE c.id = v_post.club_id),
      'avatar_url', (SELECT c.avatar_url FROM public.clubs c WHERE c.id = v_post.club_id),
      'is_following', false,
      'is_requested', false,
      'follows_me', false,
      'profile_is_private', false
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_club_post(uuid, text[], text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_club_post(uuid, text[], text)
  TO authenticated, service_role;

COMMENT ON COLUMN public.posts.author_kind IS
  'Public author discriminator. user = posts.author_id; club = club_id, with author_id retained as the acting officer for audit.';
COMMENT ON COLUMN public.posts.author_id IS
  'Acting user/audit identity for both user and club-authored posts; do not expose as club-post author to non-admin viewers.';

COMMIT;
