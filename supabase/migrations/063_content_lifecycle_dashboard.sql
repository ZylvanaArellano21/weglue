-- =============================================================================
-- 063 — Day 10C dashboard content lifecycle foundation
--
-- Posts, post comments and events have a small, administrator-only lifecycle
-- record. The record is deliberately separate from student-readable content so
-- internal removal/restoration reasons never become a public column. This
-- migration provides only remove/restore and read-only future-purge status;
-- it does NOT create a purge request, worker, Edge Function, scheduler or
-- secret.
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- A row is created only after an item leaves its original active state. Rows
-- remain after restoration and creator deletion so the private dashboard can
-- distinguish restored content and retain the minimum approved metadata.
CREATE TABLE IF NOT EXISTS public.content_lifecycle (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type               text NOT NULL CHECK (entity_type IN ('post', 'comment', 'event')),
  entity_id                 uuid NOT NULL,
  state                     text NOT NULL CHECK (state IN (
                              'active', 'removed', 'creator_deleted',
                              'purge_pending', 'purge_failed', 'purged'
                            )),
  -- Structural-only snapshot. There is intentionally no body, title,
  -- description, image URL, media path, or internal reason in this table.
  owner_id                  uuid,
  club_id                   uuid,
  content_created_at        timestamptz,
  removed_at                timestamptz,
  removed_by                uuid,
  removal_correlation_id    uuid,
  restored_at               timestamptz,
  restored_by               uuid,
  restoration_correlation_id uuid,
  creator_deleted_at        timestamptz,
  purge_requested_at        timestamptz,
  purge_completed_at        timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_lifecycle_one_row_per_entity UNIQUE (entity_type, entity_id),
  CONSTRAINT content_lifecycle_removed_evidence CHECK (
    state NOT IN ('removed', 'purge_pending', 'purge_failed', 'purged')
    OR (removed_at IS NOT NULL AND removed_by IS NOT NULL)
  ),
  CONSTRAINT content_lifecycle_creator_delete_evidence CHECK (
    state <> 'creator_deleted' OR creator_deleted_at IS NOT NULL
  ),
  CONSTRAINT content_lifecycle_purge_evidence CHECK (
    state NOT IN ('purge_pending', 'purge_failed', 'purged') OR purge_requested_at IS NOT NULL
  ),
  CONSTRAINT content_lifecycle_purged_evidence CHECK (
    state <> 'purged' OR purge_completed_at IS NOT NULL
  )
);

COMMENT ON TABLE public.content_lifecycle IS
  'Private lifecycle metadata for posts, post comments and events. No content body or media is retained here. No foreign keys preserve approved administrative history after canonical rows disappear.';

CREATE INDEX IF NOT EXISTS content_lifecycle_state_updated_idx
  ON public.content_lifecycle (state, updated_at DESC);
