-- =============================================================================
-- 065 — Day 10E synchronization parity
--
-- A single, private, opaque invalidation contract for completed Day 10B/10C
-- administrator actions. Broadcasts contain exactly `{}` and are never an
-- authorization or state source: clients must refetch my_access_state() or
-- their normal RLS-backed content queries before changing UI.
--
-- Topics:
--   sync:access:<user-id>       the affected account only (including a
--                               restricted shell, so a restore can converge)
--   sync:university:<campus-id> active students at that campus only
--
-- No report, audit, evidence, reason, actor, correlation ID, email, content
-- body, lifecycle state, or entity ID enters Realtime. Reports and delivery
-- status stay dashboard-only canonical server reads; dashboard actions already
-- refresh their dynamic server-rendered route after their atomic RPC resolves.
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;

-- ── Receive authorization ──────────────────────────────────────────────────
-- The account topic must remain available while access is denied: otherwise a
-- restored account would be stranded on its restricted shell. It is still
-- strictly self-scoped and contains no state.
CREATE FUNCTION private.can_receive_access_sync(p_topic text)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ '^sync:access:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (SELECT auth.uid()) = pg_catalog.substr(p_topic, 13)::uuid
    ELSE false
  END;
$$;

-- A campus-wide event is intentionally only an opaque prompt to refetch. It
-- is limited to active students with a profile in that campus; the refetch's
-- existing RLS remains the authority for every individual post/comment/event.
-- This narrowly-scoped SECURITY DEFINER check reads only auth.uid()'s own
-- profile because student clients deliberately have no direct profiles grant.
CREATE FUNCTION private.can_receive_university_sync(p_topic text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ '^sync:university:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.current_student_can_access_app()
       AND EXISTS (
         SELECT 1
           FROM public.profiles p
          WHERE p.id = (SELECT auth.uid())
            AND p.university_id = pg_catalog.substr(p_topic, 17)::uuid
       )
    ELSE false
  END;
$$;

-- The client needs its own topic name without gaining a direct profile read.
-- This returns only the caller's university UUID and only while their
-- canonical account state permits student access; it cannot query another user.
CREATE FUNCTION public.my_sync_university_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT p.university_id
    FROM public.profiles p
   WHERE p.id = (SELECT auth.uid())
     AND public.current_student_can_access_app()
   LIMIT 1;
$$;

-- ── Opaque sends ────────────────────────────────────────────────────────────
CREATE FUNCTION private.broadcast_access_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF v_user_id IS NOT NULL THEN
    PERFORM realtime.send(
      '{}'::jsonb,
      'invalidate',
      'sync:access:' || v_user_id::text,
      true
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Realtime is a convergence optimisation, never a reason to roll back the
  -- canonical restriction/deletion transaction. Recovery paths still refetch.
  RAISE WARNING 'broadcast_access_sync failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

CREATE FUNCTION private.broadcast_content_lifecycle_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_university_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NULL;
  END IF;

  -- Comments have no lifecycle club snapshot. While the canonical parent is
  -- present, derive the campus from that parent; deleted-history fallback uses
  -- the structural snapshot only. Nothing derived here is sent to clients.
  IF NEW.entity_type = 'comment' THEN
    SELECT COALESCE(c.university_id, post_owner.university_id, comment_owner.university_id)
      INTO v_university_id
      FROM public.post_comments pc
      LEFT JOIN public.posts p ON p.id = pc.post_id
      LEFT JOIN public.clubs c ON c.id = p.club_id
      LEFT JOIN public.profiles post_owner ON post_owner.id = p.author_id
      LEFT JOIN public.profiles comment_owner ON comment_owner.id = NEW.owner_id
     WHERE pc.id = NEW.entity_id;
  ELSE
    SELECT COALESCE(c.university_id, owner_profile.university_id)
      INTO v_university_id
      FROM (SELECT NEW.club_id AS club_id, NEW.owner_id AS owner_id) lifecycle
      LEFT JOIN public.clubs c ON c.id = lifecycle.club_id
      LEFT JOIN public.profiles owner_profile ON owner_profile.id = lifecycle.owner_id;
  END IF;

  IF v_university_id IS NULL AND NEW.owner_id IS NOT NULL THEN
    SELECT p.university_id
      INTO v_university_id
      FROM public.profiles p
     WHERE p.id = NEW.owner_id;
  END IF;

  IF v_university_id IS NOT NULL THEN
    PERFORM realtime.send(
      '{}'::jsonb,
      'invalidate',
      'sync:university:' || v_university_id::text,
      true
    );
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_content_lifecycle_sync failed: %', SQLERRM;
  RETURN NULL;
END;
$$;

-- ── Least-privilege grants ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION private.can_receive_access_sync(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_receive_university_sync(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.broadcast_access_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.broadcast_content_lifecycle_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_sync_university_id() FROM PUBLIC, anon, authenticated;

-- 063 revoked the shared private-schema usage that 050's existing private
-- interaction policies require. Restore only the four receiver helpers; none
-- of the sender/administrative functions are callable by clients or PostgREST.
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_receive_event_interaction(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_receive_post_interaction(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_receive_access_sync(text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_receive_university_sync(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_sync_university_id() TO authenticated;

-- ── Table triggers ──────────────────────────────────────────────────────────
-- Every Day 10B access-state mutation reaches one of these canonical tables.
CREATE TRIGGER trg_broadcast_account_restriction_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.account_restrictions
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_access_sync();

CREATE TRIGGER trg_broadcast_account_deletion_sync
  AFTER INSERT OR UPDATE ON public.account_deletion_cases
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_access_sync();

-- Day 10C remove/restore mutates content_lifecycle.state. This deliberately
-- ignores administrative reason/timestamp-only edits and never broadcasts a
-- content identifier or lifecycle state.
CREATE TRIGGER trg_broadcast_content_lifecycle_sync
  AFTER INSERT OR UPDATE OF state ON public.content_lifecycle
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_content_lifecycle_sync();

-- ── Realtime receive policies ───────────────────────────────────────────────
-- Receive-only: no INSERT policy is added. The extension check prevents the
-- generic topic predicates from authorizing Presence or another protocol.
CREATE POLICY "weglue_receive_access_sync"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND private.can_receive_access_sync(realtime.topic())
  );

CREATE POLICY "weglue_receive_university_sync"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND private.can_receive_university_sync(realtime.topic())
  );

COMMIT;

-- Rollback (review-only; do not run automatically):
-- DROP POLICY IF EXISTS "weglue_receive_access_sync" ON realtime.messages;
-- DROP POLICY IF EXISTS "weglue_receive_university_sync" ON realtime.messages;
-- DROP TRIGGER IF EXISTS trg_broadcast_account_restriction_sync ON public.account_restrictions;
-- DROP TRIGGER IF EXISTS trg_broadcast_account_deletion_sync ON public.account_deletion_cases;
-- DROP TRIGGER IF EXISTS trg_broadcast_content_lifecycle_sync ON public.content_lifecycle;
-- DROP FUNCTION IF EXISTS private.can_receive_access_sync(text);
-- DROP FUNCTION IF EXISTS private.can_receive_university_sync(text);
-- DROP FUNCTION IF EXISTS private.broadcast_access_sync();
-- DROP FUNCTION IF EXISTS private.broadcast_content_lifecycle_sync();
-- DROP FUNCTION IF EXISTS public.my_sync_university_id();
