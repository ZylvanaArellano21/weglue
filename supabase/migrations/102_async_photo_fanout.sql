-- ============================================================================
-- 102 — PROPOSAL: asynchronous photo-post notification fan-out
--
-- REVIEW ONLY. Do not apply this file, run Supabase CLI, deploy it, or commit
-- it from this task. Claude owns the eventual commit after the verification
-- checklist in docs/rollout/migration-102-design.md passes.
--
-- The old posts AFTER INSERT path did one notification INSERT per campus/club
-- recipient. This proposal leaves exactly one O(1) outbox enqueue in that
-- path. A pg_cron worker drains the outbox in bounded, cursor-based batches.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Durable job table
-- ----------------------------------------------------------------------------

CREATE TABLE public.notification_fanout_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      UUID NOT NULL UNIQUE REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('club_post', 'photo_post')),
  -- Direct posts.club_id and every post_club_tags.club_id are coalesced into
  -- this array so a post still has one job even when it has several club tags.
  club_ids     UUID[] NOT NULL DEFAULT '{}'::UUID[],
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  -- Last recipient UUID completed by the worker. UUID ordering is the stable
  -- deterministic order used by the recipient query.
  cursor       UUID,
  attempts     INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INT NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  claimed_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_fanout_jobs_pending
  ON public.notification_fanout_jobs (created_at, id)
  WHERE status = 'pending';

CREATE INDEX idx_notification_fanout_jobs_processing
  ON public.notification_fanout_jobs (claimed_at, id)
  WHERE status = 'processing';

ALTER TABLE public.notification_fanout_jobs ENABLE ROW LEVEL SECURITY;
-- No student/client access. The trigger and pg_cron worker run through
-- SECURITY DEFINER functions; the Admin server uses service_role only.
REVOKE ALL ON TABLE public.notification_fanout_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notification_fanout_jobs TO service_role;

-- These support the worker's two live recipient scans without changing the
-- recipient contract (campus profiles and current club members).
CREATE INDEX IF NOT EXISTS idx_profiles_university_id_id
  ON public.profiles (university_id, id);
CREATE INDEX IF NOT EXISTS idx_club_members_club_id_user_id
  ON public.club_members (club_id, user_id);

-- ----------------------------------------------------------------------------
-- 2. Notification uniqueness / pre-102 duplicate cleanup
-- ----------------------------------------------------------------------------
-- 046 added a unique dedupe_key index, but the 088 photo path did not set a
-- dedupe_key and therefore could coexist with the 046 club path. Keep the
-- oldest row for each logical club-post notification before adding the
-- database-level guarantee used by the async worker. Deleting a duplicate
-- notification also removes its notification-linked push_queue rows through
-- the existing ON DELETE CASCADE, which removes the duplicate delivery too.

DELETE FROM public.notifications AS newer
USING public.notifications AS older
WHERE newer.type = 'club_post'
  AND older.type = 'club_post'
  AND newer.entity_id IS NOT NULL
  AND newer.entity_id = older.entity_id
  AND newer.user_id = older.user_id
  AND (
    newer.created_at > older.created_at
    OR (newer.created_at = older.created_at AND newer.id > older.id)
  );