CREATE INDEX IF NOT EXISTS content_lifecycle_owner_updated_idx
  ON public.content_lifecycle (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS content_lifecycle_removal_correlation_idx
  ON public.content_lifecycle (removal_correlation_id)
  WHERE removal_correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_lifecycle_restoration_correlation_idx
  ON public.content_lifecycle (restoration_correlation_id)
  WHERE restoration_correlation_id IS NOT NULL;

ALTER TABLE public.content_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_lifecycle FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_lifecycle FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.content_lifecycle TO service_role;

-- Service-role-only dashboard read model. It deliberately exposes structural
-- identifiers and lifecycle timestamps only; captions, comment bodies, event
-- descriptions and media URLs remain on their canonical rows and are never
-- copied into lifecycle metadata. The final UNION keeps forward-compatible
-- history visible after a creator deletion or a future permitted purge removes
-- the canonical row.
CREATE OR REPLACE VIEW public.admin_content_lifecycle_records
WITH (security_invoker = true)
AS
  SELECT
    'post'::text AS entity_type,
    p.id AS entity_id,
    p.author_id AS owner_id,
    p.club_id,
    p.created_at AS content_created_at,
    COALESCE(cl.state, 'active') AS state,
    cl.removed_at,
    cl.removed_by,
    cl.removal_correlation_id,
    cl.restored_at,
    cl.restored_by,
    cl.restoration_correlation_id,
    cl.creator_deleted_at,
    cl.purge_requested_at,
    cl.purge_completed_at,
    cl.updated_at AS lifecycle_updated_at
  FROM public.posts p
  LEFT JOIN public.content_lifecycle cl
    ON cl.entity_type = 'post' AND cl.entity_id = p.id
  UNION ALL
  SELECT
    'comment'::text,
    c.id,
    c.user_id,
    NULL::uuid,
    c.created_at,
    COALESCE(cl.state, 'active'),
    cl.removed_at,
    cl.removed_by,
    cl.removal_correlation_id,
    cl.restored_at,
    cl.restored_by,
    cl.restoration_correlation_id,
    cl.creator_deleted_at,
    cl.purge_requested_at,
    cl.purge_completed_at,
    cl.updated_at
  FROM public.post_comments c
  LEFT JOIN public.content_lifecycle cl
    ON cl.entity_type = 'comment' AND cl.entity_id = c.id
  UNION ALL
  SELECT
    'event'::text,
    e.id,
    e.created_by,
    e.club_id,
    e.created_at,
    COALESCE(cl.state, 'active'),
    cl.removed_at,
    cl.removed_by,
    cl.removal_correlation_id,
    cl.restored_at,
    cl.restored_by,
    cl.restoration_correlation_id,
    cl.creator_deleted_at,
    cl.purge_requested_at,
    cl.purge_completed_at,
    cl.updated_at
  FROM public.events e
  LEFT JOIN public.content_lifecycle cl
    ON cl.entity_type = 'event' AND cl.entity_id = e.id
  UNION ALL
  SELECT
    cl.entity_type,
    cl.entity_id,
    cl.owner_id,
    cl.club_id,
    cl.content_created_at,
    cl.state,
    cl.removed_at,
    cl.removed_by,
    cl.removal_correlation_id,
    cl.restored_at,
    cl.restored_by,
    cl.restoration_correlation_id,
    cl.creator_deleted_at,
    cl.purge_requested_at,
    cl.purge_completed_at,
    cl.updated_at
  FROM public.content_lifecycle cl
  WHERE (cl.entity_type = 'post' AND NOT EXISTS (
           SELECT 1 FROM public.posts p WHERE p.id = cl.entity_id
         ))
     OR (cl.entity_type = 'comment' AND NOT EXISTS (
           SELECT 1 FROM public.post_comments c WHERE c.id = cl.entity_id
         ))
     OR (cl.entity_type = 'event' AND NOT EXISTS (
           SELECT 1 FROM public.events e WHERE e.id = cl.entity_id
         ));

REVOKE ALL ON public.admin_content_lifecycle_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.admin_content_lifecycle_records TO service_role;

CREATE OR REPLACE FUNCTION private.content_lifecycle_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_lifecycle_touch ON public.content_lifecycle;
CREATE TRIGGER content_lifecycle_touch
  BEFORE UPDATE ON public.content_lifecycle
  FOR EACH ROW EXECUTE FUNCTION private.content_lifecycle_touch();

-- This is an id-scoped predicate, not a listing API. It is granted only so
-- RLS policies and existing security-invoker helpers can use it. The table it
-- reads has no authenticated policies or table grants.
CREATE OR REPLACE FUNCTION public.content_is_student_visible(
  p_entity_type text,
  p_entity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM public.content_lifecycle cl
     WHERE cl.entity_type = p_entity_type
       AND cl.entity_id = p_entity_id
       AND cl.state IN ('removed', 'creator_deleted', 'purge_pending', 'purge_failed', 'purged')
  );
$$;

REVOKE ALL ON FUNCTION public.content_is_student_visible(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.content_is_student_visible(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.content_state(p_entity_type text, p_entity_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT cl.state FROM public.content_lifecycle cl
      WHERE cl.entity_type = p_entity_type AND cl.entity_id = p_entity_id),
    'active'
  );
$$;

CREATE OR REPLACE FUNCTION private.content_owner_snapshot(p_entity_type text, p_entity_id uuid)
RETURNS TABLE (owner_id uuid, club_id uuid, content_created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.author_id, p.club_id, p.created_at
    FROM public.posts p
   WHERE p_entity_type = 'post' AND p.id = p_entity_id
  UNION ALL
  SELECT c.user_id, NULL::uuid, c.created_at
    FROM public.post_comments c
   WHERE p_entity_type = 'comment' AND c.id = p_entity_id
  UNION ALL
  SELECT e.created_by, e.club_id, e.created_at
    FROM public.events e
   WHERE p_entity_type = 'event' AND e.id = p_entity_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.content_lifecycle_snapshot(p_entity_type text, p_entity_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'entityType', p_entity_type,
    'entityId', p_entity_id,
    'state', private.content_state(p_entity_type, p_entity_id),
    'ownerId', s.owner_id,
    'clubId', s.club_id,
    'contentCreatedAt', s.content_created_at
  ))
  FROM private.content_owner_snapshot(p_entity_type, p_entity_id) s;
$$;

CREATE OR REPLACE FUNCTION private.content_reason_ok(p_reason text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT char_length(btrim(COALESCE(p_reason, ''))) BETWEEN 3 AND 500;
$$;

CREATE OR REPLACE FUNCTION private.content_lifecycle_lock(p_entity_type text, p_entity_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_advisory_xact_lock(
    hashtextextended('we_glue_content_lifecycle:' || p_entity_type || ':' || p_entity_id::text, 0)
  );
$$;

-- Forward-only creator deletion evidence. This trigger never retains deleted
-- text or media. It records only a direct creator deletion (not account
-- deletion, service-role cleanup, or a parent-post cascade onto comments).
CREATE OR REPLACE FUNCTION private.record_creator_content_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entity_type text := TG_ARGV[0];
  v_owner_id uuid;
  v_club_id uuid;
  v_created_at timestamptz;
BEGIN
  IF v_entity_type = 'post' THEN
    v_owner_id := OLD.author_id;
    v_club_id := OLD.club_id;
    v_created_at := OLD.created_at;
  ELSIF v_entity_type = 'comment' THEN
    v_owner_id := OLD.user_id;
    v_created_at := OLD.created_at;
    -- A creator deleting a post causes the database to cascade its comments.
    -- Those comments were not deleted by their own creators, so do not label
    -- their distinct authors as the deleting actor.
    IF EXISTS (
      SELECT 1 FROM public.content_lifecycle parent
       WHERE parent.entity_type = 'post'
         AND parent.entity_id = OLD.post_id
         AND parent.state = 'creator_deleted'
    ) THEN
      RETURN OLD;
    END IF;
  ELSIF v_entity_type = 'event' THEN
    v_owner_id := OLD.created_by;
    v_club_id := OLD.club_id;
    v_created_at := OLD.created_at;
  ELSE
    RAISE EXCEPTION 'invalid lifecycle entity type' USING ERRCODE = '22023';
  END IF;

  -- The existing RLS policies authorize a browser deletion. The trigger is
  -- intentionally narrower: an officer deleting another officer's event is
  -- not misrepresented as a creator deletion, and service-role/account-delete
  -- paths retain their existing behavior.
  IF (SELECT auth.uid()) IS NULL OR v_owner_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN OLD;
  END IF;

  PERFORM private.content_lifecycle_lock(v_entity_type, OLD.id);

  INSERT INTO public.content_lifecycle (
    entity_type, entity_id, state, owner_id, club_id, content_created_at, creator_deleted_at
  ) VALUES (
    v_entity_type, OLD.id, 'creator_deleted', v_owner_id, v_club_id, v_created_at, now()
  )
  ON CONFLICT (entity_type, entity_id) DO UPDATE
    SET state = 'creator_deleted',
        owner_id = COALESCE(public.content_lifecycle.owner_id, EXCLUDED.owner_id),
        club_id = COALESCE(public.content_lifecycle.club_id, EXCLUDED.club_id),
        content_created_at = COALESCE(public.content_lifecycle.content_created_at, EXCLUDED.content_created_at),
        creator_deleted_at = now();

  -- This is a creator action, not an administrator action, but it belongs in
  -- the same append-only lifecycle evidence. There is no content snapshot or
  -- creator-supplied reason, and a refused audit write aborts the deletion.
  PERFORM public.admin_audit_log(
    p_actor_user_id  => v_owner_id,
    p_actor_email    => NULL,
    p_action         => v_entity_type || '.creatorDelete',
    p_target_type    => v_entity_type,
    p_target_id      => OLD.id,
    p_after_state    => private.content_lifecycle_snapshot(v_entity_type, OLD.id),
    p_metadata       => jsonb_build_object('entityType', v_entity_type, 'entityId', OLD.id),
    p_correlation_id => gen_random_uuid(),
    p_event_type     => 'success'
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS content_lifecycle_creator_post_delete ON public.posts;
CREATE TRIGGER content_lifecycle_creator_post_delete
  BEFORE DELETE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION private.record_creator_content_delete('post');

DROP TRIGGER IF EXISTS content_lifecycle_creator_comment_delete ON public.post_comments;
CREATE TRIGGER content_lifecycle_creator_comment_delete
  BEFORE DELETE ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION private.record_creator_content_delete('comment');

DROP TRIGGER IF EXISTS content_lifecycle_creator_event_delete ON public.events;
CREATE TRIGGER content_lifecycle_creator_event_delete
  BEFORE DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION private.record_creator_content_delete('event');

-- -----------------------------------------------------------------------------
-- Student visibility. Existing access rules remain intact; every policy below
-- gains one additional AND condition. Recreating both post SELECT policies is
-- deliberate: PostgreSQL combines permissive policies with OR, so updating only
-- one of the two current policies would leave removed posts visible.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "posts: authenticated read, block-aware" ON public.posts;
CREATE POLICY "posts: authenticated read, block-aware"
  ON public.posts FOR SELECT TO authenticated
  USING (
    public.content_is_student_visible('post', id)
    AND (
      club_id IS NOT NULL
      OR author_id = (SELECT auth.uid())
      OR author_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
    )
  );

DROP POLICY IF EXISTS "posts: read respecting private accounts" ON public.posts;
CREATE POLICY "posts: read respecting private accounts"
  ON public.posts FOR SELECT TO authenticated
  USING (
    public.content_is_student_visible('post', id)
    AND (
      author_id = (SELECT auth.uid())
      OR club_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.user_privacy up
         WHERE up.user_id = posts.author_id AND up.is_private
      )
      OR EXISTS (
        SELECT 1 FROM public.follows f
         WHERE f.follower_id = (SELECT auth.uid())
           AND f.following_id = posts.author_id
           AND f.status = 'accepted'
      )
    )
  );

DROP POLICY IF EXISTS "posts: authors can update" ON public.posts;
CREATE POLICY "posts: authors can update"
  ON public.posts FOR UPDATE TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('post', id)
  )
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('post', id)
  );

DROP POLICY IF EXISTS "posts: authors can delete" ON public.posts;
CREATE POLICY "posts: authors can delete"
  ON public.posts FOR DELETE TO authenticated
  USING (
    author_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('post', id)
  );

DROP POLICY IF EXISTS "post_comments: authenticated read, block-aware" ON public.post_comments;
CREATE POLICY "post_comments: authenticated read, block-aware"
  ON public.post_comments FOR SELECT TO authenticated
  USING (
    public.content_is_student_visible('comment', id)
    AND public.content_is_student_visible('post', post_id)
    AND (
      user_id = (SELECT auth.uid())
      OR user_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
    )
  );

DROP POLICY IF EXISTS "post_comments: users insert own" ON public.post_comments;
CREATE POLICY "post_comments: users insert own"
  ON public.post_comments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.content_is_student_visible('post', post_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_comments.post_id
         AND p.author_id = ANY ((SELECT public.blocked_user_ids())::uuid[])
    )
    AND (SELECT public.current_student_can_access_app())
  );

DROP POLICY IF EXISTS "post_comments: users delete own" ON public.post_comments;
CREATE POLICY "post_comments: users delete own"
  ON public.post_comments FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('comment', id)
    AND public.content_is_student_visible('post', post_id)
  );

