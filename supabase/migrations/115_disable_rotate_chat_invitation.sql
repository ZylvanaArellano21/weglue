-- 115 — Disable invitation-link rotation while preserving the legacy RPC
-- contract for older mobile builds that still call it.

CREATE OR REPLACE FUNCTION public.rotate_chat_invitation(p_conversation_id uuid)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT can_manage_chat_invitation(p_conversation_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Deliberately read-only: preserve the existing active token when present,
  -- and return NULL when no active token exists instead of creating one.
  SELECT token INTO v_token FROM chat_invitations
  WHERE conversation_id = p_conversation_id AND revoked_at IS NULL
  ORDER BY created_at DESC LIMIT 1;

  RETURN v_token;
END;
$$;

COMMENT ON FUNCTION public.rotate_chat_invitation(uuid) IS
  'DEPRECATED/DISABLED as of 2026-09-01: chat-invite link reset feature removed; kept as a no-op for backward compatibility with older mobile builds; scheduled for DROP in a later cleanup migration.';

REVOKE ALL ON FUNCTION public.rotate_chat_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_chat_invitation(uuid) TO authenticated;
