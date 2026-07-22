-- ============================================================
-- We Glue – Deletion-safe, private cross-user realtime for event/post
-- interactions (RSVPs, likes, comments)
-- Migration: 050_realtime_interactions.sql
--
-- GOAL: the open event overlay and the open Club Media overlay must update live
-- when ANOTHER user RSVPs / un-RSVPs, likes / unlikes, or comments / deletes a
-- comment — covering INSERT, UPDATE and DELETE.
--
-- WHY NOT filtered postgres_changes: event_rsvps, post_likes and post_comments
-- all have a standalone `id` primary key and default REPLICA IDENTITY, so a
-- DELETE's OLD record carries only {id} — NOT event_id / post_id. A
-- postgres_changes subscription filtered by event_id / post_id therefore never
-- receives DELETE events (unlike, RSVP-clear, comment/post/user cascade). Adding
-- the tables to the publication would silently fail for exactly those cases.
--
-- DESIGN: private Supabase Broadcast driven by AFTER INSERT/UPDATE/DELETE
-- triggers. The trigger reads NEW/OLD directly (so the parent id is ALWAYS
-- available, even on DELETE) and broadcasts a MINIMAL invalidation signal — no
-- row data, no user data — to a private topic scoped to the parent item:
--     event:<event_id>   (RSVP changes)
--     post:<post_id>     (like + comment changes)
-- The client refetches through the app's normal RLS-governed queries, so no
-- private data ever travels over the channel.
--
-- PRIVACY / AUTHORIZATION: subscribing to a private channel is gated by RLS on
-- realtime.messages (default-deny; policies added below). A user may RECEIVE on
--   event:<id>  only if they can SEE that event (everyone / member of its club /
--               named in specific_user_ids / its creator) — the SAME visibility
--               the events RLS enforces.
--   post:<id>   only if that post exists (posts are authenticated-readable in
--               this app; tighten here if per-post privacy is ever added).
-- No INSERT policy is added, so clients can never send on these topics — only
-- the SECURITY DEFINER triggers broadcast.
--
-- This migration does NOT touch the supabase_realtime publication (Broadcast
-- does not use it) and does NOT modify migration 049 or any unrelated object.
-- ============================================================

-- ── Trigger functions ───────────────────────────────────────────────────────
-- SECURITY DEFINER so realtime.send bypasses realtime.messages RLS on the SEND
-- side (only RECEIVE is gated). Wrapped so a realtime hiccup can never block or
-- fail the underlying like / rsvp / comment mutation.

CREATE OR REPLACE FUNCTION public.broadcast_event_rsvp_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('table', 'event_rsvps', 'op', TG_OP),
    'interaction',
    'event:' || COALESCE(NEW.event_id, OLD.event_id)::text,
    true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_event_rsvp_change failed: %', SQLERRM;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.broadcast_post_like_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('table', 'post_likes', 'op', TG_OP),
    'interaction',
    'post:' || COALESCE(NEW.post_id, OLD.post_id)::text,
    true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_post_like_change failed: %', SQLERRM;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.broadcast_post_comment_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM realtime.send(
    jsonb_build_object('table', 'post_comments', 'op', TG_OP),
    'interaction',
    'post:' || COALESCE(NEW.post_id, OLD.post_id)::text,
    true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_post_comment_change failed: %', SQLERRM;
  RETURN NULL;
END; $$;

-- ── Triggers (INSERT / UPDATE / DELETE) ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_broadcast_event_rsvp ON public.event_rsvps;
CREATE TRIGGER trg_broadcast_event_rsvp
  AFTER INSERT OR UPDATE OR DELETE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_event_rsvp_change();

DROP TRIGGER IF EXISTS trg_broadcast_post_like ON public.post_likes;
CREATE TRIGGER trg_broadcast_post_like
  AFTER INSERT OR UPDATE OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_post_like_change();