DROP POLICY IF EXISTS "post_likes: authenticated read, block-aware" ON public.post_likes;
CREATE POLICY "post_likes: authenticated read, block-aware"
  ON public.post_likes FOR SELECT TO authenticated
  USING (
    public.content_is_student_visible('post', post_id)
    AND (
      user_id = (SELECT auth.uid())
      OR user_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
    )
  );

DROP POLICY IF EXISTS "post_likes: users manage own" ON public.post_likes;
CREATE POLICY "post_likes: users manage own"
  ON public.post_likes FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('post', post_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.content_is_student_visible('post', post_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_likes.post_id
         AND p.author_id = ANY ((SELECT public.blocked_user_ids())::uuid[])
    )
    AND (SELECT public.current_student_can_access_app())
  );

DROP POLICY IF EXISTS post_club_tags_select_public ON public.post_club_tags;
CREATE POLICY post_club_tags_select_public
  ON public.post_club_tags FOR SELECT TO authenticated
  USING (public.content_is_student_visible('post', post_id));

DROP POLICY IF EXISTS post_club_tags_insert_own ON public.post_club_tags;
CREATE POLICY post_club_tags_insert_own
  ON public.post_club_tags FOR INSERT TO authenticated
  WITH CHECK (
    public.content_is_student_visible('post', post_id)
    AND EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_club_tags.post_id AND p.author_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS post_club_tags_delete_own ON public.post_club_tags;
CREATE POLICY post_club_tags_delete_own
  ON public.post_club_tags FOR DELETE TO authenticated
  USING (
    public.content_is_student_visible('post', post_id)
    AND EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_club_tags.post_id AND p.author_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "club_photos: anyone can read visible" ON public.club_photos;
CREATE POLICY "club_photos: anyone can read visible"
  ON public.club_photos FOR SELECT TO authenticated
  USING (
    (is_visible = true OR is_club_officer(club_id))
    AND (post_id IS NULL OR public.content_is_student_visible('post', post_id))
  );

DROP POLICY IF EXISTS "club_photos: officers can insert" ON public.club_photos;
CREATE POLICY "club_photos: officers can insert"
  ON public.club_photos FOR INSERT TO authenticated
  WITH CHECK (
    is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
    AND (post_id IS NULL OR public.content_is_student_visible('post', post_id))
  );

DROP POLICY IF EXISTS "club_photos: officers can update" ON public.club_photos;
CREATE POLICY "club_photos: officers can update"
  ON public.club_photos FOR UPDATE TO authenticated
  USING (
    is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
    AND (post_id IS NULL OR public.content_is_student_visible('post', post_id))
  )
  WITH CHECK (
    is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
    AND (post_id IS NULL OR public.content_is_student_visible('post', post_id))
  );

DROP POLICY IF EXISTS "club_photos: officers can delete" ON public.club_photos;
CREATE POLICY "club_photos: officers can delete"
  ON public.club_photos FOR DELETE TO authenticated
  USING (
    is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
    AND (post_id IS NULL OR public.content_is_student_visible('post', post_id))
  );

DROP POLICY IF EXISTS "events: visibility-aware read" ON public.events;
CREATE POLICY "events: visibility-aware read"
  ON public.events FOR SELECT TO authenticated
  USING (
    public.content_is_student_visible('event', id)
    AND (
      visibility = 'everyone'
      OR created_by = (SELECT auth.uid())
      OR is_club_officer(club_id)
      OR (
        visibility = 'members'
        AND EXISTS (
          SELECT 1 FROM public.club_members
           WHERE club_id = events.club_id AND user_id = (SELECT auth.uid())
        )
      )
      OR (
        visibility = 'specific'
        AND specific_user_ids IS NOT NULL
        AND (SELECT auth.uid()) = ANY (specific_user_ids)
      )
    )
  );

DROP POLICY IF EXISTS "events: officers can update/delete" ON public.events;
CREATE POLICY "events: officers can update/delete"
  ON public.events FOR UPDATE TO authenticated
  USING (
    is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('event', id)
  )
  WITH CHECK (
    is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('event', id)
  );

DROP POLICY IF EXISTS "events: officers can delete" ON public.events;
CREATE POLICY "events: officers can delete"
  ON public.events FOR DELETE TO authenticated
  USING (
    is_club_officer(club_id)
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('event', id)
  );

DROP POLICY IF EXISTS "event_rsvps: read respecting hide_events" ON public.event_rsvps;
CREATE POLICY "event_rsvps: read respecting hide_events"
  ON public.event_rsvps FOR SELECT TO authenticated
  USING (
    public.content_is_student_visible('event', event_id)
    AND (
      user_id = (SELECT auth.uid())
      OR NOT EXISTS (
        SELECT 1 FROM public.user_privacy up
         WHERE up.user_id = event_rsvps.user_id AND up.hide_events = true
      )
    )
  );

DROP POLICY IF EXISTS "event_rsvps: users manage own" ON public.event_rsvps;
CREATE POLICY "event_rsvps: users manage own"
  ON public.event_rsvps FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('event', event_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('event', event_id)
  );

DROP POLICY IF EXISTS "saved_events: users manage own" ON public.saved_events;
CREATE POLICY "saved_events: users manage own"
  ON public.saved_events FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('event', event_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (SELECT public.current_student_can_access_app())
    AND public.content_is_student_visible('event', event_id)
  );

DROP POLICY IF EXISTS "event_activities: anyone authenticated can read" ON public.event_activities;
CREATE POLICY "event_activities: anyone authenticated can read"
  ON public.event_activities FOR SELECT TO authenticated
  USING (public.content_is_student_visible('event', event_id));

DROP POLICY IF EXISTS "event_activities: officers can manage" ON public.event_activities;
CREATE POLICY "event_activities: officers can manage"
  ON public.event_activities FOR ALL TO authenticated
  USING (
    public.content_is_student_visible('event', event_id)
    AND EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = event_activities.event_id AND is_club_officer(e.club_id)
    )
    AND (SELECT public.current_student_can_access_app())
  )
  WITH CHECK (
    public.content_is_student_visible('event', event_id)
    AND EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = event_activities.event_id AND is_club_officer(e.club_id)
    )
    AND (SELECT public.current_student_can_access_app())
  );

