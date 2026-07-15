-- ============================================================================
-- 046_complete_notifications_system.sql
-- Complete cross-platform notification system foundation.
--
-- AUDIT RESULT (2026-07-15), building on migration 031:
--   • notifications (001/031/033) works as the in-app inbox: SECURITY DEFINER
--     triggers cover follows / likes / comments / new events (031), club
--     joins, officer changes, tag removal (033/038), and group-chat flows
--     (040). The mobile inbox (app/home/notifications.tsx) renders it with
--     realtime INSERT updates.
--   • MISSING entirely: push infrastructure (no tokens, no delivery, no
--     expo-notifications), notification preferences, event reminders, a
--     structured route payload (clients guess destinations from
--     type+entity_id), grouping/dedup keys, read timestamps, social-proof,
--     new-club-post notifications, and event update/cancel notifications.
--   • INSECURE: 001's INSERT policy is TO authenticated WITH CHECK (true) —
--     any logged-in user could insert arbitrary notifications for any other
--     user. No client code inserts notifications since 031, so it is dropped
--     here. The UPDATE policy also lacked WITH CHECK.
--   • Message unread state is authoritative and stays UNCHANGED:
--     conversation_participants.last_read_at (011/040) for DMs/groups and
--     channel_reads (041) per club thread. This migration only adds a cheap
--     aggregate (get_unread_summary) over the same rules for the tab badge.
--
-- WHAT THIS MIGRATION ADDS (extends 031 — no duplicate tables, no second
-- unread system):
--   1. notification_types registry (replaces the ever-growing CHECK constraint
--      with an FK) — category, in-app/push eligibility, grouping policy.
--   2. notifications: route JSONB, group/dedupe keys, group_count/actors,
--      read_at/seen_at/updated_at; realtime UPDATE sync for cross-device read
--      state.
--   3. Generic BEFORE INSERT grouping/dedup + route filling and AFTER
--      INSERT/UPDATE push enqueueing on notifications, so every EXISTING
--      trigger (031/033/038/040) gains routes + push with zero changes.
--   4. push_tokens (per-device Expo tokens) + register/deactivate RPCs.
--   5. notification_preferences (per-category push toggles) enforced
--      server-side in enqueue_push.
--   6. push_queue + enqueue_push: single delivery pipeline with per-category
--      hourly caps, collapse keys (burst replacement) and dedupe keys;
--      processed by the send-push Edge Function (claim_push_batch).
--   7. Message pushes: AFTER INSERT ON messages → push-only (no inbox rows;
--      the Messages tab badge is thread-based), honoring mutes and channel
--      mutes, with exact-channel copy ("#events · Camila: …").
--   8. Server-authoritative event reminders (process_event_reminders, pg_cron
--      every 5 min): tomorrow / 1 hour / starting now for Going users, last
--      chance to RSVP for members without an RSVP. America/Chicago + DST safe,
--      idempotent (dedupe includes the event start timestamp, so edits re-arm
--      and duplicates are impossible), self-canceling (recipients re-evaluated
--      at send time: deleted/canceled events, left clubs, changed RSVPs all
--      drop out naturally).
--   9. Early-launch social proof: social_proof_events work table (one cheap
--      guarded INSERT per signup — NEVER fan-out inside the auth transaction,
--      per the migration-027 lesson) fanned out by the reminder cron into
--      daily-grouped, push-disabled in-app rows ("5 new students joined We
--      Glue"). member_joined ("X joined <club>") becomes daily-grouped too.
--  10. New notification types: club_post (new post in a joined club),
--      event_updated (time/location changes, repeated edits merge into one),
--      event_canceled (fires BEFORE DELETE, targeted at Going users, routed to
--      the club since the event row disappears), the four reminder kinds and
--      student_joined.
--  11. get_unread_summary(): one RPC → unread inbox count + unread THREAD
--      count (DMs, groups, per-channel club/officer threads — one thread with
--      20 messages counts once) for the two badges, mirroring chatService
--      semantics exactly (own messages never count, cleared/hidden/deleted
--      excluded, muted still counts but pushes are suppressed).
--
-- POLICY DEFAULTS (documented per the product spec):
--   • Grouping windows: likes 6h, comments 30m, member_joined/student_joined
--     24h, event_updated 24h (repeat edits replace).
--   • Push caps per user/hour: messages 30, social 10, clubs 10, events 10,
--     account 10, social_proof 0 (in-app only by default).
--   • Reminder leads: tomorrow 24h, one hour 60m, starting now 0m, last
--     chance 6h — all configurable in notification_config without client
--     changes.
--   • preferences default: all push categories ON except social proof.
--
-- Every function: SECURITY DEFINER with SET search_path = public, minimal
-- grants (EXECUTE revoked from anon and, for internal ones, from
-- authenticated — the migration-045 lockdown rule). Trigger bodies swallow
-- their own errors so a notification hiccup never rolls back a user action
-- (the migration-031 rule).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. notification_types registry
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_types (
  type                 TEXT PRIMARY KEY,
  category             TEXT NOT NULL CHECK (category IN
                         ('messages','events','clubs','social','social_proof','account')),
  enabled              BOOLEAN NOT NULL DEFAULT true,
  in_app               BOOLEAN NOT NULL DEFAULT true,
  push                 BOOLEAN NOT NULL DEFAULT true,
  -- 0 = never grouped. >0 = unread rows with the same group_key merge inside
  -- this window ("Camila and 4 others liked your post").
  group_window_minutes INT NOT NULL DEFAULT 0,
  -- true = one actor can only be represented once per group (likes, joins);
  -- false = every action counts (comments).
  group_dedupe_actor   BOOLEAN NOT NULL DEFAULT false,
  description          TEXT
);

ALTER TABLE notification_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_types: readable" ON notification_types;
CREATE POLICY "notification_types: readable"
  ON notification_types FOR SELECT TO authenticated USING (true);
GRANT SELECT ON notification_types TO authenticated;

INSERT INTO notification_types
  (type, category, enabled, in_app, push, group_window_minutes, group_dedupe_actor, description) VALUES
  -- social
  ('follow_request',   'social', true,  true,  true,  0,    false, 'Follow request (private accounts)'),
  ('follow_accepted',  'social', true,  true,  true,  0,    false, 'Your follow request was accepted'),
  ('new_follower',     'social', true,  true,  true,  0,    false, 'Someone started following you'),
  ('gluemate',         'social', true,  true,  true,  0,    false, 'Mutual follow'),
  ('like',             'social', true,  true,  true,  360,  true,  'Like on your post (grouped per post)'),
  ('comment',          'social', true,  true,  true,  30,   false, 'Comment on your post (bursts group)'),
  -- clubs
  ('new_event',        'clubs',  true,  true,  true,  0,    false, 'New event in a joined club'),
  ('club_post',        'clubs',  true,  true,  true,  0,    false, 'New post in a joined club'),
  ('club_joined',      'clubs',  true,  true,  false, 0,    false, 'You joined a club (in-app confirmation)'),
  ('club_chat_added',  'clubs',  true,  true,  true,  0,    false, 'Added to the club members chat'),
  ('officer_chat_added','clubs', true,  true,  true,  0,    false, 'Added to the club officers chat'),
  ('officer_role',     'clubs',  true,  true,  true,  0,    false, 'You became an officer'),
  ('officer_removed',  'clubs',  true,  true,  true,  0,    false, 'Officer role removed'),
  ('group_chat_added', 'clubs',  true,  true,  true,  0,    false, 'Added to a group chat'),
  ('club_removed',     'clubs',  true,  true,  true,  0,    false, 'Removed from a club'),
  ('chat_invite_joined','clubs', true,  true,  true,  0,    false, 'Someone joined via your chat invite'),
  ('club_inactive',    'clubs',  true,  true,  false, 0,    false, 'Club inactivity warning (system)'),
  -- events
  -- group_dedupe_actor stays FALSE: every edit must REFRESH the one unread
  -- row (message + recency) even when the same officer edits repeatedly;
  -- the min-gap throttle still caps pushes at one per window.
  ('event_updated',            'events', true, true, true, 1440, false, 'Event time/location changed (edits merge)'),
  ('event_canceled',           'events', true, true, true, 0,    false, 'Event canceled'),
  ('event_reminder_tomorrow',  'events', true, true, true, 0,    false, 'Event is tomorrow (Going)'),
  ('event_reminder_hour',      'events', true, true, true, 0,    false, 'Event in one hour (Going)'),
  ('event_reminder_now',       'events', true, true, true, 0,    false, 'Event starting now (Going)'),
  ('event_last_chance',        'events', true, true, true, 0,    false, 'Last chance to RSVP (members without RSVP)'),
  ('event_rsvp',               'events', true, true, true, 0,    false, 'RSVP on your event (legacy)'),
  -- social proof (in-app only by default: quiet aggregation, no push spam)
  ('member_joined',    'social_proof', true, true, false, 1440, true, 'A student joined a club you are in (grouped daily)'),
  ('student_joined',   'social_proof', true, true, false, 1440, true, 'A new student joined We Glue (grouped daily)'),
  -- messages (push-only policy anchors; the inbox never shows these — the
  -- Messages tab thread badge is the in-app representation)
  ('dm_message',       'messages', true, false, true, 0, false, 'New direct message (push only)'),
  ('group_message',    'messages', true, false, true, 0, false, 'New group message (push only)'),
  ('club_chat_message','messages', true, false, true, 0, false, 'New club chat/channel message (push only)'),
  ('new_message',      'messages', false, true, false, 0, false, 'Legacy type (kept for old rows)')
ON CONFLICT (type) DO UPDATE SET
  category = EXCLUDED.category,
  in_app   = EXCLUDED.in_app,
  push     = EXCLUDED.push,
  group_window_minutes = EXCLUDED.group_window_minutes,
  group_dedupe_actor   = EXCLUDED.group_dedupe_actor,
  description = EXCLUDED.description;

-- Registry replaces the CHECK constraint: adding a type is an INSERT, not an
-- ALTER. All values allowed by the old CHECK (040) are seeded above.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_fkey;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_fkey
  FOREIGN KEY (type) REFERENCES notification_types(type) ON UPDATE CASCADE;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. notifications: structured target, grouping, read/seen timestamps
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS route        JSONB,
  ADD COLUMN IF NOT EXISTS group_key    TEXT,
  ADD COLUMN IF NOT EXISTS dedupe_key   TEXT,
  ADD COLUMN IF NOT EXISTS group_count  INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS group_actors UUID[],
  ADD COLUMN IF NOT EXISTS read_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seen_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();

-- Idempotency: the same logical notification can never be produced twice
-- (scheduler retries, realtime reconnects, app retries).
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe_key
  ON notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Group-merge lookup: newest unread row per (user, group).
CREATE INDEX IF NOT EXISTS idx_notifications_user_group_unread
  ON notifications (user_id, group_key) WHERE read = false AND group_key IS NOT NULL;

-- read flag ↔ timestamp stay consistent no matter which client writes.
CREATE OR REPLACE FUNCTION notifications_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.read AND NOT COALESCE(OLD.read, false) THEN
    NEW.read_at := COALESCE(NEW.read_at, now());
  ELSIF NOT NEW.read THEN
    NEW.read_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_touch ON notifications;
CREATE TRIGGER trg_notifications_touch
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION notifications_touch();

-- SECURITY FIX: 001 allowed ANY authenticated user to insert notifications
-- for ANY user. All creation is trigger/definer-side since 031; drop it.
DROP POLICY IF EXISTS "notifications: service can insert" ON notifications;

-- Tighten UPDATE: a user may only mark their OWN rows and cannot re-target
-- them at someone else (WITH CHECK was missing).
DROP POLICY IF EXISTS "notifications: users update own (mark read)" ON notifications;
CREATE POLICY "notifications: users update own (mark read)"
  ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ────────────────────────────────────────────────────────────────────────────
-- 3. Central config (timings/caps — change policy without code changes)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT
);
ALTER TABLE notification_config ENABLE ROW LEVEL SECURITY;
-- No client policies: server-side only.

