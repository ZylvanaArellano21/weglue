-- ============================================================================
-- 149 — Private block synchronization receive authorization
--
-- `unblock_user` sends opaque invalidations to `sync:block:<user-id>` (088).
-- This adds the missing receive-side authorization without changing any other
-- Realtime namespace, application-table policy, or send behavior.
-- ============================================================================

BEGIN;

CREATE FUNCTION private.can_receive_block_sync(p_topic text)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ '^sync:block:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (SELECT auth.uid()) = pg_catalog.substr(p_topic, 12)::uuid
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION private.can_receive_block_sync(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_receive_block_sync(text) TO authenticated;

-- Receive-only and Broadcast-only. No INSERT policy is added, so clients
-- cannot send to this (or any other) Realtime topic through this migration.
CREATE POLICY "weglue_receive_block_sync"
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'broadcast'
    AND private.can_receive_block_sync(realtime.topic())
  );

COMMIT;
