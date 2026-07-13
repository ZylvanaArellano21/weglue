-- ─────────────────────────────────────────────────────────────────────────────
-- 044 — Atomic account deletion
--
-- WHY
--
-- Deletion used to run in two independent steps from the Edge Function:
--     1. delete_own_user_data()          (commits)
--     2. admin.auth.admin.deleteUser()   (separate HTTP call)
--
-- There is no shared transaction between them. When step 2 failed, step 1 had
-- ALREADY COMMITTED — the profile, interests, activities, memberships and posts
-- were gone while auth.users survived and could still log in. That is a ghost
-- account: an authenticated user with no profile, i.e. "Unknown User". Returning
-- HTTP 500 does not undo it. Verified against the live project by forcing a
-- failure at the auth step: auth.users=1, profiles=0, interests=0, login OK.
--
-- HOW THIS FIXES IT
--
-- The FK graph already does the work for us:
--     profiles.id            -> auth.users(id)  ON DELETE CASCADE
--     posts.author_id        -> profiles(id)    ON DELETE CASCADE
--     user_interests.user_id -> profiles(id)    ON DELETE CASCADE
--     user_activities        -> profiles(id)    ON DELETE CASCADE
--     club_members           -> profiles(id)    ON DELETE CASCADE
--     conversation_participants -> profiles(id) ON DELETE CASCADE
--     messages.sender_id     -> profiles(id)    ON DELETE SET NULL  (anonymizes)
--
-- So a single `DELETE FROM auth.users WHERE id = <uid>` cascades through the
-- whole graph, and — critically — it happens inside ONE transaction. Either the
-- account and all of its data are gone, or nothing is. A failure at any point
-- (including an FK that blocks the auth row) rolls the entire thing back and
-- leaves the account fully intact and usable. Partial deletion becomes
-- structurally impossible rather than merely unlikely.
--
-- Message semantics are preserved exactly as before:
--   • messages in conversations that still have OTHER participants are
--     anonymized (sender_id -> NULL) so shared history survives — this is what
--     the SET NULL cascade does on its own.
--   • messages in solo conversations (nobody else left to read them) are
--     hard-deleted first, explicitly.
--
-- Storage objects are NOT touched here: object removal is not transactional and
-- must never be able to roll back a database deletion. The Edge Function
-- collects the paths before calling this and removes them after it succeeds.
-- An orphaned file is a cleanup task; a ghost account is a launch blocker.
--
-- SECURITY
--
-- SECURITY DEFINER (owner: postgres) so it may delete from auth.users, but the
-- target is ALWAYS auth.uid() — never an argument — so a caller can only ever
-- delete themself. No service-role key is needed by the caller, and the client
-- never gets one.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_own_account_atomic()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Solo-conversation messages: nobody else is in the thread, so hard-delete
  -- them rather than leaving anonymized orphans behind. Must run BEFORE the
  -- auth delete, while sender_id still points at this user.
  DELETE FROM public.messages m
  WHERE  m.sender_id = v_uid
    AND  NOT EXISTS (
           SELECT 1
           FROM   public.conversation_participants cp
           WHERE  cp.conversation_id = m.conversation_id
             AND  cp.user_id <> v_uid
         );

  -- The whole account, in one statement, in this transaction.
  -- Cascades to profiles and every user-owned table; anonymizes the remaining
  -- messages in shared conversations via ON DELETE SET NULL.
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

REVOKE ALL     ON FUNCTION delete_own_account_atomic() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION delete_own_account_atomic() TO authenticated;

COMMENT ON FUNCTION delete_own_account_atomic() IS
  'Deletes the calling user''s account and all owned data in a single transaction. '
  'Target is always auth.uid(); a caller can only delete themself. Replaces the '
  'non-atomic delete_own_user_data() + admin.deleteUser() pair, which could commit '
  'the data deletion and then fail the auth deletion, leaving a ghost account.';
