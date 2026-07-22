-- ============================================================
-- We Glue – Deletion-safe, private cross-user realtime for event/post
-- interactions (RSVPs, likes, comments)
-- Migration: 050_realtime_interactions.sql
--
-- GOAL: the open event overlay and the open Club Media overlay update live when
-- ANOTHER user RSVPs / un-RSVPs, likes / unlikes, or comments / deletes a
-- comment — covering INSERT, UPDATE and DELETE.
--
-- WHY NOT filtered postgres_changes: event_rsvps, post_likes and post_comments
-- all have a standalone `id` primary key and default REPLICA IDENTITY, so a
-- DELETE's OLD record carries only {id} — NOT event_id / post_id. A
-- postgres_changes subscription filtered by event_id / post_id therefore never
-- receives DELETE events (unlike, RSVP-clear, comment/cascade delete).
--
-- DESIGN: private Supabase Broadcast driven by AFTER INSERT/UPDATE/DELETE
-- triggers. Each trigger reads NEW/OLD directly (parent id ALWAYS present, even
-- on DELETE) and realtime.send()s a MINIMAL invalidation ping — table + op only,
-- NO row/user data — to a private topic scoped to the item:
--     event:<event_id>   (RSVP changes)
--     post:<post_id>     (like + comment changes)
-- The client refetches through the app's normal RLS-governed queries, so no
-- private data ever travels over the channel.
--
-- AUTHORIZATION: receiving is gated by RLS on realtime.messages. Each policy is
-- restricted to BROADCAST messages (extension = 'broadcast') AND a visibility
-- check. The two visibility helpers are SECURITY INVOKER, so their EXISTS runs
-- UNDER THE CALLER'S RLS: an `event:<id>` topic is authorized iff the caller can
-- SELECT that event under the events "visibility-aware read" policy (029), and a
-- `post:<id>` topic iff the caller can SELECT that post under the posts RLS
-- (001). This can never drift from — and is never weaker than — an ordinary
-- app query, and it follows automatically if those RLS policies ever change. A
-- strict UUID pattern + CASE guards the ::uuid cast, so any malformed topic is
-- denied with a clean `false` (never a cast error). No INSERT policy is added,
-- so clients are receive-only; only the SECURITY DEFINER triggers send.
--
-- HARDENING: helper + trigger functions live in the non-exposed `private`
-- schema (not in PostgREST's exposed schemas). Every function SETs
-- search_path = '' and fully schema-qualifies its references, uses no dynamic
-- SQL, and takes no executable input. PUBLIC/anon get no access; `authenticated`
-- gets only schema USAGE + EXECUTE on the two authorization helpers; the trigger
-- functions are executable by no client role (triggers fire regardless).
--
-- Fully ADDITIVE: no supabase_realtime publication change, no change to any
-- application-table column / RLS policy / existing trigger / existing function.
-- Uses plain CREATE (not CREATE OR REPLACE / DROP-then-CREATE) so it fails
-- visibly rather than silently overwriting an unexpected same-name object.
-- Migration 049 is left untouched.
-- ============================================================

-- Shared, non-exposed schema. IF NOT EXISTS because `private` is generic and may
-- pre-exist; PUBLIC never gets access (revoked explicitly below), and the
-- rollback never drops the schema (another feature may own objects in it).
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- ── Broadcast trigger functions (SECURITY DEFINER: send bypasses messages RLS) ─
CREATE FUNCTION private.broadcast_event_rsvp_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    pg_catalog.jsonb_build_object('table', 'event_rsvps', 'op', TG_OP),
    'interaction',
    'event:' || coalesce(NEW.event_id, OLD.event_id)::text,
    true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_event_rsvp_change failed: %', SQLERRM;
  RETURN NULL;
END; $$;

CREATE FUNCTION private.broadcast_post_like_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    pg_catalog.jsonb_build_object('table', 'post_likes', 'op', TG_OP),
    'interaction',
    'post:' || coalesce(NEW.post_id, OLD.post_id)::text,
    true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_post_like_change failed: %', SQLERRM;
  RETURN NULL;
END; $$;

CREATE FUNCTION private.broadcast_post_comment_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    pg_catalog.jsonb_build_object('table', 'post_comments', 'op', TG_OP),
    'interaction',
    'post:' || coalesce(NEW.post_id, OLD.post_id)::text,
    true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_post_comment_change failed: %', SQLERRM;
  RETURN NULL;
END; $$;

-- ── Visibility helpers (SECURITY INVOKER: EXISTS runs under the caller's RLS) ──
-- Strict UUID pattern (8-4-4-4-12 hex) validates hyphen placement before the
-- CASE-guarded ::uuid cast, so a malformed topic can never reach the cast.
CREATE FUNCTION private.can_receive_event_interaction(p_topic text)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' STABLE AS $$
  SELECT CASE
    WHEN p_topic ~ '^event:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN EXISTS (SELECT 1 FROM public.events e WHERE e.id = pg_catalog.substr(p_topic, 7)::uuid)
    ELSE false
  END;
$$;

CREATE FUNCTION private.can_receive_post_interaction(p_topic text)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' STABLE AS $$
  SELECT CASE
    WHEN p_topic ~ '^post:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN EXISTS (SELECT 1 FROM public.posts p WHERE p.id = pg_catalog.substr(p_topic, 6)::uuid)
    ELSE false
  END;
$$;

-- ── Privileges: least-necessary, receive-only, never through PostgREST ───────
REVOKE ALL ON FUNCTION private.broadcast_event_rsvp_change()        FROM PUBLIC;
REVOKE ALL ON FUNCTION private.broadcast_post_like_change()         FROM PUBLIC;
REVOKE ALL ON FUNCTION private.broadcast_post_comment_change()      FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_receive_event_interaction(text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_receive_post_interaction(text)   FROM PUBLIC;

-- The realtime.messages policies (evaluated as `authenticated`) must be able to
-- call the two authorization helpers, and only those.
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_receive_event_interaction(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_receive_post_interaction(text)  TO authenticated;

-- ── Triggers (INSERT / UPDATE / DELETE) ─────────────────────────────────────
CREATE TRIGGER trg_broadcast_event_rsvp
  AFTER INSERT OR UPDATE OR DELETE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_event_rsvp_change();

CREATE TRIGGER trg_broadcast_post_like
  AFTER INSERT OR UPDATE OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_post_like_change();

CREATE TRIGGER trg_broadcast_post_comment
  AFTER INSERT OR UPDATE OR DELETE ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_post_comment_change();

-- ── realtime.messages RLS: BROADCAST-only, visibility-gated RECEIVE ──────────
-- realtime.messages has RLS enabled by default with no policies (deny all).
-- These two SELECT policies are the ONLY way to receive on our topics, they
-- authorize BROADCAST messages only (not Presence or any other extension), and
-- no INSERT policy is added (clients cannot send).
CREATE POLICY "weglue_receive_event_interaction"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND private.can_receive_event_interaction(realtime.topic())
  );

CREATE POLICY "weglue_receive_post_interaction"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND private.can_receive_post_interaction(realtime.topic())
  );

-- ── Reversal / rollback — removes ONLY objects created by this migration ─────
-- (Never drops the shared `private` schema.)
-- DROP POLICY IF EXISTS "weglue_receive_event_interaction" ON realtime.messages;
-- DROP POLICY IF EXISTS "weglue_receive_post_interaction"  ON realtime.messages;
-- DROP TRIGGER IF EXISTS trg_broadcast_event_rsvp   ON public.event_rsvps;
-- DROP TRIGGER IF EXISTS trg_broadcast_post_like    ON public.post_likes;
-- DROP TRIGGER IF EXISTS trg_broadcast_post_comment ON public.post_comments;
-- DROP FUNCTION IF EXISTS private.can_receive_event_interaction(text);
-- DROP FUNCTION IF EXISTS private.can_receive_post_interaction(text);
-- DROP FUNCTION IF EXISTS private.broadcast_event_rsvp_change();
-- DROP FUNCTION IF EXISTS private.broadcast_post_like_change();
-- DROP FUNCTION IF EXISTS private.broadcast_post_comment_change();