UPDATE public.notifications AS n
SET dedupe_key = 'club_post:' || n.entity_id::TEXT || ':' || n.user_id::TEXT
WHERE n.type = 'club_post'
  AND n.entity_id IS NOT NULL
  AND n.dedupe_key IS NULL
  -- A surviving older photo row may share its logical key with a surviving
  -- club-path row whose key is already populated. Leave that row NULL; the
  -- composite unique index below is the authoritative guarantee.
  AND NOT EXISTS (
    SELECT 1
    FROM public.notifications AS existing
    WHERE existing.dedupe_key =
      'club_post:' || n.entity_id::TEXT || ':' || n.user_id::TEXT
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_club_post_recipient
  ON public.notifications (user_id, type, entity_id)
  WHERE type = 'club_post' AND entity_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. O(1) enqueue helper and cutover of the old trigger functions
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_notification_fanout_job(
  p_post_id   UUID,
  p_author_id UUID,
  p_club_id   UUID,
  p_kind      TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_fanout_jobs (
    post_id, author_id, kind, club_ids
  )
  VALUES (
    p_post_id,
    p_author_id,
    CASE WHEN p_kind = 'photo_post' THEN 'photo_post' ELSE 'club_post' END,
    CASE WHEN p_club_id IS NULL THEN '{}'::UUID[] ELSE ARRAY[p_club_id] END
  )
  ON CONFLICT (post_id) DO UPDATE
  SET author_id = EXCLUDED.author_id,
      kind = CASE
        WHEN public.notification_fanout_jobs.kind = 'photo_post'
          OR EXCLUDED.kind = 'photo_post' THEN 'photo_post'
        ELSE 'club_post'
      END,
      club_ids = (
        SELECT COALESCE(array_agg(DISTINCT club_id ORDER BY club_id), '{}'::UUID[])
        FROM unnest(
          COALESCE(public.notification_fanout_jobs.club_ids, '{}'::UUID[])
          || COALESCE(EXCLUDED.club_ids, '{}'::UUID[])
        ) AS clubs(club_id)
        WHERE club_id IS NOT NULL
      ),
      -- A new club target or a promotion from club_post to photo_post means
      -- the already-completed prefix must be scanned again. The unique
      -- notification index makes that replay harmless.
      status = CASE
        WHEN EXCLUDED.kind IS DISTINCT FROM public.notification_fanout_jobs.kind
          OR NOT (EXCLUDED.club_ids <@ public.notification_fanout_jobs.club_ids)
          THEN 'pending'
        ELSE public.notification_fanout_jobs.status
      END,
      cursor = CASE
        WHEN EXCLUDED.kind IS DISTINCT FROM public.notification_fanout_jobs.kind
          OR NOT (EXCLUDED.club_ids <@ public.notification_fanout_jobs.club_ids)
          THEN NULL
        ELSE public.notification_fanout_jobs.cursor
      END,
      attempts = CASE
        WHEN EXCLUDED.kind IS DISTINCT FROM public.notification_fanout_jobs.kind
          OR NOT (EXCLUDED.club_ids <@ public.notification_fanout_jobs.club_ids)
          THEN 0
        ELSE public.notification_fanout_jobs.attempts
      END,
      claimed_at = CASE
        WHEN EXCLUDED.kind IS DISTINCT FROM public.notification_fanout_jobs.kind
          OR NOT (EXCLUDED.club_ids <@ public.notification_fanout_jobs.club_ids)
          THEN NULL
        ELSE public.notification_fanout_jobs.claimed_at
      END,
      completed_at = CASE
        WHEN EXCLUDED.kind IS DISTINCT FROM public.notification_fanout_jobs.kind
          OR NOT (EXCLUDED.club_ids <@ public.notification_fanout_jobs.club_ids)
          THEN NULL
        ELSE public.notification_fanout_jobs.completed_at
      END,
      last_error = CASE
        WHEN EXCLUDED.kind IS DISTINCT FROM public.notification_fanout_jobs.kind
          OR NOT (EXCLUDED.club_ids <@ public.notification_fanout_jobs.club_ids)
          THEN NULL
        ELSE public.notification_fanout_jobs.last_error
      END,
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_notification_fanout_job(UUID, UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- The former photo trigger is removed. Photo posts are enqueued by the single
-- posts trigger below, so the INSERT path cannot have a second fan-out loop.
DROP TRIGGER IF EXISTS trg_photo_post_university_notify ON public.posts;

-- Keep the old function names available for callers that may still reference
-- them, but make them O(1) enqueue shims instead of recipient loops.
CREATE OR REPLACE FUNCTION public.notify_photo_post_university()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.image_url IS NOT NULL THEN
      PERFORM public.enqueue_notification_fanout_job(
        NEW.id, NEW.author_id, NEW.club_id, 'photo_post'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_photo_post_university enqueue failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_photo_post_university() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_club_post(
  p_post_id UUID,
  p_club_id  UUID,
  p_author   UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind TEXT;
BEGIN
  SELECT CASE WHEN image_url IS NOT NULL THEN 'photo_post' ELSE 'club_post' END
    INTO v_kind
  FROM public.posts
  WHERE id = p_post_id;

  PERFORM public.enqueue_notification_fanout_job(
    p_post_id, p_author, p_club_id, COALESCE(v_kind, 'club_post')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_club_post(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_club_post_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.image_url IS NOT NULL OR NEW.club_id IS NOT NULL THEN
      PERFORM public.enqueue_notification_fanout_job(
        NEW.id,
        NEW.author_id,
        NEW.club_id,
        CASE WHEN NEW.image_url IS NOT NULL THEN 'photo_post' ELSE 'club_post' END
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_club_post_notify enqueue failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_post_notify ON public.posts;
CREATE TRIGGER trg_club_post_notify
  AFTER INSERT ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_club_post_notify();

-- A tagged-only post has no posts.club_id. Preserve that path, but enqueue the
-- same one-per-post job and append the tagged club in O(1).
CREATE OR REPLACE FUNCTION public.handle_post_club_tag_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author UUID;
  v_kind   TEXT;
BEGIN
  BEGIN
    SELECT author_id,
           CASE WHEN image_url IS NOT NULL THEN 'photo_post' ELSE 'club_post' END
      INTO v_author, v_kind
    FROM public.posts
    WHERE id = NEW.post_id;

    IF v_author IS NOT NULL THEN
      PERFORM public.enqueue_notification_fanout_job(
        NEW.post_id, v_author, NEW.club_id, COALESCE(v_kind, 'club_post')
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_post_club_tag_notify enqueue failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_club_tag_notify ON public.post_club_tags;
CREATE TRIGGER trg_post_club_tag_notify
  AFTER INSERT ON public.post_club_tags
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_post_club_tag_notify();

-- ----------------------------------------------------------------------------
-- 4. Batched worker
-- ----------------------------------------------------------------------------
-- Defaults used by the cron call: 10 jobs/tick × 500 recipients/job/tick.
-- The extra candidate row lets an exact 500-recipient job complete in the
-- same tick instead of requiring a no-op follow-up tick.

CREATE OR REPLACE FUNCTION public.process_notification_fanout(
  p_jobs_per_tick       INT DEFAULT 10,
  p_recipients_per_job  INT DEFAULT 500
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job             RECORD;
  v_batch           UUID[];
  v_next_cursor     UUID;
  v_has_more        BOOLEAN;
  v_author_name     TEXT;
  v_author_univ     UUID;
  v_club_name       TEXT;
  v_inserted        INT := 0;
  v_rows            INT;
  v_jobs_limit      INT := LEAST(GREATEST(COALESCE(p_jobs_per_tick, 10), 1), 10);
  v_recip_limit     INT := LEAST(GREATEST(COALESCE(p_recipients_per_job, 500), 1), 500);
BEGIN
  -- pg_cron will not normally overlap a job, but this makes an operator's
  -- manual call and the cron call compose without duplicate work or lock waits.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('weglue:notification-fanout', 0)) THEN
    RETURN 0;
  END IF;

  -- Reaper: a crash after claim must not strand work. Five minutes is longer
  -- than the bounded 500-row batch target and leaves room for transient DB
  -- pressure before re-queueing.
  UPDATE public.notification_fanout_jobs
  SET status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
      attempts = LEAST(attempts + 1, max_attempts),
      claimed_at = NULL,
      completed_at = CASE WHEN attempts + 1 >= max_attempts THEN completed_at ELSE NULL END,
      last_error = CASE
        WHEN attempts + 1 >= max_attempts THEN COALESCE(last_error, 'worker timeout')
        ELSE COALESCE(last_error, 'worker timeout; re-queued')
      END,
      updated_at = now()
  WHERE status = 'processing'
    AND COALESCE(claimed_at, created_at) < now() - interval '5 minutes';

  FOR v_job IN
    WITH claim AS (
      SELECT id
      FROM public.notification_fanout_jobs
      WHERE status = 'pending'
      ORDER BY created_at, id
      LIMIT v_jobs_limit
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.notification_fanout_jobs AS j
    SET status = 'processing',
        claimed_at = now(),
        updated_at = now()
    FROM claim
    WHERE j.id = claim.id
    RETURNING j.*
  LOOP
    BEGIN
      SELECT p.university_id,
             COALESCE(NULLIF(btrim(p.full_name), ''), p.username, 'Someone')
        INTO v_author_univ, v_author_name
      FROM public.profiles AS p
      WHERE p.id = v_job.author_id;

      SELECT c.name
        INTO v_club_name
      FROM public.clubs AS c
      WHERE c.id = ANY(v_job.club_ids)
      ORDER BY c.id
      LIMIT 1;

      -- The union is deliberately de-duplicated before the cursor is applied:
      -- a club member in the author's campus must receive one logical row, not
      -- one campus row plus one club row. New membership is evaluated live at
      -- each batch, matching the existing "current members" contract.
      SELECT COALESCE(array_agg(recipient_id ORDER BY recipient_id), '{}'::UUID[])
        INTO v_batch
      FROM (
        SELECT recipient_id
        FROM (
          SELECT p.id AS recipient_id
          FROM public.profiles AS p
          WHERE v_job.kind = 'photo_post'
            AND v_author_univ IS NOT NULL
            AND p.university_id = v_author_univ
            AND p.id <> v_job.author_id

          UNION

          SELECT cm.user_id AS recipient_id
          FROM public.club_members AS cm
          WHERE cm.club_id = ANY(v_job.club_ids)
            AND cm.user_id <> v_job.author_id
        ) AS all_recipients
        WHERE v_job.cursor IS NULL OR recipient_id > v_job.cursor
        ORDER BY recipient_id
        LIMIT v_recip_limit + 1
      ) AS next_recipients;

      v_has_more := COALESCE(array_length(v_batch, 1), 0) > v_recip_limit;
      IF v_has_more THEN
        v_batch := v_batch[1:v_recip_limit];
      END IF;

      IF COALESCE(array_length(v_batch, 1), 0) = 0 THEN
        UPDATE public.notification_fanout_jobs
        SET status = 'completed',
            claimed_at = NULL,
            completed_at = now(),
            last_error = NULL,
            updated_at = now()
        WHERE id = v_job.id;
        CONTINUE;
      END IF;

      v_next_cursor := v_batch[array_length(v_batch, 1)];

      INSERT INTO public.notifications (
        user_id,
        actor_id,
        type,
        entity_id,
        entity_type,
        read,
        message,
        dedupe_key
      )
      SELECT recipient_id,
             v_job.author_id,
             'club_post',
             v_job.post_id,
             'post',
             false,
             CASE
               -- For a club-tagged photo, keep the old club copy for current
               -- club members and the old photo copy for campus-only users.
               -- The deterministic club precedence also resolves overlap.
               WHEN EXISTS (
                 SELECT 1
                 FROM public.club_members AS cm
                 WHERE cm.club_id = ANY(v_job.club_ids)
                   AND cm.user_id = recipient_id
               )
               THEN COALESCE(v_author_name, 'A member') ||
                    ' shared a new post in ' || COALESCE(v_club_name, 'the club') || '.'
               ELSE COALESCE(v_author_name, 'Someone') || ' shared a photo post.'
             END,
             'club_post:' || v_job.post_id::TEXT || ':' || recipient_id::TEXT
      FROM unnest(v_batch) AS batch(recipient_id)
      ON CONFLICT (user_id, type, entity_id)
        WHERE type = 'club_post' AND entity_id IS NOT NULL
      DO NOTHING;

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_inserted := v_inserted + v_rows;

      UPDATE public.notification_fanout_jobs
      SET status = CASE WHEN v_has_more THEN 'pending' ELSE 'completed' END,
          cursor = v_next_cursor,
          claimed_at = NULL,
          completed_at = CASE WHEN v_has_more THEN NULL ELSE now() END,
          last_error = NULL,
          updated_at = now()
      WHERE id = v_job.id;
    EXCEPTION WHEN OTHERS THEN
      -- The exception block is a subtransaction: the failed INSERT and cursor
      -- update roll back together. The last committed cursor remains durable.
      UPDATE public.notification_fanout_jobs
      SET status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
          attempts = LEAST(attempts + 1, max_attempts),
          claimed_at = NULL,
          completed_at = NULL,
          last_error = LEFT(SQLERRM, 2000),
          updated_at = now()
      WHERE id = v_job.id;
    END;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.process_notification_fanout(INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_notification_fanout(INT, INT) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. Read-only operational view for the Admin Data Health follow-up
-- ----------------------------------------------------------------------------

CREATE VIEW public.notification_fanout_job_health AS
SELECT id,
       post_id,
       author_id,
       kind,
       status,
       cursor,
       attempts,
       max_attempts,
       claimed_at,
       completed_at,
       last_error,
       created_at,
       updated_at,
       status = 'processing'
         AND COALESCE(claimed_at, created_at) < now() - interval '5 minutes' AS is_stale
FROM public.notification_fanout_jobs;

REVOKE ALL ON public.notification_fanout_job_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_fanout_job_health TO service_role;

-- ----------------------------------------------------------------------------
-- 6. pg_cron schedules
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('notification-fanout');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- The worker also reaps at the start of every tick. A separate lightweight
-- schedule makes recovery independent of a temporarily disabled/failed drain.
DO $$
BEGIN
  PERFORM cron.unschedule('notification-fanout-reaper');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Do not self-schedule on migration apply. Enabling these jobs is a separate,
-- deliberate operator step only after (a) the schema/signature checklist
-- passes on staging, (b) the pre-102 un-fanned-post review is complete, and
-- (c) the 50x500 burst has been measured. Paste the two statements below only
-- after those gates pass:
--
-- SELECT cron.schedule(
--   'notification-fanout',
--   '* * * * *',
--   'SELECT public.process_notification_fanout();'
-- );
--
-- SELECT cron.schedule(
--   'notification-fanout-reaper',
--   '*/5 * * * *',
--   $cron$UPDATE public.notification_fanout_jobs
--     SET status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
--         attempts = LEAST(attempts + 1, max_attempts),
--         claimed_at = NULL,
--         completed_at = CASE WHEN attempts + 1 >= max_attempts THEN completed_at ELSE NULL END,
--         last_error = CASE
--           WHEN attempts + 1 >= max_attempts THEN COALESCE(last_error, 'worker timeout')
--           ELSE COALESCE(last_error, 'worker timeout; re-queued')
--         END,
--         updated_at = now()
--     WHERE status = 'processing'
--       AND COALESCE(claimed_at, created_at) < now() - interval '5 minutes';$cron$
-- );

-- ==========================================================================
-- CUTOVER / BACKFILL NOTE
--
-- No automatic historical fan-out is performed here. The trigger cutover is
-- transactional, so all new posts after 102 enqueue exactly once. Before
-- enabling the cron schedules in staging, Claude must query for posts created
-- before 102 that have no corresponding club_post notification/job. If the
-- review finds a small approved set that must be recovered, insert those jobs
-- explicitly with the same columns (including direct + tagged club_ids) and
-- record the approved created_at cutoff. Do not backfill the entire historical
-- posts table by default; that would create unexpected old inbox alerts.
--
-- ROLLBACK NOTE: this repository never runs down migrations. Rollback is a
-- separately reviewed forward migration that disables the two cron jobs,
-- restores the pre-102 trigger/function definitions from 089/088, and removes
-- only 102-owned objects after any failed jobs and operational evidence are
-- retained. Re-adding the old triggers would intentionally restore synchronous
-- fan-out and the double-fire risk, so it is not an emergency-safe default.
-- ==========================================================================
