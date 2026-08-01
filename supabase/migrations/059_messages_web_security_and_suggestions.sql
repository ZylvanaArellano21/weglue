-- ============================================================================
-- 059_messages_web_security_and_suggestions.sql
--
-- Completes the two messaging policy corrections found during the web Messages
-- audit and provides the bounded, block-aware suggested-people source shared
-- by web and mobile.
--
-- Safe ordering: production is currently aligned through migration 058.
-- This migration only narrows client visibility/management and adds an RPC;
-- it does not change or delete existing conversations, messages, or members.
-- ============================================================================

BEGIN;

-- 001's permissive ALL policy survived the later targeted channel policies.
-- PostgreSQL combines permissive policies with OR, so leaving this policy in
-- place meant any participant could update/delete/create channels directly.
-- Channel changes now remain limited to the explicitly-authorized policies and
-- SECURITY DEFINER RPCs established by migrations 040/041.
DROP POLICY IF EXISTS "conv_channels: participants can manage" ON public.conversation_channels;

-- A soft-deleted message is retained for authorised reporting and moderation,
-- but it must never be returned to a student client. The original participant
-- SELECT policy did not account for deleted_at, so clients had to hide rows
-- after receiving their content. Keep the same membership rule while enforcing
-- the deletion boundary in RLS.
DROP POLICY IF EXISTS "messages: participants can read" ON public.messages;
DROP POLICY IF EXISTS "messages: participants can read active" ON public.messages;
CREATE POLICY "messages: participants can read active"
  ON public.messages FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.is_conversation_participant(conversation_id)
  );

-- The club preview policy is independently permissive, so it needs the same
-- active-row guard or it could still expose an unsent message to a non-member.
DROP POLICY IF EXISTS "messages: non-member club preview" ON public.messages;
CREATE POLICY "messages: non-member club preview"
  ON public.messages FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND NOT public.is_conversation_participant(conversation_id)
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.type = 'club_group'
    )
    AND messages.id IN (
      SELECT public.recent_club_preview_message_ids(messages.conversation_id)
    )
  );

-- Suggested people are deliberately server-side: the browser/mobile client
-- never fetches the directory just to render six accounts. It shares the
-- current symmetric block filter and account-restriction predicate, excludes
-- self/deleted accounts, and changes a stable ordering once per UTC day.
CREATE OR REPLACE FUNCTION public.get_message_suggestions(p_limit integer DEFAULT 6)
RETURNS TABLE (user_id uuid, username text, full_name text, avatar_url text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  v_blocked uuid[];
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 6), 6));
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

REVOKE ALL ON FUNCTION public.get_message_suggestions(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_message_suggestions(integer) TO authenticated;

-- Message search is intentionally global (unlike the club-management picker),
-- while retaining the same literal-match, block, and restriction safeguards.
-- Three characters keeps the trigram-backed search path bounded, matching the
-- current search_students performance contract.
CREATE OR REPLACE FUNCTION public.search_message_people(
  p_query text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (user_id uuid, username text, full_name text, avatar_url text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  v_blocked uuid[];
  v_raw text := btrim(COALESCE(p_query, ''));
  v_query text := public.safe_like_fragment(p_query);
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.current_student_can_access_app() OR length(v_raw) < 3 OR v_query = '' THEN
    RETURN;
  END IF;

  v_blocked := public.blocked_user_ids();
  RETURN QUERY
  SELECT p.id, p.username, p.full_name, p.avatar_url
    FROM public.profiles p
   WHERE p.id <> v_me
     AND p.id <> ALL (v_blocked)
     AND public.can_student_access_app(p.id)
     AND (p.username ILIKE '%' || v_query || '%' ESCAPE '\'
       OR p.full_name ILIKE '%' || v_query || '%' ESCAPE '\')
   ORDER BY p.username
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 20));
END;
$$;

REVOKE ALL ON FUNCTION public.search_message_people(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_message_people(text, integer) TO authenticated;

-- Bounded text search for Messages. This keeps the visible-message search
-- server-enforced and scoped to conversations the caller still belongs to;
-- callers never need a directory-wide messages table read to implement search.
CREATE OR REPLACE FUNCTION public.search_message_content(
  p_query text,
  p_conversation_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  channel_id uuid,
  content text,
  message_type text,
  created_at timestamptz,
  sender_id uuid,
  username text,
  full_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_me uuid := (SELECT auth.uid());
  v_raw text := btrim(COALESCE(p_query, ''));
  v_query text := public.safe_like_fragment(p_query);
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.current_student_can_access_app() OR length(v_raw) < 3 OR v_query = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.id, m.conversation_id, m.channel_id, m.content, m.message_type,
         m.created_at, m.sender_id, p.username, p.full_name
    FROM public.messages m
    LEFT JOIN public.profiles p ON p.id = m.sender_id
   WHERE m.deleted_at IS NULL
     AND public.is_conversation_participant(m.conversation_id)
     AND (p_conversation_id IS NULL OR m.conversation_id = p_conversation_id)
     AND m.content ILIKE '%' || v_query || '%' ESCAPE '\'
   ORDER BY m.created_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 50));
END;
$$;

REVOKE ALL ON FUNCTION public.search_message_content(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_message_content(text, uuid, integer) TO authenticated;

COMMIT;
