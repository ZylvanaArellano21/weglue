-- ============================================================================
-- 076_message_tab_categories_and_suggestions.sql
--
-- Two function-only corrections for the Message tab. No table, column, index,
-- policy, grant, or data change — every statement is CREATE OR REPLACE over an
-- existing function body, and both functions keep their current signature,
-- volatility, security context, and grants.
--
-- A. get_message_suggestions() could never return more than six accounts: its
--    own clamp was LEAST(COALESCE(p_limit, 6), 6), so the Suggested sections on
--    web and mobile were structurally incapable of showing ten people no matter
--    what the client requested. The bound is raised (still bounded — this is a
--    directory read) and the default follows the product requirement.
--
-- B. get_unread_summary_for() reported unread_threads only: ONE conversation
--    with twenty unread messages counted as 1, and Single vs Groups were never
--    distinguished. The Message tab now needs a per-category MESSAGE total for
--    the Single control, the Groups control, and the message-tab badge.
--
--    unread_threads is deliberately left byte-for-byte unchanged. The push
--    worker stamps the iOS app-icon badge from that key via this same function,
--    so the two new keys are PURELY ADDITIVE: every existing caller keeps its
--    current number and no push payload changes.
--
-- Safe ordering: main's ledger ends at 068; 069-075 are claimed by the open
-- PRs #29 and #30, so this takes 076. It is independent of all of them — it
-- replaces no object any of them touches, and it depends on nothing they add.
-- ============================================================================

BEGIN;

-- ── A. Suggested people ─────────────────────────────────────────────────────
-- Same secure source, same filters: self excluded, symmetric blocks excluded,
-- restricted/suspended/unavailable accounts excluded by can_student_access_app,
-- deterministic-per-day ordering. Only the bound moves. Ten is the product
-- floor; the hard ceiling stays modest so this can never become a directory
-- dump, and it matches the 20-row ceiling already used by search_message_people.
CREATE OR REPLACE FUNCTION public.get_message_suggestions(p_limit integer DEFAULT 10)
RETURNS TABLE (user_id uuid, username text, full_name text, avatar_url text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  v_blocked uuid[];
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 20));
  v_day text := CURRENT_DATE::text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.current_student_can_access_app() THEN
    RETURN;
  END IF;

  v_blocked := public.blocked_user_ids();
  RETURN QUERY
  SELECT p.id, p.username, p.full_name, p.avatar_url
    FROM public.profiles p
   WHERE p.id <> v_me
     AND p.id <> ALL (v_blocked)
     AND public.can_student_access_app(p.id)
   -- Hash ordering is deterministic within the day yet rotates thereafter.
   -- It avoids a second recommendation system and never leaks the full set.
   ORDER BY md5(p.id::text || v_day), p.id
   LIMIT v_limit;
END;
$$;

-- Grants are re-stated only because they are the security contract of this
-- function; CREATE OR REPLACE preserves them, so these are no-ops on a DB that
-- already ran 059 and exist for a from-scratch ledger replay.
REVOKE ALL ON FUNCTION public.get_message_suggestions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_message_suggestions(integer) TO authenticated;


-- ── B. Badge aggregate: add the two per-category MESSAGE totals ─────────────
-- The counting rules below are copied from the thread rules in this same
-- function rather than re-invented, so a message can never be unread for the
-- badge but read for the list (or vice versa):
--   • the sender's own messages never count;
--   • delete-for-everyone (deleted_at) and delete-for-me (message_hides) are
--     excluded;
--   • cleared history (cleared_before) is excluded;
--   • hidden participation and deleted conversations are excluded;
--   • direct + custom-group read state is the CONVERSATION's last_read_at;
--   • club/officer read state is the CHANNEL's channel_reads row — reading
--     Main chat must not clear #events, exactly as unread_threads already does.
--
-- The one deliberate asymmetry with unread_threads: a group you were added to
-- that has NO messages yet counts as one unread *thread*, but contributes zero
-- unread *messages*, because there is no message to count. That is inherent to
-- a message-count contract; the three Message-tab surfaces all read the new
-- keys, so they stay consistent with each other.
CREATE OR REPLACE FUNCTION get_unread_summary_for(p_user UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             UUID := p_user;
  v_notifications   INT;
  v_dm_threads      INT;
  v_club_threads    INT;
  v_direct_messages INT;
  v_group_messages  INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'unread_notifications',   0,
      'unread_threads',         0,
      'unread_direct_messages', 0,
      'unread_group_messages',  0
    );
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

  -- Single category: unread messages across one-to-one conversations.
  SELECT count(*) INTO v_direct_messages
  FROM conversation_participants cp
  JOIN conversations c ON c.id = cp.conversation_id
  JOIN messages m      ON m.conversation_id = c.id
  WHERE cp.user_id = v_uid
    AND c.type = 'direct'
    AND cp.hidden_at IS NULL
    AND c.deleted_at IS NULL
    AND m.sender_id <> v_uid
    AND m.deleted_at IS NULL
    AND m.created_at > COALESCE(cp.last_read_at, cp.joined_at, 'epoch')
    AND (cp.cleared_before IS NULL OR m.created_at > cp.cleared_before)
    AND NOT EXISTS (
      SELECT 1 FROM message_hides mh
      WHERE mh.message_id = m.id AND mh.user_id = v_uid
    );

  -- Groups category: custom group chats (conversation read state) PLUS club
  -- member chats and club officer chats (per-channel read state). The two
  -- halves cannot overlap: they select disjoint conversation types.
  SELECT
    COALESCE((
      SELECT count(*)
      FROM conversation_participants cp
      JOIN conversations c ON c.id = cp.conversation_id
      JOIN messages m      ON m.conversation_id = c.id
      WHERE cp.user_id = v_uid
        AND c.type = 'group'
        AND cp.hidden_at IS NULL
        AND c.deleted_at IS NULL
        AND m.sender_id <> v_uid
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(cp.last_read_at, cp.joined_at, 'epoch')
        AND (cp.cleared_before IS NULL OR m.created_at > cp.cleared_before)
        AND NOT EXISTS (
          SELECT 1 FROM message_hides mh
          WHERE mh.message_id = m.id AND mh.user_id = v_uid
        )
    ), 0)
    +
    COALESCE((
      SELECT count(*)
      FROM conversation_participants cp
      JOIN conversations c          ON c.id = cp.conversation_id
      JOIN conversation_channels ch ON ch.conversation_id = c.id
      JOIN messages m               ON m.conversation_id = c.id
                                   AND m.channel_id = ch.id
      WHERE cp.user_id = v_uid
        AND c.type IN ('club_group','officer_chat')
        AND cp.hidden_at IS NULL
        AND c.deleted_at IS NULL
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
    ), 0)
  INTO v_group_messages;

  RETURN jsonb_build_object(
    'unread_notifications',   COALESCE(v_notifications, 0),
    'unread_threads',         COALESCE(v_dm_threads, 0) + COALESCE(v_club_threads, 0),
    'unread_direct_messages', COALESCE(v_direct_messages, 0),
    'unread_group_messages',  COALESCE(v_group_messages, 0)
  );
END;
$$;

-- Unchanged contract, re-stated for a from-scratch ledger replay: this variant
-- stays service_role-only. Students reach it through get_unread_summary(),
-- whose 058 restriction wrapper is untouched by this migration.
REVOKE ALL ON FUNCTION get_unread_summary_for(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_unread_summary_for(UUID) TO service_role;

COMMIT;
