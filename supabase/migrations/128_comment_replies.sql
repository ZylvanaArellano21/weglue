-- ============================================================================
-- 128 — Comment threading + reply notifications
--
-- (Renumbered from 122 after the interest-matching family 122-127 merged to
-- main / production. No behavioral change from the reviewed-and-accepted 122.)
--
-- Comments are stored in `post_comments`.  A reply points only at its
-- immediate parent; there is deliberately no depth or materialized path.
-- ============================================================================

BEGIN;

-- ── 1. Immediate parent link ────────────────────────────────────────────────

ALTER TABLE public.post_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid
    REFERENCES public.post_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_post_comments_parent_comment_id
  ON public.post_comments (parent_comment_id);

-- ── 2. Notification contract ────────────────────────────────────────────────

-- 004's entity CHECK predates comment-target notifications. Existing writers
-- use event, club, message, post, or NULL; replies additionally need comment.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_entity_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_entity_type_check
  CHECK (entity_type = ANY (ARRAY['event'::text,'club'::text,'message'::text,'post'::text,'comment'::text]));

INSERT INTO public.notification_types
  (type, category, enabled, in_app, push, group_window_minutes,
   group_dedupe_actor, blockable, description)
VALUES
  ('comment_reply', 'social', true, true, true, 0, false, true,
   'A reply to your comment')
ON CONFLICT (type) DO UPDATE SET
  category = EXCLUDED.category,
  enabled = EXCLUDED.enabled,
  in_app = EXCLUDED.in_app,
  push = EXCLUDED.push,
  group_window_minutes = EXCLUDED.group_window_minutes,
  group_dedupe_actor = EXCLUDED.group_dedupe_actor,
  blockable = EXCLUDED.blockable,
  description = EXCLUDED.description;

CREATE OR REPLACE FUNCTION notification_route(
  p_type TEXT, p_entity_id UUID, p_entity_type TEXT, p_actor_id UUID
) RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_type = 'comment_reply' AND p_entity_id IS NOT NULL
      -- entity_id is the reply comment itself: land on its post and carry the
      -- comment id so the client opens the exact thread. `commentId` is a pure
      -- addition — `screen`/`postId` are unchanged, so every existing consumer
      -- keeps working.
      THEN COALESCE(
        (SELECT jsonb_build_object('screen','post','postId',c.post_id,'commentId',c.id)
           FROM post_comments c
          WHERE c.id = p_entity_id),
        jsonb_build_object('screen','notifications'))
    WHEN p_type IN ('like','comment') AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','post','postId',p_entity_id)
    WHEN p_type = 'club_post' AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','post','postId',p_entity_id)
    WHEN p_type IN ('new_event','event_updated','event_reminder_tomorrow',
                    'event_reminder_hour','event_reminder_now','event_last_chance',
                    'event_rsvp') AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','event','eventId',p_entity_id)
    WHEN p_type IN ('club_joined','member_joined','officer_role','officer_removed',
                    'club_removed','club_inactive','event_canceled') AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','club','clubId',p_entity_id)
    -- 083: club_photo's entity_id is the club_photos row, not a club id — the
    -- destination is still the club profile, via the row's own club_id.
    WHEN p_type = 'club_photo' AND p_entity_id IS NOT NULL
      THEN jsonb_build_object('screen','club','clubId',
             (SELECT club_id FROM club_photos WHERE id = p_entity_id))
    WHEN p_type IN ('club_chat_added','officer_chat_added','group_chat_added',
                    'chat_invite_joined') AND p_entity_id IS NOT NULL
      THEN CASE WHEN p_entity_type = 'message'
                THEN jsonb_build_object('screen','chat','chatId',p_entity_id)
                ELSE jsonb_build_object('screen','club','clubId',p_entity_id) END
    WHEN p_actor_id IS NOT NULL
      THEN jsonb_build_object('screen','profile','userId',p_actor_id)
    ELSE jsonb_build_object('screen','notifications')
  END;
$$;

-- ── 3. Reply parent integrity ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.validate_comment_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.parent_comment_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.post_comments parent
       WHERE parent.id = NEW.parent_comment_id
         AND parent.post_id = NEW.post_id
    ) THEN
      RAISE EXCEPTION 'comment reply parent must be a comment on the same post'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_comment_parent() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_validate_comment_parent ON public.post_comments;
