-- ============================================================
-- We Glue – Notification event-coverage audit fixes (correction 4)
-- Migration: 083_notification_coverage_audit_fixes.sql
--
-- A full audit of the 29-type notification_types registry (046) and every
-- trigger that inserts into `notifications` found several concrete gaps.
-- This migration fixes the ones that are unambiguous bugs or explicitly
-- founder-requested coverage — not a registry rewrite.
--
--   A. officer_role could re-fire on a no-op re-add: add_club_officer()'s
--      ON CONFLICT DO UPDATE always touched role_title even when the value
--      was unchanged, and Postgres's `AFTER UPDATE OF role_title` trigger
--      fires whenever a column is TOUCHED by an UPDATE's SET list, not only
--      when its value actually changes. Re-running add_club_officer with
--      the same title re-sent "You have been added as [Role] of [Club]."
--      Fixed at both layers: the UPSERT now only touches role_title/
--      display_name/avatar_url when something actually differs (matching
--      the WHERE-guarded pattern the club_members upsert two lines above it
--      already uses), and the trigger function itself now no-ops on
--      OLD.role_title = NEW.role_title as defense in depth.
--
--   B. club_chat_added could re-fire on a no-op re-add: add_club_member_by_
--      officer() inserted the notification unconditionally after an
--      `ON CONFLICT DO NOTHING` club_members insert, with no FOUND check —
--      contrast with officer_chat_added (038), which already correctly
--      gates on FOUND. Fixed by capturing FOUND immediately after the
--      club_members insert (before it can be clobbered by the following
--      UPDATE) and gating the notification on it.
--
--   C. group_chat_added could re-fire on a no-op re-add: add_group_
--      participants() always notified after an `ON CONFLICT DO UPDATE SET
--      hidden_at = NULL`, even for someone already an active participant.
--      Fixed by only notifying when the person was NOT already an active
--      (non-hidden) participant — so a genuinely new add or a restore from
--      "left/hidden" still notifies, but re-adding an already-current
--      member does not.
--
--   D. club_inactive rendered as "Someone interacted with you" in both
--      clients' inboxes: check_club_inactivity() (006) inserted with no
--      `message` at all, and neither client's notificationDescription()
--      switch has a case for this type, so it fell through to the generic
--      default with a null sender. Fixed by setting message explicitly, the
--      same way every other trigger in this system already does.
--
--   E. Officer-uploaded club photos generated NO notification of any kind —
--      the founder's coverage list explicitly asks for "new club posts AND
--      PHOTOS." Photos attached to a post already get one via club_post
--      (trg_post_tagged_club_photo, 006, `source = 'tagged_post'`); a photo
--      an officer uploads directly to the club gallery (`source =
--      'officer_upload'`, RLS policy "club_photos: officers can insert",
--      006) had no trigger on club_photos at all. New type `club_photo`,
--      registered like every other type in the 046 registry, notifies every
--      OTHER club member exactly once per photo — same recipient-fanout and
--      dedupe_key pattern notify_club_post() already uses, and explicitly
--      scoped to officer_upload so a tagged-post photo is never double-
--      notified alongside its club_post row.
-- ============================================================