INSERT INTO notification_config (key, value, description) VALUES
  ('reminder.tomorrow_lead_minutes',    '1440', 'Event tomorrow reminder lead'),
  ('reminder.hour_lead_minutes',        '60',   'Event in one hour reminder lead'),
  ('reminder.now_lead_minutes',         '0',    'Event starting now lead'),
  ('reminder.last_chance_lead_minutes', '360',  'Last chance to RSVP lead'),
  ('reminder.catchup_window_minutes',   '30',   'How far past the ideal send time a missed reminder may still fire'),
  ('push.hourly_caps',
   '{"messages":30,"social":10,"clubs":10,"events":10,"account":10,"social_proof":0}',
   'Max pushes per user per category per hour; 0 disables push for the category'),
  ('push.dispatch_url',
   '"https://yoozrnosmqtaiksgcixc.supabase.co/functions/v1/send-push"',
   'Edge Function invoked by the dispatch cron')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION notification_config_int(p_key TEXT, p_default INT)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT (value #>> '{}')::INT FROM notification_config WHERE key = p_key), p_default);
$$;
REVOKE ALL ON FUNCTION notification_config_int(TEXT, INT) FROM PUBLIC, anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. Per-device push tokens
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL CHECK (platform IN ('ios','android')),
  environment  TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('development','production')),
  device_name  TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invalid','revoked')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active
  ON push_tokens (user_id) WHERE status = 'active';

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
-- Users may see and delete their own device rows; all writes go through the
-- RPCs below so a token can never be attached to two users at once.
DROP POLICY IF EXISTS "push_tokens: read own" ON push_tokens;
CREATE POLICY "push_tokens: read own"
  ON push_tokens FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "push_tokens: delete own" ON push_tokens;
