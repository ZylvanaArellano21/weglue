-- ============================================================================
-- 112 — message reactions
--
-- Reactions are deliberately a small, participant-scoped child of messages.
-- They do not create notifications and do not enqueue push_queue rows: a quick
-- reaction is an in-thread interaction, not an inbox event.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.message_reaction_emoji_is_valid(p_emoji text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  v_codepoint integer;
  v_graphemes integer := 0;
  v_regional_count integer := 0;
  v_joined boolean := false;
  v_has_base boolean := false;
  v_length integer;
  v_index integer;
BEGIN
  IF pg_catalog.octet_length(p_emoji) > 16
     OR pg_catalog.btrim(p_emoji) = ''
     OR p_emoji ~ '[[:space:]]' THEN
    RETURN false;
  END IF;

  -- PostgreSQL's regex engine has no Unicode grapheme (\\X) operator. Count
  -- base codepoints while treating combining marks, variation selectors,
  -- emoji modifiers and ZWJ-linked bases as one grapheme. Regional-indicator
  -- pairs are the one other common multi-codepoint single grapheme (flags).
  v_length := pg_catalog.char_length(p_emoji);
  FOR v_index IN 1..v_length LOOP
    v_codepoint := pg_catalog.ascii(pg_catalog.substr(p_emoji, v_index, 1));

    IF v_codepoint = 8205 THEN -- ZERO WIDTH JOINER
      IF NOT v_has_base THEN RETURN false; END IF;
      v_joined := true;
    ELSIF v_codepoint BETWEEN 768 AND 879
       OR v_codepoint BETWEEN 6832 AND 6911
       OR v_codepoint BETWEEN 7616 AND 7679
       OR v_codepoint BETWEEN 8400 AND 8431
       OR v_codepoint BETWEEN 65024 AND 65039
       OR v_codepoint BETWEEN 127462 AND 127487 -- regional indicators
       OR v_codepoint BETWEEN 127995 AND 127999 -- skin-tone modifiers
       OR v_codepoint = 8419 THEN -- COMBINING ENCLOSING KEYCAP
      IF v_codepoint BETWEEN 127995 AND 127999 THEN
        IF NOT v_has_base THEN RETURN false; END IF;
      ELSIF v_codepoint BETWEEN 127462 AND 127487 THEN
        IF v_regional_count = 0 THEN
          v_graphemes := v_graphemes + 1;
        END IF;
        v_regional_count := v_regional_count + 1;
        IF v_regional_count > 2 THEN
          v_graphemes := v_graphemes + 1;
          v_regional_count := 1;
        END IF;
        v_has_base := true;
      ELSE
        IF NOT v_has_base THEN RETURN false; END IF;
      END IF;
    ELSE
      IF NOT v_joined THEN
        v_graphemes := v_graphemes + 1;
      END IF;
      v_joined := false;
      v_regional_count := 0;
      v_has_base := true;
    END IF;
  END LOOP;

  RETURN v_has_base AND NOT v_joined AND v_graphemes = 1;
END;
$$;

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id         uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_reactions_one_per_user UNIQUE (message_id, user_id),
  CONSTRAINT message_reactions_emoji_valid CHECK (public.message_reaction_emoji_is_valid(emoji))
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON public.message_reactions (message_id, created_at, emoji);
CREATE INDEX IF NOT EXISTS idx_message_reactions_user
  ON public.message_reactions (user_id, message_id);

DROP TRIGGER IF EXISTS trg_message_reactions_updated_at ON public.message_reactions;
CREATE TRIGGER trg_message_reactions_updated_at
  BEFORE UPDATE ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- This predicate is intentionally stricter than message visibility: it also
-- removes a reaction made by a user blocked by the current viewer. It is a
-- SECURITY DEFINER helper so nested reads remain independent of client RLS.
CREATE OR REPLACE FUNCTION private.message_reaction_readable(
  p_message_id uuid,
  p_reactor_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.messages m
     WHERE m.id = p_message_id
       AND m.deleted_at IS NULL
       AND m.deletion_kind = 'active'
       AND public.is_conversation_participant(m.conversation_id)
       AND NOT EXISTS (
         SELECT 1
           FROM public.message_hides h
          WHERE h.message_id = m.id
            AND h.user_id = (SELECT auth.uid())
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.conversation_participants cp
          WHERE cp.conversation_id = m.conversation_id
            AND cp.user_id = (SELECT auth.uid())
            AND cp.cleared_before IS NOT NULL
            AND m.created_at <= cp.cleared_before
       )
       AND (
         p_reactor_id = (SELECT auth.uid())
         OR p_reactor_id <> ALL (COALESCE((SELECT public.blocked_user_ids()), ARRAY[]::uuid[]))
       )
  );
$$;

CREATE OR REPLACE FUNCTION private.message_reaction_writable(p_message_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.messages m
     WHERE m.id = p_message_id
       AND public.is_conversation_participant(m.conversation_id)
  );
$$;

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.message_reactions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_reactions TO authenticated;

DROP POLICY IF EXISTS "message reactions: participants read visible" ON public.message_reactions;
CREATE POLICY "message reactions: participants read visible"
  ON public.message_reactions FOR SELECT TO authenticated
  USING (private.message_reaction_readable(message_id, user_id));

DROP POLICY IF EXISTS "message reactions: participants insert own" ON public.message_reactions;
CREATE POLICY "message reactions: participants insert own"
  ON public.message_reactions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.message_reaction_writable(message_id)
  );