DROP POLICY IF EXISTS "event_interests: anyone authenticated can read" ON public.event_interests;
CREATE POLICY "event_interests: anyone authenticated can read"
  ON public.event_interests FOR SELECT TO authenticated
  USING (public.content_is_student_visible('event', event_id));

DROP POLICY IF EXISTS "event_interests: officers can manage" ON public.event_interests;
CREATE POLICY "event_interests: officers can manage"
  ON public.event_interests FOR ALL TO authenticated
  USING (
    public.content_is_student_visible('event', event_id)
    AND EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = event_interests.event_id AND is_club_officer(e.club_id)
    )
    AND (SELECT public.current_student_can_access_app())
  )
  WITH CHECK (
    public.content_is_student_visible('event', event_id)
    AND EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = event_interests.event_id AND is_club_officer(e.club_id)
    )
    AND (SELECT public.current_student_can_access_app())
  );

-- Existing notifications may contain event titles or point a student straight
-- to a post/event that is now unavailable. Retain the canonical notification
-- row, but hide lifecycle-targeted notifications from student reads while the
-- content is removed. Other notification target types keep their existing
-- block-aware policy unchanged.
DROP POLICY IF EXISTS "notifications: users read own, block-aware" ON public.notifications;
CREATE POLICY "notifications: users read own, block-aware"
  ON public.notifications FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND (
      actor_id IS NULL
      OR actor_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
      OR type <> ALL ((SELECT public.blockable_notification_types())::text[])
    )
    AND (
      entity_type IS NULL
      OR entity_type NOT IN ('post', 'comment', 'event')
      OR entity_id IS NULL
      OR public.content_is_student_visible(entity_type, entity_id)
    )
  );

