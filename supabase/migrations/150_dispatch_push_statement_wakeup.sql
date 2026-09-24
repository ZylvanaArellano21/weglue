-- Coalesce notification push wakeups at the SQL statement boundary. Row
-- triggers still enqueue each eligible push; the 148 cron remains the fallback.
BEGIN;

CREATE OR REPLACE FUNCTION public.notifications_after_insert_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_copy record;
BEGIN
  BEGIN
    SELECT * INTO v_copy FROM notification_push_copy(NEW);
    PERFORM enqueue_push(
      NEW.user_id, NEW.id, NEW.type, v_copy.title, v_copy.body, NEW.route,
      COALESCE(NEW.group_key, 'notif:' || NEW.id::text),
      'notif:' || NEW.id::text, 0
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notifications_after_insert_push failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notifications_after_group_merge_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_copy record;
  v_window int;
BEGIN
  BEGIN
    IF NEW.group_count > OLD.group_count AND NEW.read = false THEN
      SELECT group_window_minutes INTO v_window FROM notification_types WHERE type = NEW.type;
      SELECT * INTO v_copy FROM notification_push_copy(NEW);
      PERFORM enqueue_push(
        NEW.user_id, NEW.id, NEW.type, v_copy.title, v_copy.body, NEW.route,
        NEW.group_key, NULL, COALESCE(v_window, 60)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notifications_after_group_merge_push failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- A grouped INSERT updates an existing notification from its BEFORE INSERT
-- trigger. Mark only that nested UPDATE, so its statement trigger leaves the
-- wakeup to the enclosing INSERT statement trigger. Restore any prior value
-- before returning; the exception block rolls back the setting on failure.
CREATE OR REPLACE FUNCTION public.notifications_prepare()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reg notification_types%ROWTYPE;
  v_target notifications%ROWTYPE;
  v_prior_merge_flag text;
BEGIN
  BEGIN
    SELECT * INTO v_reg FROM notification_types WHERE type = NEW.type;
    IF FOUND AND NOT v_reg.enabled THEN RETURN NULL; END IF;
    IF FOUND AND NOT v_reg.in_app THEN RETURN NULL; END IF;

    IF NEW.route IS NULL THEN
      NEW.route := notification_route(NEW.type, NEW.entity_id, NEW.entity_type, NEW.actor_id);
    END IF;

    IF FOUND AND v_reg.group_window_minutes > 0 THEN
      NEW.group_key := COALESCE(NEW.group_key, NEW.type || ':' || COALESCE(NEW.entity_id::text, 'global'));
      NEW.group_actors := COALESCE(NEW.group_actors, CASE WHEN NEW.actor_id IS NULL THEN NULL ELSE ARRAY[NEW.actor_id] END);

      SELECT * INTO v_target
      FROM notifications
      WHERE user_id = NEW.user_id AND group_key = NEW.group_key AND read = false
        AND updated_at > now() - make_interval(mins => v_reg.group_window_minutes)
      ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;

      IF FOUND THEN
        IF v_reg.group_dedupe_actor AND NEW.actor_id IS NOT NULL
           AND (v_target.actor_id = NEW.actor_id
                OR COALESCE(v_target.group_actors, '{}') @> ARRAY[NEW.actor_id]) THEN
          RETURN NULL;
        END IF;

        v_prior_merge_flag := current_setting('weglue.notification_insert_merge', true);
        PERFORM set_config('weglue.notification_insert_merge', 'on', true);
        UPDATE notifications
        SET actor_id = COALESCE(NEW.actor_id, v_target.actor_id),
            group_count = v_target.group_count + 1,
            group_actors = CASE
              WHEN NEW.actor_id IS NULL THEN v_target.group_actors
              WHEN COALESCE(v_target.group_actors, '{}') @> ARRAY[NEW.actor_id] THEN v_target.group_actors
              ELSE COALESCE(v_target.group_actors, '{}') || NEW.actor_id
            END,
            message = grouped_notification_message(
              NEW.type, NEW.entity_id, v_target.group_count + 1,
              v_target.message, NEW.message,
              COALESCE(NEW.actor_id, v_target.actor_id)),
            route = notification_route(
              NEW.type, v_target.entity_id, v_target.entity_type,
              COALESCE(NEW.actor_id, v_target.actor_id)),
            created_at = now(),
            seen_at = NULL
        WHERE id = v_target.id;
        PERFORM set_config('weglue.notification_insert_merge', COALESCE(v_prior_merge_flag, ''), true);
        RETURN NULL;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notifications_prepare failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Called even when BEFORE INSERT merged or skipped every input row; the
-- existing dispatcher returns without issuing HTTP when no push is due.
CREATE OR REPLACE FUNCTION public.notifications_dispatch_after_insert_statement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.invoke_push_dispatch();
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notifications_dispatch_after_insert_statement failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.notifications_dispatch_after_update_statement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() > 1
     AND current_setting('weglue.notification_insert_merge', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM updated_notifications n
    JOIN previous_notifications o USING (id)
    WHERE n.group_count > o.group_count AND n.read = false
  ) THEN
    PERFORM public.invoke_push_dispatch();
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notifications_dispatch_after_update_statement failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.notifications_dispatch_after_insert_statement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notifications_dispatch_after_update_statement() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_dispatch_insert ON public.notifications;
CREATE TRIGGER trg_notifications_dispatch_insert
  AFTER INSERT ON public.notifications
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.notifications_dispatch_after_insert_statement();

DROP TRIGGER IF EXISTS trg_notifications_dispatch_update ON public.notifications;
CREATE TRIGGER trg_notifications_dispatch_update
  AFTER UPDATE ON public.notifications
  REFERENCING OLD TABLE AS previous_notifications NEW TABLE AS updated_notifications
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.notifications_dispatch_after_update_statement();

COMMIT;