-- ── A. officer_role: no-op guard ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_club_officer_role_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club_name TEXT;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- 083: an UPDATE that touched role_title without changing its value (e.g.
  -- add_club_officer called again with the same title) must not re-notify.
  IF TG_OP = 'UPDATE' AND OLD.role_title IS NOT DISTINCT FROM NEW.role_title THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT name INTO v_club_name FROM clubs WHERE id = NEW.club_id;
    IF v_club_name IS NOT NULL THEN
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
      VALUES (
        NEW.user_id, COALESCE(auth.uid(), NEW.user_id), 'officer_role',
        NEW.club_id, 'club', false,
        'You have been added as ' || NEW.role_title || ' of ' || v_club_name || '.'
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_club_officer_role_notify failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
-- Trigger definition (033) is unchanged: AFTER INSERT OR UPDATE OF role_title
-- ON club_officers — the guard above, not the trigger's column list, is what
-- needed to change (an UPDATE that never touches role_title still can't fire
-- it, which is correct: this notification is specifically about the title).

CREATE OR REPLACE FUNCTION add_club_officer(
  p_club_id    UUID,
  p_user_id    UUID,
  p_role_title TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_title   TEXT := btrim(COALESCE(p_role_title, ''));
  v_display_name TEXT;
  v_avatar_url   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM club_members
    WHERE club_id = p_club_id AND user_id = auth.uid() AND role = 'officer'
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF length(v_role_title) < 2 OR length(v_role_title) > 40 THEN
    RAISE EXCEPTION 'invalid_role_title';
  END IF;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), username), avatar_url
  INTO v_display_name, v_avatar_url
  FROM profiles WHERE id = p_user_id;

  IF v_display_name IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  -- Member row: insert as officer, or promote an existing member.
  -- Fires handle_club_join / handle_club_member_role_change, which
  -- handle both group chats + notifications idempotently.
  INSERT INTO club_members (club_id, user_id, role)
  VALUES (p_club_id, p_user_id, 'officer')
  ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'officer'
  WHERE club_members.role IS DISTINCT FROM 'officer';

  -- Display record with the typed role title. The conflict target names the
  -- partial unique index uq_club_officers_club_user (user_id IS NOT NULL) —
  -- p_user_id is always non-null here.
  -- 083: only actually UPDATE (and so only let the trigger fire) when
  -- something really changed — same WHERE-guard shape as club_members above.
  INSERT INTO club_officers (club_id, user_id, role_title, display_name, avatar_url)
  VALUES (p_club_id, p_user_id, v_role_title, v_display_name, v_avatar_url)
  ON CONFLICT (club_id, user_id) WHERE user_id IS NOT NULL DO UPDATE
    SET role_title = EXCLUDED.role_title,
        display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url
  WHERE club_officers.role_title IS DISTINCT FROM EXCLUDED.role_title
     OR club_officers.display_name IS DISTINCT FROM EXCLUDED.display_name
     OR club_officers.avatar_url IS DISTINCT FROM EXCLUDED.avatar_url;
END;
$$;

-- ── B. club_chat_added: FOUND guard ───────────────────────────────────────

