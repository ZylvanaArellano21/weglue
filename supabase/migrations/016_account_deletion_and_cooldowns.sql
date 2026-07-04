-- ============================================================
-- We Glue – Account deletion, message anonymization, cooldowns
-- Migration: 016_account_deletion_and_cooldowns.sql
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. Change messages.sender_id FK from ON DELETE CASCADE
--    to ON DELETE SET NULL so messages are anonymized (not
--    hard-deleted) when a user deletes their account.
--    This allows other participants' chat history to remain
--    intact with a "Deleted User" placeholder in the UI.
-- ──────────────────────────────────────────────────────────────

ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;

ALTER TABLE messages
  ADD CONSTRAINT messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES profiles(id)
  ON DELETE SET NULL;

-- ──────────────────────────────────────────────────────────────
-- 2. Account Center cooldown tracking columns on profiles
-- ──────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_changed_at    TIMESTAMPTZ;

-- ──────────────────────────────────────────────────────────────
-- 3. deletion_requests — for the public weglue.app/delete-account
--    form (uninstalled users, Apple/Google policy compliance)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deletion_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        NOT NULL,
  reason       TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed    BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_email
  ON deletion_requests(email);

-- Public (anon) can insert — no auth required for uninstalled users
ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deletion_requests: anyone can insert"
  ON deletion_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "deletion_requests: service role manages"
  ON deletion_requests FOR ALL
  TO service_role
  USING (true);

-- ──────────────────────────────────────────────────────────────
-- 4. delete_own_user_data() — secure cleanup RPC
--
--    Called from the mobile app (authenticated user).
--    Deletes / anonymizes all rows tied to auth.uid().
--    Does NOT delete auth.users — that's done via the web API
--    route using the Supabase admin client after this returns.
--
--    Execution order:
--      a) Anonymize messages (sender_id → NULL) for convos that
--         still have other active participants.
--      b) Hard-delete messages in convos where this user was
--         the ONLY participant (no one else will miss them).
--      c) Delete all remaining user-owned rows explicitly.
--      d) Delete Storage objects is handled on the client side
--         before calling this RPC.
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_own_user_data()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- a) In conversations with other active participants, anonymize
  --    messages so conversation history stays intact.
  UPDATE messages
  SET    sender_id = NULL
  WHERE  sender_id = v_uid
    AND  conversation_id IN (
      SELECT DISTINCT cp.conversation_id
      FROM   conversation_participants cp
      WHERE  cp.conversation_id IN (
               SELECT cp2.conversation_id
               FROM   conversation_participants cp2
               WHERE  cp2.user_id = v_uid
             )
        AND  cp.user_id != v_uid
    );

  -- b) Hard-delete messages in solo conversations (DMs the user
  --    started with themselves, or group convos where everyone
  --    else already left).
  DELETE FROM messages
  WHERE  sender_id = v_uid;

  -- c) Remove the user from all conversations
  DELETE FROM conversation_participants
  WHERE  user_id = v_uid;

  -- d) Remove all explicit user-owned data.
  --    The profile deletion below cascades: posts, follows,
  --    event_rsvps, saved_events, user_interests, user_activities,
  --    user_privacy, notifications, club_members.
  --    We delete these explicitly for clarity + auditability.
  DELETE FROM post_likes    WHERE user_id = v_uid;
  DELETE FROM poll_votes    WHERE user_id = v_uid;
  DELETE FROM saved_events  WHERE user_id = v_uid;
  DELETE FROM event_rsvps   WHERE user_id = v_uid;
  DELETE FROM follows       WHERE follower_id  = v_uid OR following_id = v_uid;
  DELETE FROM club_members  WHERE user_id = v_uid;
  DELETE FROM club_officers WHERE user_id = v_uid;
  DELETE FROM notifications WHERE user_id = v_uid OR actor_id = v_uid;
  DELETE FROM user_interests  WHERE user_id = v_uid;
  DELETE FROM user_activities WHERE user_id = v_uid;
  DELETE FROM user_privacy    WHERE user_id = v_uid;
  DELETE FROM posts           WHERE author_id = v_uid;

  -- e) Finally delete the profile. This triggers ON DELETE SET NULL
  --    on messages.sender_id (already handled above) and cascades
  --    any remaining child rows.
  DELETE FROM profiles WHERE id = v_uid;

  -- auth.users deletion is handled by the web API route.
END;
$$;

REVOKE ALL ON FUNCTION delete_own_user_data() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION delete_own_user_data() TO authenticated;
