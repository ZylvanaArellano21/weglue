-- ============================================================================
-- 100 — Direct-write idempotency for posts, events, and post comments
--
-- Clients generate one UUID client_tag per logical create operation. A retry
-- with the same owner + tag therefore hits a unique violation (23505), which
-- the client treats as success rather than creating a duplicate row.
--
-- The columns are nullable so existing callers and server-side inserts remain
-- valid. The partial indexes enforce idempotency only when a client supplies a
-- tag, matching the proven messages.client_tag pattern.
-- ============================================================================

BEGIN;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS client_tag uuid;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS client_tag uuid;

ALTER TABLE public.post_comments
  ADD COLUMN IF NOT EXISTS client_tag uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_posts_author_client_tag
  ON public.posts USING btree (author_id, client_tag)
  WHERE (client_tag IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_events_created_by_client_tag
  ON public.events USING btree (created_by, client_tag)
  WHERE (client_tag IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_post_comments_user_client_tag
  ON public.post_comments USING btree (user_id, client_tag)
  WHERE (client_tag IS NOT NULL);

COMMIT;

-- ============================================================================
-- ROLLBACK NOTES — this repo never runs migration down.
--
-- A future NNN_revert_100.sql would:
--   DROP INDEX IF EXISTS public.uq_posts_author_client_tag;
--   DROP INDEX IF EXISTS public.uq_events_created_by_client_tag;
--   DROP INDEX IF EXISTS public.uq_post_comments_user_client_tag;
--   ALTER TABLE public.posts DROP COLUMN IF EXISTS client_tag;
--   ALTER TABLE public.events DROP COLUMN IF EXISTS client_tag;
--   ALTER TABLE public.post_comments DROP COLUMN IF EXISTS client_tag;
--
-- The columns are nullable and additive, so leaving them in place is harmless
-- if rollback is not required.
-- ============================================================================
