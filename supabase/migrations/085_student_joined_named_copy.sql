-- ============================================================
-- We Glue – student_joined named copy + destination fix (correction 4,
-- part 3 — founder decisions on the Fix 4 follow-up)
-- Migration: 085_student_joined_named_copy.sql
--
-- FOUNDER DECISIONS (2026-08-13), implemented exactly as specified:
--
--   1. chat_invite_joined stays dormant. Not built, not removed — it is
--      outside the requested notification coverage and causes no
--      user-facing problem sitting unused. Documented in place (PART A)
--      instead of left as an unexplained loose end.
--
--   2. student_joined remains the existing platform-wide, grouped,
--      in-app-only, push-disabled early-launch notification — no audience
--      change, no code touches its eligibility. (No SQL needed for this
--      decision; noted here for the record.)
--
--   3. The grouped copy must NAME the most recent joiner, not just count
--      them, and tapping must open THAT named person's profile — PARTS
--      B-D below.
--
-- WHAT PART B-D ACTUALLY FIX
--   grouped_notification_message() only ever received a count, never an
--   actor — so the grouped copy could name no one ("3 new students joined
--   We Glue 🎉"). Worse: notifications_prepare()'s merge UPDATE already
--   advances `actor_id` to the newest joiner on every merge, but its SET
--   list never included `route` — so even after naming the right person in
--   the message, tapping the notification would have opened the FIRST
--   joiner's profile (route computed once at the original insert), not the
--   one now named. Both are fixed together so "names X" and "opens X's
--   profile" stay consistent. No new destination or screen — still the
--   existing profile route (notification_route's actor-fallback, unchanged).
-- ============================================================

-- ── A. Document chat_invite_joined as intentionally dormant ───────────────

UPDATE notification_types
SET description = 'DEFERRED (founder decision 2026-08-13): registered but '
  || 'no trigger inserts this type. Distinct from the joiner''s own '
  || 'club_chat_added/group_chat_added (already covered) — this would '
  || 'notify the INVITER when someone joins via their link. Outside the '
  || 'requested notification coverage; causes no user-facing problem '
  || 'dormant. Left in place, not removed. Building it or deleting this '
  || 'row both require a future product decision.'
WHERE type = 'chat_invite_joined';

-- ── B. Name the actor in the grouped copy ──────────────────────────────────

DROP FUNCTION IF EXISTS grouped_notification_message(TEXT, UUID, INT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION grouped_notification_message(
  p_type TEXT, p_entity_id UUID, p_count INT, p_current TEXT, p_incoming TEXT,
  p_actor_id UUID DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club       TEXT;
  v_actor_name TEXT;
BEGIN
  IF p_count <= 1 THEN RETURN COALESCE(p_incoming, p_current); END IF;
  IF p_type = 'member_joined' THEN
    SELECT name INTO v_club FROM clubs WHERE id = p_entity_id;
    IF v_club IS NOT NULL THEN
      RETURN p_count || ' students joined ' || v_club || '.';
    END IF;
  ELSIF p_type = 'student_joined' THEN
    -- 085: exact founder-specified templates. p_count is the TOTAL group
    -- size (including the one now named), so "other students" = p_count-1.
    SELECT COALESCE(NULLIF(full_name, ''), username) INTO v_actor_name
    FROM profiles WHERE id = p_actor_id;
    v_actor_name := COALESCE(v_actor_name, 'A student');
    RETURN v_actor_name || ' and ' || (p_count - 1) || ' other students joined We Glue 🎉';
  END IF;
  RETURN COALESCE(p_incoming, p_current);
END;
$$;
REVOKE ALL ON FUNCTION grouped_notification_message(TEXT, UUID, INT, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

-- ── C. Match the single-student (ungrouped, first-occurrence) template ────

CREATE OR REPLACE FUNCTION process_social_proof_events()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event  RECORD;
  v_name   TEXT;
  v_count  INT := 0;
BEGIN
  FOR v_event IN
    SELECT * FROM social_proof_events
    WHERE processed = false AND created_at > now() - interval '2 days'
    ORDER BY created_at
    LIMIT 50
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT COALESCE(NULLIF(full_name, ''), username) INTO v_name
    FROM profiles WHERE id = v_event.actor_id;

    IF v_name IS NOT NULL THEN
      -- Daily-grouped, push-disabled (registry): the inbox feels alive
      -- without a push per signup. The BEFORE-INSERT trigger merges these
      -- into the named format (grouped_notification_message, PART B) per
      -- recipient once a second student joins within the group window.
      -- 085: "[Name] joined We Glue 🎉" — exact founder template.
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
      SELECT p.id, v_event.actor_id, 'student_joined', NULL, NULL, false,
             v_name || ' joined We Glue 🎉'
      FROM profiles p
      WHERE p.id <> v_event.actor_id AND COALESCE(p.is_seed, false) = false;
    END IF;

    UPDATE social_proof_events SET processed = true WHERE id = v_event.id;
    v_count := v_count + 1;
  END LOOP;

  -- Housekeeping: anything older than the freshness window is stale noise.
  UPDATE social_proof_events SET processed = true
  WHERE processed = false AND created_at <= now() - interval '2 days';

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION process_social_proof_events() FROM PUBLIC, anon, authenticated;

-- ── D. Keep the destination in sync with who is now named ─────────────────

CREATE OR REPLACE FUNCTION notifications_prepare()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg    notification_types%ROWTYPE;
  v_target notifications%ROWTYPE;
BEGIN
  BEGIN
    SELECT * INTO v_reg FROM notification_types WHERE type = NEW.type;
    IF FOUND AND NOT v_reg.enabled THEN RETURN NULL; END IF;
    IF FOUND AND NOT v_reg.in_app THEN RETURN NULL; END IF;

    IF NEW.route IS NULL THEN
      NEW.route := notification_route(NEW.type, NEW.entity_id, NEW.entity_type, NEW.actor_id);
    END IF;

    IF FOUND AND v_reg.group_window_minutes > 0 THEN
      NEW.group_key    := COALESCE(NEW.group_key, NEW.type || ':' || COALESCE(NEW.entity_id::text, 'global'));
      NEW.group_actors := COALESCE(NEW.group_actors, CASE WHEN NEW.actor_id IS NULL THEN NULL ELSE ARRAY[NEW.actor_id] END);

      SELECT * INTO v_target
      FROM notifications
      WHERE user_id = NEW.user_id AND group_key = NEW.group_key AND read = false
        AND updated_at > now() - make_interval(mins => v_reg.group_window_minutes)
      ORDER BY updated_at DESC
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        IF v_reg.group_dedupe_actor AND NEW.actor_id IS NOT NULL
           AND (v_target.actor_id = NEW.actor_id
                OR COALESCE(v_target.group_actors, '{}') @> ARRAY[NEW.actor_id]) THEN
          RETURN NULL; -- this actor is already represented in the group
        END IF;

        UPDATE notifications
        SET actor_id     = COALESCE(NEW.actor_id, v_target.actor_id),
            group_count  = v_target.group_count + 1,
            group_actors = CASE
              WHEN NEW.actor_id IS NULL THEN v_target.group_actors
              WHEN COALESCE(v_target.group_actors, '{}') @> ARRAY[NEW.actor_id] THEN v_target.group_actors
              ELSE COALESCE(v_target.group_actors, '{}') || NEW.actor_id
            END,
            message      = grouped_notification_message(
                             NEW.type, NEW.entity_id, v_target.group_count + 1,
                             v_target.message, NEW.message,
                             COALESCE(NEW.actor_id, v_target.actor_id)),
            -- 085: recompute the destination too. The three grouped types
            -- today are member_joined/like/comment (route depends only on
            -- the stable entity_id — recomputing is a harmless no-op) and
            -- student_joined (route depends on actor_id via the
            -- profile-fallback branch — recomputing is the actual fix: the
            -- notification now always opens the SAME person it names).
            route        = notification_route(
                             NEW.type, v_target.entity_id, v_target.entity_type,
                             COALESCE(NEW.actor_id, v_target.actor_id)),
            created_at   = now(),
            seen_at      = NULL
        WHERE id = v_target.id;
        RETURN NULL; -- merged; no new row
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notifications_prepare failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
