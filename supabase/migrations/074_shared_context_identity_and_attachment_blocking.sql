-- =============================================================================
-- 074 — Shared-context structural identity, and blocking for chat attachments
--
-- Three narrowly scoped additions. Nothing here loosens an existing policy, and
-- no existing RLS policy, RPC, trigger, realtime topic or helper is duplicated.
--
--   1. SHARED-CONTEXT IDENTITY (Bug 2)
--      058's `profiles` SELECT policy hides a blocked person's row in BOTH
--      directions. That is correct for profiles, search and personal content,
--      and is deliberately left exactly as it is. But it also erases the person
--      from club member lists, officer lists, conversation participant lists and
--      the authorship of messages that are still legitimately visible, which
--      makes shared spaces unreadable ("who is in this club?", "who wrote
--      this?").
--
--      Two SECURITY DEFINER readers return the MINIMUM structural identity for
--      a specific shared context, and only for people who are actually in that
--      context. They are not a profile bypass: no bio, no posts, no weekly
--      events, no interests, no activities, no follow state, no privacy flags,
--      no email, no university, no administrative column. They accept no viewer
--      identity — authorization is always auth.uid(). They cannot be used to
--      look up an arbitrary user id, and they never disclose that anybody is
--      blocked or in which direction: every current member/participant is
--      returned, so the result is identical whether or not a block exists.
--
--   2. CONVERSATION-SCOPED RESTRICTED SENDERS (Bug 4, presentation half)
--      A symmetric, conversation-scoped list of senders whose ATTACHMENT payload
--      is unavailable to the caller. Symmetric on purpose — exactly like the
--      existing DM_UNAVAILABLE_TEXT, which is identical for both parties — so
--      the direction of a block is never disclosed. This only drives which card
--      renders; the enforcement point is (3).
--
--   3. BLOCKING FOR CHAT ATTACHMENTS (Bug 4, enforcement half) — REAL DEFECT
--      067's storage policy for `chat-attachments` authorizes a read on
--      "an active message + is_conversation_participant". It never considers
--      blocking. In a club or group conversation shared by two students who have
--      blocked each other, either one could still fetch the other's image, video
--      or file bytes — through the app, through a signed URL, or by replaying
--      the object path directly against Storage. The existing canonical helper
--      is corrected in place so the storage policy that already calls it starts
--      refusing, with no second policy and no client involvement.
--
-- DELIBERATELY NOT CHANGED: ordinary text and poll history in a conversation the
-- viewer is still authorized to see. 057 and 040 record retaining shared history
-- across a personal block as the product contract, and this migration keeps it.
-- =============================================================================

BEGIN;

-- ── 1a. Club structural identity ───────────────────────────────────────────
-- Authorization mirrors the CURRENT club_members SELECT rule, which is
-- `USING (true)` for authenticated: any signed-in student may already enumerate
-- a club's membership. This deliberately neither broadens nor narrows that —
-- it only restores the display identity RLS removes. Restricted/suspended
-- accounts are excluded by current_student_can_access_app(), the same gate the
-- rest of the product uses.
CREATE OR REPLACE FUNCTION public.club_shared_identities(p_club_id uuid)
RETURNS TABLE(
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.username, p.full_name, p.avatar_url, cm.role
    FROM public.club_members cm
    JOIN public.profiles p ON p.id = cm.user_id
   WHERE cm.club_id = p_club_id
     -- Caller-bound: no viewer argument exists, so no impersonation is possible.
     AND (SELECT auth.uid()) IS NOT NULL
     AND public.current_student_can_access_app()
     -- Only CURRENT members. A former member is not returned, matching the
     -- canonical list behaviour; membership is the sole source of truth.
     AND public.can_student_access_app(p.id)
   ORDER BY cm.joined_at, p.id;
$$;

REVOKE ALL ON FUNCTION public.club_shared_identities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.club_shared_identities(uuid) TO authenticated;

COMMENT ON FUNCTION public.club_shared_identities(uuid) IS
  'Minimal structural identity (id, username, full_name, avatar_url, role) for '
  'the CURRENT members of one club, so a blocked person does not vanish from a '
  'shared club member/officer list. Caller-bound; returns every current member '
  'regardless of blocking, so it discloses no block and no direction. Not a '
  'profile: no bio, posts, events, interests, follow state or privacy flags.';

-- ── 1b. Conversation structural identity ───────────────────────────────────
-- Authorization is the EXISTING conversation rule: the caller must be a current
-- participant. Non-participants get nothing, so a private conversation's roster
-- is never exposed. The returned set is current participants plus the senders of
-- messages in that same conversation which are still active — i.e. exactly the
-- people whose names the viewer legitimately needs in order to read a thread
-- they are already authorized to read, and nobody else.
CREATE OR REPLACE FUNCTION public.conversation_shared_identities(p_conversation_id uuid)
RETURNS TABLE(
  id uuid,
  username text,
  full_name text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.username, p.full_name, p.avatar_url
    FROM public.profiles p
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND public.current_student_can_access_app()
     AND public.is_conversation_participant(p_conversation_id)
     AND (
       EXISTS (
         SELECT 1 FROM public.conversation_participants cp
          WHERE cp.conversation_id = p_conversation_id
            AND cp.user_id = p.id
       )
       OR EXISTS (
         SELECT 1 FROM public.messages m
          WHERE m.conversation_id = p_conversation_id
            AND m.sender_id = p.id
            AND m.deleted_at IS NULL
            AND m.deletion_kind = 'active'
       )
     )
   ORDER BY p.id;
$$;

REVOKE ALL ON FUNCTION public.conversation_shared_identities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_shared_identities(uuid) TO authenticated;

COMMENT ON FUNCTION public.conversation_shared_identities(uuid) IS
  'Minimal structural identity (id, username, full_name, avatar_url) for the '
  'participants and active-message senders of ONE conversation the caller '
  'already participates in, so a blocked person does not vanish from a shared '
  'participant list or from message attribution. Non-participants receive zero '
  'rows. Discloses no block and no direction.';

-- ── 2. Conversation-scoped restricted senders (presentation only) ───────────
-- Returns the ids, within ONE conversation the caller participates in, whose
-- attachment payloads the caller may not read. Symmetric by construction, so it
-- cannot be used to learn who blocked whom. It is not the enforcement point:
-- section 3 is, and it refuses independently of what any client believes.
CREATE OR REPLACE FUNCTION public.conversation_restricted_senders(p_conversation_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT m.sender_id), ARRAY[]::uuid[])
    FROM public.messages m
   WHERE m.conversation_id = p_conversation_id
     AND (SELECT auth.uid()) IS NOT NULL
     AND public.is_conversation_participant(p_conversation_id)
     AND m.sender_id IS NOT NULL
     AND m.sender_id <> (SELECT auth.uid())
     AND m.sender_id = ANY ((SELECT public.blocked_user_ids())::uuid[]);
$$;

REVOKE ALL ON FUNCTION public.conversation_restricted_senders(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_restricted_senders(uuid) TO authenticated;

COMMENT ON FUNCTION public.conversation_restricted_senders(uuid) IS
  'Senders inside ONE conversation the caller participates in whose attachment '
  'payload is unavailable to the caller because of a block in either direction. '
  'Symmetric, so it never reveals who blocked whom. Presentation only — the '
  'storage policy in 074 is the enforcement point.';

-- ── 3. Blocking for chat attachments (the actual security fix) ─────────────
-- Corrects 067's canonical helper in place. The storage policy
-- "chat-attachments: active message participants can read" already calls it, so
-- no policy is added, replaced or duplicated: the same single rule simply stops
-- authorizing a blocked pair. Applies in BOTH directions, because
-- blocked_user_ids() is symmetric.
--
-- The sender's own access is untouched (an author always keeps their own
-- attachment), and attachments authored by any OTHER participant are untouched,
-- so an unrelated person's media in the same group chat still loads.
CREATE OR REPLACE FUNCTION private.active_chat_attachment_readable(p_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.messages m
     WHERE m.attachment_url = p_name
       AND m.deleted_at IS NULL
       AND m.deletion_kind = 'active'
       AND public.is_conversation_participant(m.conversation_id)
       AND (
         -- Your own attachment is always yours.
         m.sender_id = (SELECT auth.uid())
         -- Otherwise the pair must not be blocked in either direction.
         OR m.sender_id IS NULL
         OR m.sender_id <> ALL ((SELECT public.blocked_user_ids())::uuid[])
       )
  );
$$;

COMMIT;