CREATE POLICY "push_tokens: delete own"
  ON push_tokens FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Upsert keyed on the token itself: if a device changes accounts, the token
-- moves to the new user (never duplicated); rotation inserts the new token
-- alongside and receipts eventually invalidate the old one.
CREATE OR REPLACE FUNCTION register_push_token(
  p_token       TEXT,
  p_platform    TEXT,
  p_environment TEXT DEFAULT 'production',
  p_device_name TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_token IS NULL OR p_token = '' OR p_platform NOT IN ('ios','android')
     OR p_environment NOT IN ('development','production') THEN
    RAISE EXCEPTION 'invalid push token registration';
  END IF;

  INSERT INTO push_tokens (user_id, token, platform, environment, device_name)
  VALUES (auth.uid(), p_token, p_platform, p_environment, left(p_device_name, 80))
  ON CONFLICT (token) DO UPDATE SET
    user_id      = auth.uid(),
    platform     = EXCLUDED.platform,
    environment  = EXCLUDED.environment,
    device_name  = EXCLUDED.device_name,
    status       = 'active',
    last_seen_at = now();
END;
$$;
REVOKE ALL ON FUNCTION register_push_token(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION register_push_token(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- Logout: this device stops receiving pushes for this account.
CREATE OR REPLACE FUNCTION deactivate_push_token(p_token TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE push_tokens SET status = 'revoked', last_seen_at = now()
  WHERE token = p_token AND user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION deactivate_push_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION deactivate_push_token(TEXT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. Notification preferences (synced across devices; enforced server-side)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id           UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  push_enabled      BOOLEAN NOT NULL DEFAULT true,
  push_messages     BOOLEAN NOT NULL DEFAULT true,
  push_social       BOOLEAN NOT NULL DEFAULT true,
  push_clubs        BOOLEAN NOT NULL DEFAULT true,
  push_events       BOOLEAN NOT NULL DEFAULT true,
  push_social_proof BOOLEAN NOT NULL DEFAULT false,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_preferences: own row" ON notification_preferences;
CREATE POLICY "notification_preferences: own row"
  ON notification_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO authenticated;

-- Missing row = defaults. account category is never user-disableable.
CREATE OR REPLACE FUNCTION user_wants_push(p_user UUID, p_category TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefs notification_preferences%ROWTYPE;
BEGIN
  IF p_category = 'account' THEN RETURN true; END IF;
  SELECT * INTO prefs FROM notification_preferences WHERE user_id = p_user;
  IF NOT FOUND THEN
    RETURN p_category <> 'social_proof';
  END IF;
  IF NOT prefs.push_enabled THEN RETURN false; END IF;
  RETURN CASE p_category
    WHEN 'messages'     THEN prefs.push_messages
    WHEN 'social'       THEN prefs.push_social
    WHEN 'clubs'        THEN prefs.push_clubs
    WHEN 'events'       THEN prefs.push_events
    WHEN 'social_proof' THEN prefs.push_social_proof
    ELSE true
  END;
END;
$$;
REVOKE ALL ON FUNCTION user_wants_push(UUID, TEXT) FROM PUBLIC, anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. Push queue — the single delivery pipeline
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  title           TEXT,
  body            TEXT,
  route           JSONB NOT NULL DEFAULT '{}'::jsonb,
  collapse_key    TEXT,
  dedupe_key      TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','sent','suppressed','failed','skipped')),
  attempts        INT NOT NULL DEFAULT 0,
  scheduled_for   TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at      TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_queue_pending
  ON push_queue (scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_push_queue_user_recent
  ON push_queue (user_id, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_queue_collapse
  ON push_queue (user_id, collapse_key) WHERE status = 'pending';

ALTER TABLE push_queue ENABLE ROW LEVEL SECURITY;
-- No client policies: only SECURITY DEFINER functions and the service role
-- (Edge Function) touch this table.

-- Expo push tickets → receipt reconciliation → invalid-token cleanup.
CREATE TABLE IF NOT EXISTS push_tickets (
  ticket_id  TEXT PRIMARY KEY,
  push_id    UUID NOT NULL REFERENCES push_queue(id) ON DELETE CASCADE,
  token_id   UUID NOT NULL REFERENCES push_tokens(id) ON DELETE CASCADE,
  checked    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_tickets_unchecked
  ON push_tickets (created_at) WHERE checked = false;
ALTER TABLE push_tickets ENABLE ROW LEVEL SECURITY;

-- Central gate: registry kill-switch → user preference → hourly cap →
-- collapse (burst replacement) → dedupe. Internal only.
CREATE OR REPLACE FUNCTION enqueue_push(
  p_user            UUID,
  p_notification_id UUID,
  p_type            TEXT,
  p_title           TEXT,
  p_body            TEXT,
  p_route           JSONB,
  p_collapse_key    TEXT DEFAULT NULL,
  p_dedupe_key      TEXT DEFAULT NULL,
  p_min_gap_minutes INT DEFAULT 0
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg       notification_types%ROWTYPE;
  v_cap       INT;
  v_sent_hour INT;
BEGIN
  SELECT * INTO v_reg FROM notification_types WHERE type = p_type;
  IF NOT FOUND OR NOT v_reg.enabled OR NOT v_reg.push THEN RETURN; END IF;
  IF NOT user_wants_push(p_user, v_reg.category) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM push_tokens WHERE user_id = p_user AND status = 'active') THEN
    RETURN;
  END IF;

  v_cap := COALESCE((
    SELECT (value ->> v_reg.category)::INT FROM notification_config WHERE key = 'push.hourly_caps'
  ), 30);
  IF v_cap <= 0 THEN RETURN; END IF;
  SELECT count(*) INTO v_sent_hour
  FROM push_queue
  WHERE user_id = p_user AND category = v_reg.category
    AND created_at > now() - interval '1 hour'
    AND status IN ('pending','processing','sent');
  IF v_sent_hour >= v_cap THEN RETURN; END IF;

  -- Grouped re-notify throttle: if a push for this collapse group went out
  -- within the gap, stay quiet (the in-app row was still updated).
  IF p_collapse_key IS NOT NULL AND p_min_gap_minutes > 0 AND EXISTS (
    SELECT 1 FROM push_queue
    WHERE user_id = p_user AND collapse_key = p_collapse_key
      AND status = 'sent' AND sent_at > now() - make_interval(mins => p_min_gap_minutes)
  ) THEN
    RETURN;
  END IF;

  -- Burst replacement: an undelivered push for the same target absorbs this
  -- one instead of stacking (repeated event edits, rapid messages).
  IF p_collapse_key IS NOT NULL THEN
    UPDATE push_queue
    SET title = p_title, body = p_body, route = p_route,
        notification_id = COALESCE(p_notification_id, notification_id),
        created_at = now()
    WHERE user_id = p_user AND collapse_key = p_collapse_key AND status = 'pending';
    IF FOUND THEN RETURN; END IF;
  END IF;

  INSERT INTO push_queue (user_id, notification_id, category, title, body, route, collapse_key, dedupe_key)
  VALUES (p_user, p_notification_id, v_reg.category, p_title, p_body,
          COALESCE(p_route, '{}'::jsonb), p_collapse_key, p_dedupe_key)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION enqueue_push(UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, INT)
  FROM PUBLIC, anon, authenticated;

-- Edge Function work claim (service_role only): atomic, retry-safe.
CREATE OR REPLACE FUNCTION claim_push_batch(p_limit INT DEFAULT 100)
RETURNS SETOF push_queue
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE push_queue q
  SET status = 'processing', attempts = q.attempts + 1, claimed_at = now()
  WHERE q.id IN (
    SELECT id FROM push_queue
    WHERE status = 'pending' AND scheduled_for <= now()
    ORDER BY scheduled_for
    LIMIT LEAST(GREATEST(p_limit, 1), 500)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.*;
$$;
REVOKE ALL ON FUNCTION claim_push_batch(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_push_batch(INT) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. Route + push copy builders
-- ────────────────────────────────────────────────────────────────────────────
-- The single source of truth for where a notification LANDS. Clients validate
-- against their allowlist and never accept raw paths from push payloads.
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

-- Server-rendered copy for GROUPED rows whose message is templated (the
-- client renders like/comment grouping itself from group_count).
CREATE OR REPLACE FUNCTION grouped_notification_message(
  p_type TEXT, p_entity_id UUID, p_count INT, p_current TEXT, p_incoming TEXT
) RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club TEXT;
BEGIN
  IF p_count <= 1 THEN RETURN COALESCE(p_incoming, p_current); END IF;
  IF p_type = 'member_joined' THEN
    SELECT name INTO v_club FROM clubs WHERE id = p_entity_id;
    IF v_club IS NOT NULL THEN
      RETURN p_count || ' students joined ' || v_club || '.';
    END IF;
  ELSIF p_type = 'student_joined' THEN
    RETURN p_count || ' new students joined We Glue 🎉';
  END IF;
  RETURN COALESCE(p_incoming, p_current);
END;
$$;
REVOKE ALL ON FUNCTION grouped_notification_message(TEXT, UUID, INT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- Push title/body per type: clear, human, specific, short (Part 18 copy).
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


-- ────────────────────────────────────────────────────────────────────────────
-- 8. Generic notifications triggers: grouping/dedup/route (BEFORE INSERT) and
--    push enqueue (AFTER INSERT / AFTER grouped UPDATE). Because these hang on
--    the notifications TABLE, every existing creation path from 031/033/038/
--    040 gains routes, dedup and push without touching those functions.
-- ────────────────────────────────────────────────────────────────────────────
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
                             v_target.message, NEW.message),
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

DROP TRIGGER IF EXISTS trg_notifications_prepare ON notifications;
CREATE TRIGGER trg_notifications_prepare
  BEFORE INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION notifications_prepare();

CREATE OR REPLACE FUNCTION notifications_after_insert_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_copy RECORD;
BEGIN
  BEGIN
    SELECT * INTO v_copy FROM notification_push_copy(NEW);
    PERFORM enqueue_push(
      NEW.user_id, NEW.id, NEW.type, v_copy.title, v_copy.body, NEW.route,
      COALESCE(NEW.group_key, 'notif:' || NEW.id::text),
      'notif:' || NEW.id::text,
      0
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notifications_after_insert_push failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_push ON notifications;
CREATE TRIGGER trg_notifications_push
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION notifications_after_insert_push();

-- A group merge is an UPDATE, not an INSERT: re-push at most once per window
-- (min-gap = the type's group window), so 20 likes = 1 row and ≤2 pushes.
CREATE OR REPLACE FUNCTION notifications_after_group_merge_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_copy RECORD;
  v_window INT;
BEGIN
  BEGIN
    IF NEW.group_count > OLD.group_count AND NEW.read = false THEN
      SELECT group_window_minutes INTO v_window FROM notification_types WHERE type = NEW.type;
      SELECT * INTO v_copy FROM notification_push_copy(NEW);
      PERFORM enqueue_push(
        NEW.user_id, NEW.id, NEW.type, v_copy.title, v_copy.body, NEW.route,
        NEW.group_key,
        NULL,
        COALESCE(v_window, 60)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notifications_after_group_merge_push failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_group_push ON notifications;
CREATE TRIGGER trg_notifications_group_push
  AFTER UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION notifications_after_group_merge_push();

-- Unlike with grouped rows: remove the actor from the group; delete the row
-- only when it becomes empty (replaces 031's whole-row delete).
CREATE OR REPLACE FUNCTION handle_post_unlike_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author UUID;
  v_row    notifications%ROWTYPE;
BEGIN
  BEGIN
    SELECT author_id INTO v_author FROM posts WHERE id = OLD.post_id;
    IF v_author IS NULL THEN RETURN OLD; END IF;

    FOR v_row IN
      SELECT * FROM notifications
      WHERE user_id = v_author AND type = 'like' AND entity_id = OLD.post_id
        AND (actor_id = OLD.user_id OR COALESCE(group_actors, '{}') @> ARRAY[OLD.user_id])
      FOR UPDATE
    LOOP
      IF COALESCE(v_row.group_count, 1) <= 1 THEN
        DELETE FROM notifications WHERE id = v_row.id;
      ELSE
        UPDATE notifications
        SET group_actors = array_remove(COALESCE(group_actors, '{}'), OLD.user_id),
            group_count  = group_count - 1,
            actor_id     = COALESCE(
              (array_remove(COALESCE(group_actors, '{}'), OLD.user_id))[
                array_length(array_remove(COALESCE(group_actors, '{}'), OLD.user_id), 1)
              ],
              actor_id)
        WHERE id = v_row.id;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_post_unlike_notify failed: %', SQLERRM;
  END;
  RETURN OLD;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 9. New content triggers: club posts, event updates, event cancellation
-- ────────────────────────────────────────────────────────────────────────────
-- New post in a joined club (posts.club_id and/or club tags). Dedupe key
-- covers both paths so a tagged club post never notifies twice.
CREATE OR REPLACE FUNCTION notify_club_post(p_post_id UUID, p_club_id UUID, p_author UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club   TEXT;
  v_author TEXT;
BEGIN
  SELECT name INTO v_club FROM clubs WHERE id = p_club_id;
  SELECT COALESCE(NULLIF(full_name, ''), username) INTO v_author FROM profiles WHERE id = p_author;
  IF v_club IS NULL THEN RETURN; END IF;

  INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key)
  SELECT cm.user_id, p_author, 'club_post', p_post_id, 'post', false,
         COALESCE(v_author, 'A member') || ' shared a new post in ' || v_club || '.',
         'club_post:' || p_post_id || ':' || cm.user_id
  FROM club_members cm
  WHERE cm.club_id = p_club_id AND cm.user_id <> p_author
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION notify_club_post(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION handle_club_post_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NEW.club_id IS NOT NULL THEN
      PERFORM notify_club_post(NEW.id, NEW.club_id, NEW.author_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_club_post_notify failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_club_post_notify ON posts;
CREATE TRIGGER trg_club_post_notify
  AFTER INSERT ON posts
  FOR EACH ROW EXECUTE FUNCTION handle_club_post_notify();

CREATE OR REPLACE FUNCTION handle_post_club_tag_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author UUID;
BEGIN
  BEGIN
    SELECT author_id INTO v_author FROM posts WHERE id = NEW.post_id;
    IF v_author IS NOT NULL THEN
      PERFORM notify_club_post(NEW.post_id, NEW.club_id, v_author);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_post_club_tag_notify failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_club_tag_notify ON post_club_tags;
CREATE TRIGGER trg_post_club_tag_notify
  AFTER INSERT ON post_club_tags
  FOR EACH ROW EXECUTE FUNCTION handle_post_club_tag_notify();

-- Meaningful event edits → one merged "updated" notification per event
-- (group window 24h absorbs repeated edits) for users who said Going.
CREATE OR REPLACE FUNCTION handle_event_updated_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_what TEXT;
BEGIN
  BEGIN
    IF OLD.event_date IS DISTINCT FROM NEW.event_date
       OR OLD.start_time IS DISTINCT FROM NEW.start_time
       OR OLD.end_time IS DISTINCT FROM NEW.end_time THEN
      v_what := 'time';
    END IF;
    IF OLD.location IS DISTINCT FROM NEW.location
       OR OLD.building IS DISTINCT FROM NEW.building
       OR OLD.room IS DISTINCT FROM NEW.room THEN
      v_what := CASE WHEN v_what IS NULL THEN 'location' ELSE 'details' END;
    END IF;
    IF v_what IS NULL THEN RETURN NEW; END IF;

    INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message, group_key)
    SELECT r.user_id, NEW.created_by, 'event_updated', NEW.id, 'event', false,
           CASE v_what
             WHEN 'time'     THEN 'The time for ' || NEW.title || ' changed.'
             WHEN 'location' THEN 'The location for ' || NEW.title || ' changed.'
             ELSE NEW.title || ' was updated.'
           END,
           'event_updated:' || NEW.id
    FROM event_rsvps r
    WHERE r.event_id = NEW.id AND r.status = 'going' AND r.user_id <> COALESCE(NEW.created_by, r.user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_event_updated_notify failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_updated_notify ON events;
CREATE TRIGGER trg_event_updated_notify
  AFTER UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION handle_event_updated_notify();

-- Cancellation (= deletion in this product): tell Going users BEFORE the row
-- disappears; the notification routes to the CLUB (the event is gone), so
-- 038's after-delete cleanup of event-entity rows leaves it intact.
CREATE OR REPLACE FUNCTION handle_event_canceled_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
    SELECT r.user_id, OLD.created_by, 'event_canceled', OLD.club_id, 'club', false,
           OLD.title || ' was canceled.'
    FROM event_rsvps r
    WHERE r.event_id = OLD.id AND r.status = 'going'
      AND r.user_id <> COALESCE(OLD.created_by, r.user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_event_canceled_notify failed: %', SQLERRM;
  END;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_canceled_notify ON events;
CREATE TRIGGER trg_event_canceled_notify
  BEFORE DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION handle_event_canceled_notify();


-- ────────────────────────────────────────────────────────────────────────────
-- 10. Message pushes (push-only; the Messages tab badge is the in-app state)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_message_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv       conversations%ROWTYPE;
  v_sender     TEXT;
  v_channel    TEXT;
  v_is_channel BOOLEAN := false;
  v_club       TEXT;
  v_preview    TEXT;
  v_title      TEXT;
  v_body       TEXT;
  v_type       TEXT;
  v_recipient  RECORD;
BEGIN
  BEGIN
    IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

    SELECT * INTO v_conv FROM conversations WHERE id = NEW.conversation_id;
    IF NOT FOUND OR v_conv.deleted_at IS NOT NULL THEN RETURN NEW; END IF;

    SELECT COALESCE(NULLIF(full_name, ''), username) INTO v_sender
    FROM profiles WHERE id = NEW.sender_id;
    v_sender := COALESCE(v_sender, 'Someone');

    v_preview := CASE
      WHEN NEW.message_type = 'image'        THEN COALESCE(NULLIF(NEW.content, ''), '📷 Photo')
      WHEN NEW.message_type = 'video'        THEN COALESCE(NULLIF(NEW.content, ''), '🎬 Video')
      WHEN NEW.message_type = 'file'         THEN COALESCE(NULLIF(NEW.content, ''), '📎 File')
      WHEN NEW.message_type = 'poll'         THEN '📊 Started a poll'
      WHEN NEW.message_type = 'shared_event' THEN '📅 Shared an event'
      WHEN NEW.message_type = 'shared_post'  THEN '🖼️ Shared a post'
      ELSE COALESCE(NEW.content, 'New message')
    END;
    v_preview := left(v_preview, 140);

    IF v_conv.type = 'direct' THEN
      v_type  := 'dm_message';
      v_title := v_sender;
      v_body  := v_preview;
    ELSIF v_conv.type = 'group' THEN
      v_type  := 'group_message';
      v_title := COALESCE(v_conv.name, 'Group chat');
      v_body  := v_sender || ': ' || v_preview;
    ELSE
      v_type := 'club_chat_message';
      SELECT name INTO v_club FROM clubs WHERE id = v_conv.club_id;
      IF NEW.channel_id IS NOT NULL THEN
        -- Main chats carry no channel prefix and route as the plain chat
        -- screen; hashtag channels carry both (kind from 041, never name
        -- matching).
        SELECT CASE WHEN ch.kind = 'channel' THEN ch.name END,
               ch.kind = 'channel'
          INTO v_channel, v_is_channel
        FROM conversation_channels ch WHERE ch.id = NEW.channel_id;
      END IF;
      v_title := COALESCE(v_club, 'Club chat') ||
                 CASE WHEN v_conv.type = 'officer_chat' THEN ' Officers' ELSE '' END;
      -- Exact-channel attribution: "#events · Camila: The location changed"
      v_body := CASE
        WHEN v_channel IS NOT NULL
          THEN '#' || ltrim(v_channel, '#') || ' · ' || v_sender || ': ' || v_preview
        ELSE v_sender || ': ' || v_preview
      END;
    END IF;

    FOR v_recipient IN
      SELECT cp.user_id
      FROM conversation_participants cp
      WHERE cp.conversation_id = NEW.conversation_id
        AND cp.user_id <> NEW.sender_id
        AND cp.muted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM channel_mutes chm
          WHERE NEW.channel_id IS NOT NULL
            AND chm.channel_id = NEW.channel_id AND chm.user_id = cp.user_id
        )
    LOOP
      PERFORM enqueue_push(
        v_recipient.user_id,
        NULL,
        v_type,
        v_title,
        v_body,
        jsonb_strip_nulls(jsonb_build_object(
          'screen', 'chat',
          'chatId', NEW.conversation_id,
          'channelId', CASE WHEN v_is_channel THEN NEW.channel_id END
        )),
        'msg:' || NEW.conversation_id || ':' ||
          CASE WHEN v_is_channel THEN NEW.channel_id::text ELSE 'main' END,
        'msg:' || NEW.id || ':' || v_recipient.user_id,
        0
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_message_push failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_push ON messages;
CREATE TRIGGER trg_message_push
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION handle_message_push();


-- ────────────────────────────────────────────────────────────────────────────
-- 11. Early-launch social proof: one cheap work-table INSERT at signup (never
--     fan out inside the auth transaction), fan-out in the 5-minute cron.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_proof_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL CHECK (kind IN ('student_joined')),
  actor_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  processed  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_social_proof_unprocessed
  ON social_proof_events (created_at) WHERE processed = false;
ALTER TABLE social_proof_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION handle_profile_created_social_proof()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    IF NOT COALESCE(NEW.is_seed, false) THEN
      INSERT INTO social_proof_events (kind, actor_id) VALUES ('student_joined', NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- NEVER surface an error from inside the signup transaction (027 lesson).
    RAISE WARNING 'handle_profile_created_social_proof failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_social_proof ON profiles;
CREATE TRIGGER trg_profile_social_proof
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION handle_profile_created_social_proof();

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
      -- into "N new students joined We Glue 🎉" per recipient.
      INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message)
      SELECT p.id, v_event.actor_id, 'student_joined', NULL, NULL, false,
             v_name || ' just joined We Glue 🎉'
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


-- ────────────────────────────────────────────────────────────────────────────
-- 12. Server-authoritative event reminders (pg_cron every 5 minutes)
-- ────────────────────────────────────────────────────────────────────────────
-- events store event_date + start_time as Chicago wall-clock (lib/timezone.ts
-- rule); converting through the IANA zone makes every comparison DST-correct.
CREATE OR REPLACE FUNCTION event_start_ts(p_date DATE, p_time TIME)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (p_date + p_time) AT TIME ZONE 'America/Chicago';
$$;

CREATE OR REPLACE FUNCTION process_event_reminders()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_catchup  INT := notification_config_int('reminder.catchup_window_minutes', 30);
  v_inserted INT := 0;
  v_n        INT;
  r RECORD;
BEGIN
  -- Kinds and leads are data, not code: each row below is (type, lead,
  -- copy template). Recipients are evaluated NOW, so cancellations, RSVP
  -- changes, club leaves and deletions need no bookkeeping — they simply no
  -- longer match. The dedupe key embeds the event's CURRENT start timestamp:
  -- an edit re-arms reminders for the new time and can never duplicate a
  -- reminder for the same time. Multi-device is safe because dedupe is per
  -- user, and push fan-out to each device happens downstream in send-push.
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
        WHEN 'event_reminder_hour'     THEN e.title || ' starts in one hour.'
        ELSE e.title || ' is starting now.'
      END,
      r.kind || ':' || e.id || ':' ||
        extract(epoch FROM event_start_ts(e.event_date, e.start_time))::bigint || ':' || rv.user_id
    FROM events e
    JOIN event_rsvps rv ON rv.event_id = e.id AND rv.status = 'going'
    WHERE now() >= event_start_ts(e.event_date, e.start_time) - make_interval(mins => r.lead_minutes)
      AND now() <  event_start_ts(e.event_date, e.start_time) - make_interval(mins => r.lead_minutes)
                   + make_interval(mins => v_catchup)
      AND event_start_ts(e.event_date, e.start_time) > now() - interval '5 minutes'
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_inserted := v_inserted + v_n;
  END LOOP;

  -- Last chance to RSVP: joined-club members (or the specific allow-list)
  -- who have not RSVP'd at all. Any RSVP — Going or Can't — silences it.
  INSERT INTO notifications (user_id, actor_id, type, entity_id, entity_type, read, message, dedupe_key)
  SELECT
    m.user_id, e.created_by, 'event_last_chance', e.id, 'event', false,
    'Last chance to RSVP to ' || e.title || '.',
    'event_last_chance:' || e.id || ':' ||
      extract(epoch FROM event_start_ts(e.event_date, e.start_time))::bigint || ':' || m.user_id
  FROM events e
  JOIN LATERAL (
    SELECT cm.user_id FROM club_members cm
    WHERE cm.club_id = e.club_id AND e.visibility IN ('everyone','members')
    UNION
    SELECT uid FROM unnest(COALESCE(e.specific_user_ids, ARRAY[]::uuid[])) AS uid
    WHERE e.visibility = 'specific'
  ) m ON true
  WHERE m.user_id <> COALESCE(e.created_by, m.user_id)
    AND now() >= event_start_ts(e.event_date, e.start_time)
                 - make_interval(mins => notification_config_int('reminder.last_chance_lead_minutes', 360))
    AND now() <  event_start_ts(e.event_date, e.start_time)
                 - make_interval(mins => notification_config_int('reminder.last_chance_lead_minutes', 360))
                 + make_interval(mins => v_catchup)
    AND event_start_ts(e.event_date, e.start_time) > now()
    AND NOT EXISTS (
      SELECT 1 FROM event_rsvps rv WHERE rv.event_id = e.id AND rv.user_id = m.user_id
    )
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_inserted := v_inserted + v_n;

  -- Social proof piggybacks on the same 5-minute heartbeat.
  PERFORM process_social_proof_events();

  RETURN v_inserted;
END;
$$;
REVOKE ALL ON FUNCTION process_event_reminders() FROM PUBLIC, anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 13. Badge aggregate: unread inbox count + unread THREAD count in one call.
--     Thread rules mirror chatService/channelService exactly; one thread with
--     any number of unread messages counts once, muted threads still count.
-- ────────────────────────────────────────────────────────────────────────────
-- Internal variant (service_role only): the push worker stamps each push
-- with the recipient's current iOS icon-badge number.
CREATE OR REPLACE FUNCTION get_unread_summary_for(p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid            UUID := p_user;
  v_notifications  INT;
  v_dm_threads     INT;
  v_club_threads   INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('unread_notifications', 0, 'unread_threads', 0);
  END IF;

  SELECT count(*) INTO v_notifications
  FROM notifications n
  JOIN notification_types t ON t.type = n.type
  WHERE n.user_id = v_uid AND n.read = false AND t.in_app AND t.enabled;

  -- Direct + custom-group threads: unread when someone ELSE wrote after my
  -- last read (own messages never count), respecting cleared history,
  -- delete-for-me, delete-for-everyone and hidden/deleted conversations.
  -- A group I was added to that has no messages yet counts as unread until
  -- opened (last_read_at is null and I didn't create it).
  SELECT count(*) INTO v_dm_threads
  FROM conversation_participants cp
  JOIN conversations c ON c.id = cp.conversation_id
  WHERE cp.user_id = v_uid
    AND c.type IN ('direct','group')
    AND cp.hidden_at IS NULL
    AND c.deleted_at IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sender_id <> v_uid
          AND m.deleted_at IS NULL
          AND m.created_at > COALESCE(cp.last_read_at, cp.joined_at, 'epoch')
          AND (cp.cleared_before IS NULL OR m.created_at > cp.cleared_before)
          AND NOT EXISTS (
            SELECT 1 FROM message_hides mh
            WHERE mh.message_id = m.id AND mh.user_id = v_uid
          )
      )
      OR (
        c.type = 'group' AND cp.last_read_at IS NULL
        AND COALESCE(c.created_by, v_uid) <> v_uid
      )
    );

  -- Club + officer conversations: each CHANNEL is its own thread with its own
  -- read state (channel_reads) — reading Main chat never clears #events.
  SELECT count(*) INTO v_club_threads
  FROM conversation_participants cp
  JOIN conversations c   ON c.id = cp.conversation_id
  JOIN conversation_channels ch ON ch.conversation_id = c.id
  WHERE cp.user_id = v_uid
    AND c.type IN ('club_group','officer_chat')
    AND cp.hidden_at IS NULL
    AND c.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM messages m
      WHERE m.conversation_id = c.id
        AND m.channel_id = ch.id
        AND m.sender_id <> v_uid
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(
              (SELECT cr.last_read_at FROM channel_reads cr
               WHERE cr.channel_id = ch.id AND cr.user_id = v_uid),
              cp.joined_at, 'epoch')
        AND (cp.cleared_before IS NULL OR m.created_at > cp.cleared_before)
        AND NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh.message_id = m.id AND mh.user_id = v_uid
        )
    );

  RETURN jsonb_build_object(
    'unread_notifications', COALESCE(v_notifications, 0),
    'unread_threads', COALESCE(v_dm_threads, 0) + COALESCE(v_club_threads, 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION get_unread_summary_for(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_unread_summary_for(UUID) TO service_role;

-- Client-facing wrapper: always the caller's own counts.
CREATE OR REPLACE FUNCTION get_unread_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_unread_summary_for(auth.uid());
$$;
REVOKE ALL ON FUNCTION get_unread_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_unread_summary() TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 14. Dispatch cron: only calls the Edge Function when work exists. The
--     bearer secret lives in Vault (set at deploy time, never in the repo).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION invoke_push_dispatch()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  -- Reaper: a worker crash mid-batch must not strand rows in 'processing'.
  UPDATE push_queue
  SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
      error  = CASE WHEN attempts >= 3 THEN COALESCE(error, 'worker timeout') ELSE error END
  WHERE status = 'processing' AND sent_at IS NULL
    AND COALESCE(claimed_at, created_at) < now() - interval '10 minutes';

  IF NOT EXISTS (
    SELECT 1 FROM push_queue WHERE status = 'pending' AND scheduled_for <= now()
  ) AND NOT EXISTS (
    SELECT 1 FROM push_tickets WHERE checked = false AND created_at < now() - interval '15 minutes'
  ) THEN
    RETURN;
  END IF;

  SELECT value #>> '{}' INTO v_url FROM notification_config WHERE key = 'push.dispatch_url';
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'push_dispatch_secret';
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;
  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'invoke_push_dispatch: missing push.dispatch_url config or push_dispatch_secret vault secret';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invoke_push_dispatch failed: %', SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION invoke_push_dispatch() FROM PUBLIC, anon, authenticated;

-- Schedule both jobs (best-effort, mirrors 006's pattern; pg_cron and pg_net
-- are available on Supabase). Re-scheduling replaces cleanly.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notification cron extensions: %', SQLERRM;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('process-event-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'process-event-reminders',
    '*/5 * * * *',
    'SELECT public.process_event_reminders();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'schedule process-event-reminders failed: %', SQLERRM;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('dispatch-push');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'dispatch-push',
    '* * * * *',
    'SELECT public.invoke_push_dispatch();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'schedule dispatch-push failed: %', SQLERRM;
END $$;
