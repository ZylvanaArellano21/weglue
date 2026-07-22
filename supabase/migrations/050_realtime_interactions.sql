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
-- check. Because the realtime.messages policy context cannot read `public`
-- tables via an inline sub-select, the visibility check lives in a SECURITY
-- DEFINER function that has table access yet still honours auth.uid(). The event
-- check is the VERBATIM equivalent of the events SELECT RLS (migration 029):
-- everyone / creator / club officer / member-of-club-for-members / named-for-
-- specific. The post check mirrors the posts SELECT RLS (migration 001,
-- USING true) — the post simply exists. A CASE guards the ::uuid cast so a
-- malformed topic is denied cleanly (never a cast error). No INSERT policy is
-- added, so clients are receive-only; only the SECURITY DEFINER triggers send.
--
-- HARDENING: helper + trigger functions live in a non-exposed `private` schema
-- (never reachable through PostgREST). Every function is SECURITY DEFINER with
-- SET search_path = '' and fully-qualified references, no dynamic SQL, and no
-- executable input. EXECUTE is revoked from PUBLIC; only the two authorization
-- helpers are granted to `authenticated` (needed for policy evaluation); the
-- trigger functions are granted to no client role (triggers fire regardless).
--
-- Fully ADDITIVE: no supabase_realtime publication change, no change to any
-- application-table column / RLS policy / existing trigger / existing function,
-- and migration 049 is left untouched.
-- ============================================================

-- Non-exposed schema for the interaction-realtime internals.
CREATE SCHEMA IF NOT EXISTS private;

-- ── Broadcast trigger functions ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.broadcast_event_rsvp_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('table', 'event_rsvps', 'op', TG_OP),
    'interaction',
    'event:' || coalesce(NEW.event_id, OLD.event_id)::text,
    true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_event_rsvp_change failed: %', SQLERRM;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION private.broadcast_post_like_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('table', 'post_likes', 'op', TG_OP),
    'interaction',
    'post:' || coalesce(NEW.post_id, OLD.post_id)::text,
    true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_post_like_change failed: %', SQLERRM;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION private.broadcast_post_comment_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('table', 'post_comments', 'op', TG_OP),
    'interaction',
    'post:' || coalesce(NEW.post_id, OLD.post_id)::text,
    true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_post_comment_change failed: %', SQLERRM;
  RETURN NULL;
END; $$;

-- ── Visibility check functions (mirror the app's SELECT RLS exactly) ─────────
-- event:<id> → identical to the events "visibility-aware read" policy (029).
-- CASE guards the ::uuid cast: for a non-matching (malformed) topic the EXISTS
-- (and its cast) is never evaluated, so the result is a clean `false`.
CREATE OR REPLACE FUNCTION private.can_receive_event_interaction(p_topic text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT CASE
    WHEN p_topic ~ '^event:[0-9a-fA-F-]{36}$' THEN EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = substring(p_topic from 7)::uuid
        AND (
          e.visibility = 'everyone'
          OR e.created_by = auth.uid()
          OR public.is_club_officer(e.club_id)
          OR (e.visibility = 'members'
              AND EXISTS (SELECT 1 FROM public.club_members cm
                          WHERE cm.club_id = e.club_id AND cm.user_id = auth.uid()))
          OR (e.visibility = 'specific'
              AND e.specific_user_ids IS NOT NULL
              AND auth.uid() = ANY (e.specific_user_ids))
        )
    )
    ELSE false
  END;
$$;

-- post:<id> → mirrors the posts "anyone authenticated can read" policy (001):
-- authorized iff the post still exists (a deleted post yields no rows → denied).
CREATE OR REPLACE FUNCTION private.can_receive_post_interaction(p_topic text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' STABLE AS $$
  SELECT CASE
    WHEN p_topic ~ '^post:[0-9a-fA-F-]{36}$'
      THEN EXISTS (SELECT 1 FROM public.posts p WHERE p.id = substring(p_topic from 6)::uuid)
    ELSE false
  END;
$$;

-- ── Privileges: least-necessary, receive-only, never through PostgREST ───────
REVOKE ALL ON FUNCTION private.broadcast_event_rsvp_change()        FROM PUBLIC;
REVOKE ALL ON FUNCTION private.broadcast_post_like_change()         FROM PUBLIC;
REVOKE ALL ON FUNCTION private.broadcast_post_comment_change()      FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_receive_event_interaction(text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_receive_post_interaction(text)   FROM PUBLIC;

-- The RLS policies (evaluated as `authenticated`) must be able to call the two
-- authorization helpers, and only those.
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_receive_event_interaction(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_receive_post_interaction(text)  TO authenticated;

-- ── Triggers (INSERT / UPDATE / DELETE) ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_broadcast_event_rsvp ON public.event_rsvps;
CREATE TRIGGER trg_broadcast_event_rsvp
  AFTER INSERT OR UPDATE OR DELETE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_event_rsvp_change();

DROP TRIGGER IF EXISTS trg_broadcast_post_like ON public.post_likes;
CREATE TRIGGER trg_broadcast_post_like
  AFTER INSERT OR UPDATE OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_post_like_change();

DROP TRIGGER IF EXISTS trg_broadcast_post_comment ON public.post_comments;
CREATE TRIGGER trg_broadcast_post_comment
  AFTER INSERT OR UPDATE OR DELETE ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_post_comment_change();

-- ── realtime.messages RLS: BROADCAST-only, visibility-gated RECEIVE ──────────
-- realtime.messages has RLS enabled by default with no policies (deny all).
-- These two SELECT policies are the ONLY way to receive on our topics, they
-- authorize BROADCAST messages only (not Presence or any other extension), and
-- no INSERT policy is added (clients cannot send).
DROP POLICY IF EXISTS "weglue_receive_event_interaction" ON realtime.messages;
CREATE POLICY "weglue_receive_event_interaction"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND private.can_receive_event_interaction(realtime.topic())
  );

DROP POLICY IF EXISTS "weglue_receive_post_interaction" ON realtime.messages;
CREATE POLICY "weglue_receive_post_interaction"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND private.can_receive_post_interaction(realtime.topic())
  );

-- ── Reversal / rollback (removes ONLY objects created by this migration) ─────
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
-- DROP SCHEMA IF EXISTS private;  -- only if nothing else was added to it
