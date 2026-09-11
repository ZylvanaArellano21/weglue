-- ============================================================================
-- 134 — Keep top-level comment notifications consistent with replies
--
-- Migration 128 suppresses comment_reply notifications for a restricted
-- recipient, but its top-level comment branch did not have the same guard.
-- A restricted account cannot use ordinary app surfaces, so do not create an
-- in-app row or push-triggering notification for either comment shape.
-- ============================================================================

BEGIN;

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
      SELECT author_id INTO v_post_author
        FROM public.posts
       WHERE id = NEW.post_id;

      IF v_post_author IS NOT NULL
         AND v_post_author <> NEW.user_id
         AND NOT COALESCE(public.is_account_restricted(v_post_author), true) THEN
        INSERT INTO public.notifications
          (user_id, actor_id, type, entity_id, entity_type, read)
        VALUES
          (v_post_author, NEW.user_id, 'comment', NEW.post_id, 'post', false);
      END IF;
    ELSE
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
    RAISE WARNING 'handle_post_comment_notify failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

COMMIT;