CREATE OR REPLACE FUNCTION add_club_member_by_officer(p_club_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_club_name TEXT;
  v_club_univ TEXT;
  v_user_univ TEXT;
  v_was_new   BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT is_club_officer(p_club_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT name, university INTO v_club_name, v_club_univ FROM clubs WHERE id = p_club_id;
  SELECT university INTO v_user_univ FROM profiles WHERE id = p_user_id;
  IF v_user_univ IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_club_univ IS NOT NULL AND v_user_univ IS DISTINCT FROM v_club_univ THEN
    RAISE EXCEPTION 'different_university';
  END IF;

  -- handle_club_join fires: adds Members-chat participant + join notifications.
  INSERT INTO club_members (club_id, user_id, role)
  VALUES (p_club_id, p_user_id, 'member')
  ON CONFLICT (club_id, user_id) DO NOTHING;
  -- 083: capture immediately — the UPDATE below would otherwise clobber FOUND.
  v_was_new := FOUND;

  -- If they had left/hidden the chat before, restore inbox visibility.
  UPDATE conversation_participants cp SET hidden_at = NULL
  FROM conversations c
  WHERE c.id = cp.conversation_id AND c.club_id = p_club_id
    AND c.type = 'club_group' AND cp.user_id = p_user_id;

  -- 083: only notify when this call actually added a new member — re-running
  -- this RPC for someone already in the club must not re-send "You were
  -- added to..." (they were not).
  IF v_was_new THEN
    BEGIN
      IF v_club_name IS NOT NULL THEN
        INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
        VALUES (p_user_id, auth.uid(), 'club_chat_added', p_club_id, 'club', false,
                'You were added to ' || v_club_name || '. You are now a member and can access the Members chat.');
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END;
$$;

-- ── C. group_chat_added: only notify when genuinely not-already-active ────

CREATE OR REPLACE FUNCTION public.add_group_participants(p_conversation_id uuid, p_user_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me            uuid := (SELECT auth.uid());
  v_uid           uuid;
  v_blocked       uuid[];
  v_already_active boolean;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = p_conversation_id AND type = 'group'
      AND created_by = v_me AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Lock every pair first, in ascending LOCK-KEY order (see create_group_chat
  -- for why key order rather than id order), then read the relationship under
  -- the locks so a block committing mid-call cannot be missed.
  PERFORM pg_advisory_xact_lock(k)
     FROM (SELECT DISTINCT private.user_pair_lock_key(v_me, pid) AS k
             FROM unnest(COALESCE(p_user_ids,'{}')) pid
            WHERE pid IS NOT NULL AND pid <> v_me
            ORDER BY 1) locks;

  v_blocked := public.blocked_user_ids();

  FOREACH v_uid IN ARRAY COALESCE(p_user_ids,'{}') LOOP
    IF v_uid IS NOT NULL
       AND v_uid <> ALL (v_blocked)                 -- ← blocked pair excluded
       AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
      -- 083: a person already an active (non-hidden) participant is a true
      -- no-op re-add — must not re-notify "You were added to a group chat."
      SELECT EXISTS (
        SELECT 1 FROM public.conversation_participants
        WHERE conversation_id = p_conversation_id AND user_id = v_uid AND hidden_at IS NULL
      ) INTO v_already_active;

      INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (p_conversation_id, v_uid)
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET hidden_at = NULL;

      IF NOT v_already_active THEN
        BEGIN
          INSERT INTO public.notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
          VALUES (v_uid, v_me, 'group_chat_added', p_conversation_id, 'message', false,
                  'You were added to a group chat.');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- ── D. club_inactive: real message text ────────────────────────────────────

CREATE OR REPLACE FUNCTION check_club_inactivity()
RETURNS void AS $$
DECLARE
  v_month INT;
  v_club  RECORD;
  v_off   RECORD;
BEGIN
  v_month := EXTRACT(MONTH FROM NOW())::INT;
  -- Do not run during June (6), July (7), or December (12)
  IF v_month IN (6, 7, 12) THEN
    RETURN;
  END IF;

  -- Step 1: Warn clubs inactive for 30+ days with no prior warning
  FOR v_club IN
    SELECT id, name
    FROM clubs
    WHERE is_active = true
      AND (last_activity_at IS NULL OR last_activity_at < NOW() - INTERVAL '30 days')
      AND inactivity_warned_at IS NULL
  LOOP
    UPDATE clubs SET inactivity_warned_at = NOW() WHERE id = v_club.id;

    -- Notify every officer of the inactive club
    FOR v_off IN
      SELECT user_id FROM club_members
      WHERE club_id = v_club.id AND role = 'officer'
    LOOP
      -- 083: was inserted with no `message` at all, which rendered as
      -- "Someone interacted with you" in both clients' inboxes (neither has
      -- a notificationDescription case for this type, and there is no
      -- actor to fall back to). Every other trigger in this system sets
      -- message explicitly; this one now does too.
      INSERT INTO notifications (user_id, type, entity_id, entity_type, read, message)
      VALUES (
        v_off.user_id, 'club_inactive', v_club.id, 'club', false,
        v_club.name || ' has had no activity for 30+ days and will be archived if this continues.'
      );
    END LOOP;
  END LOOP;

  -- Step 2: Soft-delete clubs still inactive 2+ days after warning
  UPDATE clubs
  SET is_active = false
  WHERE is_active = true
    AND inactivity_warned_at IS NOT NULL
    AND inactivity_warned_at < NOW() - INTERVAL '2 days'
    AND (last_activity_at IS NULL OR last_activity_at < inactivity_warned_at);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── E. New type: club_photo (officer-uploaded club gallery photos) ────────

INSERT INTO notification_types
  (type, category, enabled, in_app, push, group_window_minutes, group_dedupe_actor, description)
VALUES
  ('club_photo', 'clubs', true, true, true, 0, false, 'New officer-uploaded photo in a joined club')
ON CONFLICT (type) DO NOTHING;

-- Same blockable classification as club_post: official club content, never
-- suppressed between a blocked pair (057's blocking-suppression trigger
-- reads this column for every type, present and future).
UPDATE notification_types SET blockable = false WHERE type = 'club_photo';

CREATE OR REPLACE FUNCTION notify_club_photo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club TEXT;
  v_uploader TEXT;
BEGIN
  -- Photos attached to a post already notify via club_post
  -- (trg_post_tagged_club_photo -> posts -> trg_club_post_notify). Only a
  -- direct officer upload to the gallery needs its own notification.
  IF NEW.source IS DISTINCT FROM 'officer_upload' THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT name INTO v_club FROM clubs WHERE id = NEW.club_id;
    SELECT COALESCE(NULLIF(full_name, ''), username) INTO v_uploader FROM profiles WHERE id = NEW.uploaded_by;
    IF v_club IS NULL THEN RETURN NEW; END IF;

    INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key)
    SELECT cm.user_id, NEW.uploaded_by, 'club_photo', NEW.id, 'club', false,
           COALESCE(v_uploader, 'A club officer') || ' added a new photo to ' || v_club || '.',
           'club_photo:' || NEW.id || ':' || cm.user_id
    FROM club_members cm
    WHERE cm.club_id = NEW.club_id AND cm.user_id IS DISTINCT FROM NEW.uploaded_by
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_club_photo failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_photo_notify ON club_photos;
CREATE TRIGGER trg_club_photo_notify
  AFTER INSERT ON club_photos
  FOR EACH ROW EXECUTE FUNCTION notify_club_photo();

-- Route: no dedicated photo-detail screen exists yet, so — like
-- event_canceled routing to `club` once its own row is gone — a club_photo
-- notification opens the club profile, where the photo is visible.
CREATE OR REPLACE FUNCTION notification_route(
  p_type TEXT, p_entity_id UUID, p_entity_type TEXT, p_actor_id UUID
) RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
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

-- Push copy: title/body for club_photo (falls through today's ELSE otherwise
-- — that ELSE already uses n.message, which notify_club_photo sets, so this
-- is a title-only improvement, matching club_post's own case just above it).
CREATE OR REPLACE FUNCTION notification_push_copy(n notifications)
RETURNS TABLE (title TEXT, body TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  TEXT;
  v_others INT := GREATEST(COALESCE(n.group_count, 1) - 1, 0);
BEGIN
  SELECT COALESCE(NULLIF(full_name, ''), username) INTO v_actor
  FROM profiles WHERE id = n.actor_id;
  v_actor := COALESCE(v_actor, 'Someone');

  CASE n.type
    WHEN 'like' THEN
      title := 'We Glue';
      body  := CASE WHEN v_others > 0
                 THEN v_actor || ' and ' || v_others || ' others liked your post.'
                 ELSE v_actor || ' liked your post.' END;
    WHEN 'comment' THEN
      title := 'We Glue';
      body  := CASE WHEN v_others > 0
                 THEN v_actor || ' and ' || v_others || ' others commented on your post.'
                 ELSE v_actor || ' commented on your post.' END;
    WHEN 'new_follower'    THEN title := 'We Glue'; body := v_actor || ' started following you.';
    WHEN 'follow_request'  THEN title := 'We Glue'; body := v_actor || ' requested to follow you.';
    WHEN 'follow_accepted' THEN title := 'We Glue'; body := v_actor || ' accepted your follow request.';
    WHEN 'gluemate'        THEN title := 'We Glue'; body := v_actor || ' is now your Gluemate! 🎉';
    WHEN 'new_event' THEN
      SELECT c.name, c.name || ' posted a new event: ' || e.title
        INTO title, body
      FROM events e JOIN clubs c ON c.id = e.club_id
      WHERE e.id = n.entity_id;
      title := COALESCE(title, 'We Glue');
      body  := COALESCE(body, COALESCE(n.message, 'A club you joined posted a new event.'));
    WHEN 'club_post' THEN
      title := COALESCE((SELECT c.name FROM posts p JOIN clubs c ON c.id = p.club_id
                         WHERE p.id = n.entity_id), 'We Glue');
      body  := COALESCE(n.message, v_actor || ' shared a new post.');
    WHEN 'club_photo' THEN
      title := COALESCE((SELECT c.name FROM club_photos cp JOIN clubs c ON c.id = cp.club_id
                         WHERE cp.id = n.entity_id), 'We Glue');
      body  := COALESCE(n.message, v_actor || ' added a new photo.');
    WHEN 'event_reminder_tomorrow', 'event_reminder_hour', 'event_reminder_now',
         'event_last_chance' THEN
      title := 'Event reminder';
      body  := COALESCE(n.message, 'An event you follow is coming up.');
    WHEN 'event_updated' THEN
      title := 'Event update';
      body  := COALESCE(n.message, 'An event you are going to changed.');
    WHEN 'event_canceled' THEN
      title := 'Event canceled';
      body  := COALESCE(n.message, 'An event you were going to was canceled.');
    ELSE
      title := 'We Glue';
      body  := COALESCE(n.message, 'You have a new notification.');
  END CASE;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION notification_push_copy(notifications) FROM PUBLIC, anon, authenticated;
