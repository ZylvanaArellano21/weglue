-- ============================================================================
-- We Glue – persist the complete actor set for grouped notifications
-- Migration: 114_grouped_notification_actors.sql
--
-- Additive and backward-compatible. The existing notifications.actor_id and
-- group_actors[] columns remain authoritative for old clients; this table is
-- the durable, paginatable actor source for new clients. No notification type,
-- creation path, push path, or grouping window is changed here.
-- ============================================================================

-- ── 1. Durable actor set ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notification_actors (
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  actor_id       UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, actor_id)
);

COMMENT ON TABLE public.notification_actors IS
  'Complete actor set for a notification group. Retained indefinitely; the representative is notifications.actor_id.';

CREATE INDEX IF NOT EXISTS idx_notification_actors_notification_created
  ON public.notification_actors (notification_id, created_at DESC);

ALTER TABLE public.notification_actors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_actors: recipients read actors"
  ON public.notification_actors;
CREATE POLICY "notification_actors: recipients read actors"
  ON public.notification_actors
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.id = notification_actors.notification_id
        AND n.user_id = (SELECT auth.uid())
        AND (
          n.actor_id IS NULL
          OR notification_actors.actor_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
          OR n.type <> ALL ((SELECT public.blockable_notification_types())::text[])
        )
    )
  );

GRANT SELECT ON public.notification_actors TO authenticated;

-- ── 2. Backfill every actor that can be derived ─────────────────────────────
--
-- 046/085 kept the representative in actor_id and the grouped actor set in
-- group_actors[]. For a legacy row with only actor_id, that representative is
-- the only derivable actor and is intentionally retained. Array order is the
-- historical oldest-to-newest append order, so tiny offsets preserve that
-- ordering for the recency sort while actor_id remains the representative.

WITH actor_candidates AS (
  SELECT
    n.id AS notification_id,
    n.actor_id,
    COALESCE(n.created_at, now()) AS notification_created_at,
    0::bigint AS source_order
  FROM public.notifications n
  WHERE n.actor_id IS NOT NULL

  UNION ALL

  SELECT
    n.id AS notification_id,
    grouped.actor_id,
    COALESCE(n.created_at, now()) AS notification_created_at,
    grouped.source_order
  FROM public.notifications n
  CROSS JOIN LATERAL unnest(COALESCE(n.group_actors, '{}'::uuid[]))
    WITH ORDINALITY AS grouped(actor_id, source_order)
  WHERE grouped.actor_id IS NOT NULL
),
deduped AS (
  SELECT DISTINCT ON (notification_id, actor_id)
    notification_id,
    actor_id,
    notification_created_at,
    source_order
  FROM actor_candidates
  ORDER BY notification_id, actor_id, source_order
)
INSERT INTO public.notification_actors (notification_id, actor_id, created_at)
SELECT
  notification_id,
  actor_id,
  notification_created_at + (source_order::double precision * interval '1 microsecond')
FROM deduped
ON CONFLICT (notification_id, actor_id) DO NOTHING;

-- ── 3. Keep the actor table complete for every future insert/merge ──────────

CREATE OR REPLACE FUNCTION public.notification_actors_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- INSERT-only is deliberate: actor history is retained indefinitely. A
  -- later privacy/account lifecycle operation may remove profile data, but it
  -- must not silently rewrite the historical group membership set.
  INSERT INTO public.notification_actors (notification_id, actor_id)
  SELECT NEW.id, actor_set.actor_id
  FROM (
    SELECT NEW.actor_id AS actor_id
    WHERE NEW.actor_id IS NOT NULL
    UNION
    SELECT grouped.actor_id
    FROM unnest(COALESCE(NEW.group_actors, '{}'::uuid[])) AS grouped(actor_id)
    WHERE grouped.actor_id IS NOT NULL
  ) AS actor_set
  ON CONFLICT (notification_id, actor_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notification_actors_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_actor_set_sync ON public.notifications;
CREATE TRIGGER trg_notifications_actor_set_sync
  AFTER INSERT OR UPDATE OF actor_id, group_actors, group_count
  ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notification_actors_sync();

-- ── 4. Grouped route: representative profile vs actor drill-down ───────────
--
-- The 046/085 prepare trigger computes profile routes from actor_id. This
-- later-named BEFORE trigger runs after it (PostgreSQL orders same-kind
-- triggers alphabetically), and changes only multi-actor groups. The row id is
-- available during BEFORE INSERT because notification defaults are populated
-- before BEFORE triggers run. Existing single-actor and system routes remain
-- unchanged.

CREATE OR REPLACE FUNCTION public.notifications_group_actor_route()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_count INT;
BEGIN
  SELECT count(*)::int
  INTO v_actor_count
  FROM (
    SELECT NEW.actor_id AS actor_id
    WHERE NEW.actor_id IS NOT NULL
    UNION
    SELECT grouped.actor_id
    FROM unnest(COALESCE(NEW.group_actors, '{}'::uuid[])) AS grouped(actor_id)
    WHERE grouped.actor_id IS NOT NULL
  ) AS actor_set;

  IF v_actor_count > 1 THEN
    NEW.route := jsonb_build_object(
      'screen', 'notificationActors',
      'notificationId', NEW.id
    );
  ELSIF TG_OP = 'UPDATE'
        AND (
          NEW.actor_id IS DISTINCT FROM OLD.actor_id
          OR NEW.group_actors IS DISTINCT FROM OLD.group_actors
          OR NEW.group_count IS DISTINCT FROM OLD.group_count
        ) THEN
    NEW.route := notification_route(
      NEW.type, NEW.entity_id, NEW.entity_type, NEW.actor_id
    );
  ELSIF TG_OP = 'INSERT' AND NEW.route IS NULL THEN
    NEW.route := notification_route(
      NEW.type, NEW.entity_id, NEW.entity_type, NEW.actor_id
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notifications_group_actor_route() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_zz_group_actor_route ON public.notifications;
CREATE TRIGGER trg_notifications_zz_group_actor_route
  BEFORE INSERT OR UPDATE OF actor_id, group_actors, group_count
  ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notifications_group_actor_route();
