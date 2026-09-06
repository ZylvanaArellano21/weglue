-- 115 — Disable invitation-link rotation while preserving the legacy RPC
-- contract for older mobile builds that still call it.
--
-- ┌─ LEDGER RECONCILIATION NOTE (see docs/audits/migration-ledger-reconciliation.md) ─┐
-- │ Production's migration ledger records version 115 as `seed_math_society_club`     │
-- │ (an off-repo club seed run directly against production ~2026-09-02; the Math      │
-- │ Society club is live). This file — from PR #94 — was authored as version 115 in   │
-- │ the repo independently, and its content NEVER reached production: prod's          │
-- │ `public.rotate_chat_invitation(uuid)` is still the original ROTATING version.     │
-- │ `supabase db push` matches by version number only, so it treats 115 as applied    │
-- │ and skips this file forever — its SQL will not run via push.                      │
-- │                                                                                  │
-- │ The version-115 number cannot be reused for the Math Society seed without         │
-- │ renaming this historical file, which the reconciliation deliberately does NOT do. │
-- │ Re-applying this no-op behaviour to production (making rotate_chat_invitation a    │
-- │ genuine no-op) is a separate, deferred decision — it is a behaviour change, not   │
-- │ ledger cleanup, so it is intentionally NOT bundled into the reconciliation PR.    │
-- │ Prod's rotating function is currently harmless dead code (the client feature was  │
-- │ removed in PR #94, so nothing calls it).                                          │
-- └──────────────────────────────────────────────────────────────────────────────────┘

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