CREATE TRIGGER trg_validate_comment_parent
  BEFORE INSERT ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.validate_comment_parent();

-- Round-1's type-scoped trigger duplicated the existing block guard. Remove it
-- if this migration has already been applied in a disposable environment.
DROP TRIGGER IF EXISTS trg_notifications_comment_reply_guard ON public.notifications;
DROP FUNCTION IF EXISTS public.comment_reply_notification_guard();

-- ── 4. Comment notification split ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_post_comment_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_author   uuid;
  v_parent_author uuid;
  v_parent_post   uuid;
  v_actor_name    text;
BEGIN
  BEGIN
    IF NEW.parent_comment_id IS NULL THEN
      -- Existing behavior: top-level comments notify the post author, using
      -- the post as the notification entity.
      SELECT author_id INTO v_post_author
        FROM public.posts
       WHERE id = NEW.post_id;

      IF v_post_author IS NOT NULL AND v_post_author <> NEW.user_id THEN
        INSERT INTO public.notifications
          (user_id, actor_id, type, entity_id, entity_type, read)
        VALUES
          (v_post_author, NEW.user_id, 'comment', NEW.post_id, 'post', false);
      END IF;
    ELSE
      -- A reply targets exactly one immediate parent author.  The same-post
      -- condition is defense in depth for privileged writers; direct inserts
      -- are constrained by the parent-integrity trigger above.
      SELECT c.user_id, c.post_id
        INTO v_parent_author, v_parent_post
        FROM public.post_comments c
       WHERE c.id = NEW.parent_comment_id;

      IF v_parent_author IS NOT NULL
         AND v_parent_post = NEW.post_id
         AND v_parent_author <> NEW.user_id
         AND NOT COALESCE(public.is_account_restricted(v_parent_author), true) THEN
        SELECT COALESCE(NULLIF(btrim(p.full_name), ''), p.username, 'Someone')
          INTO v_actor_name
          FROM public.profiles p
         WHERE p.id = NEW.user_id;

        INSERT INTO public.notifications
          (user_id, actor_id, type, entity_id, entity_type, read, message)
        VALUES
          (v_parent_author, NEW.user_id, 'comment_reply', NEW.id, 'comment',
           false, COALESCE(v_actor_name, 'Someone') || ' replied to your comment.');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Match the established notification rule: notification failure must not
    -- roll back the comment write.
    RAISE WARNING 'handle_post_comment_notify failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- ── 5. Verification ─────────────────────────────────────────────────────────

DO $$
DECLARE
  v_constraint text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'post_comments'
       AND column_name = 'parent_comment_id'
       AND is_nullable = 'YES'
       AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION '128: post_comments.parent_comment_id is missing or not nullable uuid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.post_comments'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.post_comments'::regclass
       AND c.confdeltype = 'n'
       AND pg_get_constraintdef(c.oid) LIKE '%parent_comment_id%'
  ) THEN
    RAISE EXCEPTION '128: parent_comment_id self-FK with ON DELETE SET NULL is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class i
      JOIN pg_index ix ON ix.indexrelid = i.oid
     WHERE i.relname = 'idx_post_comments_parent_comment_id'
       AND ix.indrelid = 'public.post_comments'::regclass
  ) THEN
    RAISE EXCEPTION '128: parent-comment index is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.notification_types WHERE type = 'comment_reply') THEN
    RAISE EXCEPTION '128: comment_reply notification type is missing';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_constraint
    FROM pg_constraint
   WHERE conrelid = 'public.notifications'::regclass
     AND conname = 'notifications_entity_type_check';
  IF v_constraint IS NULL OR v_constraint NOT LIKE '%comment%' THEN
    RAISE EXCEPTION '128: notifications entity_type CHECK does not allow comment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.post_comments'::regclass
       AND tgname = 'trg_validate_comment_parent'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '128: comment parent validation trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.post_comments'::regclass
       AND tgname = 'trg_post_comment_notify'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '128: comment notification trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.notifications'::regclass
       AND tgname = 'trg_notifications_block_guard'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '128: existing notification block guard is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.notifications'::regclass
       AND tgname = 'trg_notifications_comment_reply_guard'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '128: duplicate comment-reply notification guard remains';
  END IF;
END
$$;

COMMIT;