DROP TRIGGER IF EXISTS trg_broadcast_post_comment ON public.post_comments;
CREATE TRIGGER trg_broadcast_post_comment
  AFTER INSERT OR UPDATE OR DELETE ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_post_comment_change();

-- ── Visibility check functions (SECURITY DEFINER) ───────────────────────────
-- The realtime.messages authorization context cannot read `public` tables via
-- an inline sub-select inside the policy, so the visibility check is
-- encapsulated in a SECURITY DEFINER function (which has table access). It still
-- reads auth.uid() from the request JWT, so the gate reflects the CALLER's
-- identity — a member is allowed, a non-member is denied. The functions return
-- only a boolean (no data leaves them), validate the uuid shape before casting
-- (a malformed/hostile topic can neither error nor match), and pin search_path.
--   event:<id>  → visible if everyone / member of its club / named in
--                 specific_user_ids / its creator (the SAME rule events RLS uses)
--   post:<id>   → visible if the post exists (authenticated-readable in this app)

CREATE OR REPLACE FUNCTION public.can_receive_event_interaction(p_topic text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT p_topic ~ '^event:[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = substring(p_topic from 7)::uuid
        AND (
          e.visibility = 'everyone'
          OR (e.visibility = 'members'
              AND EXISTS (SELECT 1 FROM public.club_members cm
                          WHERE cm.club_id = e.club_id AND cm.user_id = auth.uid()))
          OR (e.visibility = 'specific' AND auth.uid() = ANY(e.specific_user_ids))
          OR e.created_by = auth.uid()
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_receive_post_interaction(p_topic text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT p_topic ~ '^post:[0-9a-fA-F-]{36}$'
    AND EXISTS (SELECT 1 FROM public.posts p WHERE p.id = substring(p_topic from 6)::uuid);
$$;

REVOKE ALL ON FUNCTION public.can_receive_event_interaction(text) FROM public;
REVOKE ALL ON FUNCTION public.can_receive_post_interaction(text)  FROM public;
GRANT EXECUTE ON FUNCTION public.can_receive_event_interaction(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_receive_post_interaction(text)  TO authenticated;

-- ── realtime.messages RLS: gate RECEIVE by item visibility ──────────────────
-- realtime.messages has RLS enabled by default with no policies (deny all), so
-- these two SELECT policies are the ONLY way to receive on our topics. No INSERT
-- policy is added, so authenticated clients can never SEND on these topics —
-- only the SECURITY DEFINER triggers broadcast.

DROP POLICY IF EXISTS "weglue_receive_event_interaction" ON realtime.messages;
CREATE POLICY "weglue_receive_event_interaction"
  ON realtime.messages FOR SELECT TO authenticated
  USING (public.can_receive_event_interaction(realtime.topic()));

DROP POLICY IF EXISTS "weglue_receive_post_interaction" ON realtime.messages;
CREATE POLICY "weglue_receive_post_interaction"
  ON realtime.messages FOR SELECT TO authenticated
  USING (public.can_receive_post_interaction(realtime.topic()));

-- ── Reversal / rollback (not run automatically; kept for the record) ─────────
-- DROP POLICY IF EXISTS "weglue_receive_event_interaction" ON realtime.messages;
-- DROP POLICY IF EXISTS "weglue_receive_post_interaction"  ON realtime.messages;
-- DROP FUNCTION IF EXISTS public.can_receive_event_interaction(text);
-- DROP FUNCTION IF EXISTS public.can_receive_post_interaction(text);
-- DROP TRIGGER IF EXISTS trg_broadcast_event_rsvp   ON public.event_rsvps;
-- DROP TRIGGER IF EXISTS trg_broadcast_post_like    ON public.post_likes;
-- DROP TRIGGER IF EXISTS trg_broadcast_post_comment ON public.post_comments;
-- DROP FUNCTION IF EXISTS public.broadcast_event_rsvp_change();
-- DROP FUNCTION IF EXISTS public.broadcast_post_like_change();
-- DROP FUNCTION IF EXISTS public.broadcast_post_comment_change();