DROP POLICY IF EXISTS "message reactions: participants update own" ON public.message_reactions;
CREATE POLICY "message reactions: participants update own"
  ON public.message_reactions FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.message_reaction_writable(message_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.message_reaction_writable(message_id)
  );

DROP POLICY IF EXISTS "message reactions: participants delete own" ON public.message_reactions;
CREATE POLICY "message reactions: participants delete own"
  ON public.message_reactions FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.message_reaction_writable(message_id)
  );

-- Reaction changes share the existing per-thread private Broadcast topic. The
-- payload is intentionally small; clients refetch canonical rows under RLS.
CREATE OR REPLACE FUNCTION private.broadcast_message_reaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_message_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.message_id ELSE NEW.message_id END;
  v_user_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_emoji text := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.emoji END;
  v_conversation_id uuid;
BEGIN
  SELECT m.conversation_id INTO v_conversation_id
    FROM public.messages m WHERE m.id = v_message_id;
  IF v_conversation_id IS NULL THEN RETURN NULL; END IF;

  PERFORM realtime.send(
    pg_catalog.jsonb_build_object(
      'message_id', v_message_id,
      'user_id', v_user_id,
      'emoji', v_emoji,
      'action', CASE WHEN TG_OP = 'DELETE' THEN 'remove' ELSE 'set' END
    ),
    'reaction',
    'sync:message:' || v_conversation_id::text,
    true
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'broadcast_message_reaction failed';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_message_reaction ON public.message_reactions;
CREATE TRIGGER trg_broadcast_message_reaction
  AFTER INSERT OR UPDATE OR DELETE ON public.message_reactions
  FOR EACH ROW EXECUTE FUNCTION private.broadcast_message_reaction();

-- authenticated keeps EXECUTE: this IMMUTABLE validator backs the
-- message_reactions_emoji_valid CHECK constraint, evaluated by the inserting
-- role on every INSERT/UPDATE.
REVOKE ALL ON FUNCTION public.message_reaction_emoji_is_valid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_reaction_emoji_is_valid(text) TO authenticated;
REVOKE ALL ON FUNCTION private.message_reaction_readable(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.message_reaction_writable(uuid) FROM PUBLIC, anon;
-- authenticated must keep EXECUTE: both helpers are invoked from message_reactions
-- RLS policies that are TO authenticated (EXECUTE is checked before a SECURITY
-- DEFINER function runs). Matches 067's can_receive_message_sync pattern.
GRANT EXECUTE ON FUNCTION private.message_reaction_readable(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.message_reaction_writable(uuid) TO authenticated;
REVOKE ALL ON FUNCTION private.broadcast_message_reaction() FROM PUBLIC, anon, authenticated, service_role;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