-- The discovery implementation was renamed by 058 and runs SECURITY DEFINER,
-- so it must enforce lifecycle visibility itself rather than rely on RLS.
CREATE OR REPLACE FUNCTION public.get_discovery_events__inner(
  p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, title text, emoji text, event_date date, start_time time without time zone,
  end_time time without time zone, location text, cover_image_url text, club_id uuid,
  club_name text, club_avatar_url text, member_count integer, is_saved boolean,
  user_rsvp_status text, match_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me uuid := public.assert_self_or_null(p_user_id);
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.title, e.emoji, e.event_date, e.start_time, e.end_time, e.location,
    e.cover_image_url, e.club_id, c.name, c.avatar_url, c.member_count,
    EXISTS(SELECT 1 FROM public.saved_events se
            WHERE se.user_id = v_me AND se.event_id = e.id) AS is_saved,
    (SELECT er.status::text FROM public.event_rsvps er
      WHERE er.user_id = v_me AND er.event_id = e.id LIMIT 1) AS user_rsvp_status,
    (SELECT count(DISTINCT ea.activity)::int FROM public.event_activities ea
      WHERE ea.event_id = e.id
        AND EXISTS (SELECT 1 FROM public.user_activities ua
                     WHERE ua.user_id = v_me AND ua.activity = ea.activity)) AS match_count
  FROM public.events e
  JOIN public.clubs c ON c.id = e.club_id
  WHERE e.event_date >= CURRENT_DATE
    AND c.is_active = true
    AND public.content_is_student_visible('event', e.id)
    AND (
      e.visibility = 'everyone'
      OR (e.visibility = 'members'
          AND EXISTS (SELECT 1 FROM public.club_members cm
                       WHERE cm.club_id = e.club_id AND cm.user_id = v_me))
      OR (e.visibility = 'specific' AND v_me = ANY(e.specific_user_ids))
    )
  ORDER BY match_count DESC, e.event_date ASC, e.start_time ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.get_discovery_events__inner(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_discovery_events__inner(uuid, integer, integer) TO service_role;

-- get_discovery_people is also a 058 wrapped SECURITY DEFINER read. Its
-- "most active club" fallback must not derive a club label from a removed post
-- while RLS is bypassed.
CREATE OR REPLACE FUNCTION public.get_discovery_people__inner(p_user_id uuid)
RETURNS TABLE(user_id uuid, username text, full_name text, avatar_url text, club_name text, club_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me      uuid   := public.assert_self_or_null(p_user_id);
  v_blocked uuid[] := public.blocked_user_ids();
BEGIN
  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.username,
    p.full_name,
    p.avatar_url,
    COALESCE(
      (SELECT c.name FROM public.club_officers co
         JOIN public.clubs c ON c.id = co.club_id
        WHERE co.user_id = p.id AND c.is_active = true LIMIT 1),
      (SELECT c.name FROM public.posts pt
         JOIN public.clubs c ON c.id = pt.club_id
        WHERE pt.author_id = p.id AND pt.club_id IS NOT NULL AND c.is_active = true
          AND public.content_is_student_visible('post', pt.id)
        ORDER BY pt.created_at DESC LIMIT 1),
      (SELECT c.name FROM public.club_members clm
         JOIN public.clubs c ON c.id = clm.club_id
        WHERE clm.user_id = p.id AND c.is_active = true
        ORDER BY clm.joined_at DESC LIMIT 1)
    ) AS club_name,
    COALESCE(
      (SELECT co.club_id FROM public.club_officers co
         JOIN public.clubs c ON c.id = co.club_id
        WHERE co.user_id = p.id AND c.is_active = true LIMIT 1),
      (SELECT pt.club_id FROM public.posts pt
         JOIN public.clubs c ON c.id = pt.club_id
        WHERE pt.author_id = p.id AND pt.club_id IS NOT NULL AND c.is_active = true
          AND public.content_is_student_visible('post', pt.id)
        ORDER BY pt.created_at DESC LIMIT 1),
      (SELECT clm.club_id FROM public.club_members clm
         JOIN public.clubs c ON c.id = clm.club_id
        WHERE clm.user_id = p.id AND c.is_active = true
        ORDER BY clm.joined_at DESC LIMIT 1)
    ) AS club_id
  FROM public.profiles p
  WHERE p.id <> v_me
    AND p.id <> ALL (v_blocked)
  ORDER BY RANDOM()
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.get_discovery_people__inner(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_discovery_people__inner(uuid) TO service_role;

-- Existing 058 wrappers are preserved and gain the lifecycle guard before the
-- original inner function runs.
CREATE OR REPLACE FUNCTION public.remove_post_from_club(p_post_id uuid, p_club_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.current_student_can_access_app() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF NOT public.content_is_student_visible('post', p_post_id) THEN
    RAISE EXCEPTION 'content_unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM public.remove_post_from_club__inner(p_post_id, p_club_id);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_post_from_club(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_post_from_club(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_club_photo_everywhere(p_photo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_post_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.current_student_can_access_app() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT cp.post_id INTO v_post_id FROM public.club_photos cp WHERE cp.id = p_photo_id;
  IF v_post_id IS NOT NULL AND NOT public.content_is_student_visible('post', v_post_id) THEN
    RAISE EXCEPTION 'content_unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM public.delete_club_photo_everywhere__inner(p_photo_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_club_photo_everywhere(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_club_photo_everywhere(uuid) TO authenticated;

-- Prevent future reminder copy from disclosing an administrator-removed event.
CREATE OR REPLACE FUNCTION public.process_event_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_catchup  int := notification_config_int('reminder.catchup_window_minutes', 30);
  v_inserted int := 0;
  v_n        int;
  r          record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('event_reminder_tomorrow', notification_config_int('reminder.tomorrow_lead_minutes', 1440)),
      ('event_reminder_hour',     notification_config_int('reminder.hour_lead_minutes', 60)),
      ('event_reminder_now',      notification_config_int('reminder.now_lead_minutes', 0))
    ) AS k(kind, lead_minutes)
  LOOP
    INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key)
    SELECT
      rv.user_id, e.created_by, r.kind, e.id, 'event', false,
      CASE r.kind
        WHEN 'event_reminder_tomorrow' THEN e.title || ' is tomorrow.'
        WHEN 'event_reminder_hour' THEN e.title || ' starts in one hour.'
        ELSE e.title || ' is starting now.'
      END,
      r.kind || ':' || e.id || ':' ||
        extract(epoch FROM event_start_ts(e.event_date, e.start_time))::bigint || ':' || rv.user_id
    FROM events e
    JOIN event_rsvps rv ON rv.event_id = e.id AND rv.status = 'going'
    WHERE now() >= event_start_ts(e.event_date, e.start_time) - make_interval(mins => r.lead_minutes)
      AND now() < event_start_ts(e.event_date, e.start_time) - make_interval(mins => r.lead_minutes)
                    + make_interval(mins => v_catchup)
      AND event_start_ts(e.event_date, e.start_time) > now() - interval '5 minutes'
      AND public.content_is_student_visible('event', e.id)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_inserted := v_inserted + v_n;
  END LOOP;

  INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key)
  SELECT
    m.user_id, e.created_by, 'event_last_chance', e.id, 'event', false,
    'Last chance to RSVP to ' || e.title || '.',
    'event_last_chance:' || e.id || ':' ||
      extract(epoch FROM event_start_ts(e.event_date, e.start_time))::bigint || ':' || m.user_id
  FROM events e
  JOIN LATERAL (
    SELECT cm.user_id FROM club_members cm
     WHERE cm.club_id = e.club_id AND e.visibility IN ('everyone', 'members')
    UNION
    SELECT uid FROM unnest(COALESCE(e.specific_user_ids, ARRAY[]::uuid[])) AS uid
     WHERE e.visibility = 'specific'
  ) m ON true
  WHERE m.user_id <> COALESCE(e.created_by, m.user_id)
    AND now() >= event_start_ts(e.event_date, e.start_time)
                 - make_interval(mins => notification_config_int('reminder.last_chance_lead_minutes', 360))
    AND now() < event_start_ts(e.event_date, e.start_time)
                 - make_interval(mins => notification_config_int('reminder.last_chance_lead_minutes', 360))
                 + make_interval(mins => v_catchup)
    AND event_start_ts(e.event_date, e.start_time) > now()
    AND public.content_is_student_visible('event', e.id)
    AND NOT EXISTS (
      SELECT 1 FROM event_rsvps rv WHERE rv.event_id = e.id AND rv.user_id = m.user_id
    )
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_inserted := v_inserted + v_n;

  PERFORM process_social_proof_events();
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.process_event_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_event_reminders() TO service_role;

-- -----------------------------------------------------------------------------
-- Atomic administrator remove / restore. Only service_role can execute these
-- functions; server actions authenticate the immutable founder, AAL2, recent
-- MFA, and ADMIN_WRITES_ENABLED before constructing that client.
-- -----------------------------------------------------------------------------

INSERT INTO public.admin_audit_actions (action, target_type, sensitivity, requires_reason, description) VALUES
  ('post.creatorDelete', 'post', 'sensitive', false, 'Record a direct creator deletion without retaining deleted post content.'),
  ('comment.creatorDelete', 'comment', 'sensitive', false, 'Record a direct creator deletion without retaining deleted comment content.'),
  ('event.creatorDelete', 'event', 'sensitive', false, 'Record a direct creator deletion without retaining deleted event content.'),
  ('post.remove', 'post', 'destructive', true, 'Hide a post from student surfaces while preserving it for review.'),
  ('post.restore', 'post', 'sensitive', true, 'Restore a previously administrator-removed post.'),
  ('comment.remove', 'comment', 'destructive', true, 'Hide a comment from student surfaces while preserving it for review.'),
  ('comment.restore', 'comment', 'sensitive', true, 'Restore a previously administrator-removed comment.'),
  ('event.remove', 'event', 'destructive', true, 'Hide an event from student surfaces while preserving it for review.'),
  ('event.restore', 'event', 'sensitive', true, 'Restore a previously administrator-removed event.')
ON CONFLICT (action) DO NOTHING;

CREATE OR REPLACE FUNCTION private.content_remove_impl(
  p_actor_id uuid,
  p_actor_email text,
  p_reason text,
  p_correlation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid;
  v_club_id uuid;
  v_created_at timestamptz;
  v_state text;
  v_before jsonb;
  v_metadata jsonb := jsonb_build_object('entityType', p_entity_type, 'entityId', p_entity_id);
BEGIN
  IF NOT private.content_reason_ok(p_reason) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'invalid_reason');
  END IF;

  PERFORM private.content_lifecycle_lock(p_entity_type, p_entity_id);
  SELECT owner_id, club_id, content_created_at
    INTO v_owner_id, v_club_id, v_created_at
    FROM private.content_owner_snapshot(p_entity_type, p_entity_id);
  IF v_created_at IS NULL THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'not_found');
  END IF;

  v_state := private.content_state(p_entity_type, p_entity_id);
  v_before := private.content_lifecycle_snapshot(p_entity_type, p_entity_id);
  IF v_state = 'removed' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'already_removed');
  ELSIF v_state = 'creator_deleted' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'creator_deleted');
  ELSIF v_state IN ('purge_pending', 'purge_failed') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'purge_in_progress');
  ELSIF v_state = 'purged' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'already_purged');
  END IF;

  INSERT INTO public.content_lifecycle (
    entity_type, entity_id, state, owner_id, club_id, content_created_at,
    removed_at, removed_by, removal_correlation_id
  ) VALUES (
    p_entity_type, p_entity_id, 'removed', v_owner_id, v_club_id, v_created_at,
    now(), p_actor_id, p_correlation_id
  )
  ON CONFLICT (entity_type, entity_id) DO UPDATE
    SET state = 'removed',
        owner_id = COALESCE(public.content_lifecycle.owner_id, EXCLUDED.owner_id),
        club_id = COALESCE(public.content_lifecycle.club_id, EXCLUDED.club_id),
        content_created_at = COALESCE(public.content_lifecycle.content_created_at, EXCLUDED.content_created_at),
        removed_at = now(),
        removed_by = p_actor_id,
        removal_correlation_id = p_correlation_id,
        restored_at = NULL,
        restored_by = NULL,
        restoration_correlation_id = NULL;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
    btrim(p_reason), v_before, private.content_lifecycle_snapshot(p_entity_type, p_entity_id),
    v_metadata, p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.content_restore_impl(
  p_actor_id uuid,
  p_actor_email text,
  p_reason text,
  p_correlation_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state text;
  v_before jsonb;
  v_parent_id uuid;
  v_metadata jsonb := jsonb_build_object('entityType', p_entity_type, 'entityId', p_entity_id);
BEGIN
  IF NOT private.content_reason_ok(p_reason) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'invalid_reason');
  END IF;

  PERFORM private.content_lifecycle_lock(p_entity_type, p_entity_id);
  v_state := private.content_state(p_entity_type, p_entity_id);
  v_before := private.content_lifecycle_snapshot(p_entity_type, p_entity_id);
  IF v_state = 'active' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'not_removed');
  ELSIF v_state = 'creator_deleted' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'creator_deleted');
  ELSIF v_state IN ('purge_pending', 'purge_failed') THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'purge_in_progress');
  ELSIF v_state = 'purged' THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'already_purged');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM private.content_owner_snapshot(p_entity_type, p_entity_id)) THEN
    RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
      v_metadata, p_correlation_id, 'not_found');
  END IF;

  IF p_entity_type = 'comment' THEN
    SELECT post_id INTO v_parent_id FROM public.post_comments WHERE id = p_entity_id;
    IF v_parent_id IS NULL THEN
      RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
        v_metadata, p_correlation_id, 'parent_missing');
    END IF;
    IF private.content_state('post', v_parent_id) <> 'active' THEN
      RETURN private.admin_tx_fail(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
        v_metadata, p_correlation_id, 'parent_unavailable');
    END IF;
  END IF;

  UPDATE public.content_lifecycle
     SET state = 'active',
         restored_at = now(),
         restored_by = p_actor_id,
         restoration_correlation_id = p_correlation_id
   WHERE entity_type = p_entity_type AND entity_id = p_entity_id;

  RETURN private.admin_tx_ok(p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
    btrim(p_reason), v_before, private.content_lifecycle_snapshot(p_entity_type, p_entity_id),
    v_metadata, p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_post_remove(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_post_id uuid
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT private.content_remove_impl(p_actor_id, p_actor_email, p_reason, p_correlation_id,
    'post', p_post_id, 'post.remove');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_post_restore(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_post_id uuid
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT private.content_restore_impl(p_actor_id, p_actor_email, p_reason, p_correlation_id,
    'post', p_post_id, 'post.restore');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_comment_remove(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_comment_id uuid
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT private.content_remove_impl(p_actor_id, p_actor_email, p_reason, p_correlation_id,
    'comment', p_comment_id, 'comment.remove');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_comment_restore(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_comment_id uuid
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT private.content_restore_impl(p_actor_id, p_actor_email, p_reason, p_correlation_id,
    'comment', p_comment_id, 'comment.restore');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_event_remove(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_event_id uuid
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT private.content_remove_impl(p_actor_id, p_actor_email, p_reason, p_correlation_id,
    'event', p_event_id, 'event.remove');
$$;

CREATE OR REPLACE FUNCTION public.admin_tx_event_restore(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid, p_event_id uuid
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT private.content_restore_impl(p_actor_id, p_actor_email, p_reason, p_correlation_id,
    'event', p_event_id, 'event.restore');
$$;

REVOKE ALL ON FUNCTION public.admin_tx_post_remove(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tx_post_restore(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tx_comment_remove(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tx_comment_restore(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tx_event_remove(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_tx_event_restore(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_tx_post_remove(uuid, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_tx_post_restore(uuid, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_tx_comment_remove(uuid, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_tx_comment_restore(uuid, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_tx_event_remove(uuid, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_tx_event_restore(uuid, text, text, uuid, uuid) TO service_role;

COMMIT;
