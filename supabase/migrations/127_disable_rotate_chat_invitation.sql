-- 127 — Reapply the approved read-only / no-rotation behaviour for
-- public.rotate_chat_invitation(uuid).
--
-- WHY THIS EXISTS AS A FORWARD MIGRATION
-- The original change shipped as `115_disable_rotate_chat_invitation.sql`
-- (PR #94). Production's version-115 ledger slot had already been consumed by an
-- off-repo `seed_math_society_club` run, so `supabase db push` treats 115 as
-- applied and skips that file permanently — its SQL never reached production.
-- Verified: prod's `rotate_chat_invitation` is still the original ROTATING
-- implementation (advisory lock + `UPDATE chat_invitations SET revoked_at` +
-- `get_or_create_chat_invitation`).
--
-- This migration re-applies the approved behaviour so production matches the
-- contract. Historical migration 115 and its production ledger row are left
-- untouched (see docs/audits/migration-ledger-reconciliation.md).
--
-- BEHAVIOUR (identical to the approved 115):
--   * the RPC signature is unchanged — older mobile builds that still call it
--     keep working;
--   * it is deliberately read-only: it returns the current active invitation
--     token if one exists, or NULL, and never revokes or creates a token.

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
  'DEPRECATED/DISABLED as of 2026-09-01 (reapplied in migration 127; migration 115''s ledger slot was consumed by seed_math_society_club): chat-invite link reset feature removed; kept as a read-only no-op for backward compatibility with older mobile builds; scheduled for DROP in a later cleanup migration.';

REVOKE ALL ON FUNCTION public.rotate_chat_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_chat_invitation(uuid) TO authenticated;

-- Self-check: abort the migration if the function body still mutates
-- chat_invitations or delegates to the token-creating helper.
DO $$
DECLARE
  v_src text;
BEGIN
  v_src := pg_get_functiondef('public.rotate_chat_invitation(uuid)'::regprocedure);
  IF position('UPDATE chat_invitations' IN v_src) > 0
     OR position('get_or_create_chat_invitation' IN v_src) > 0 THEN
    RAISE EXCEPTION '127: rotate_chat_invitation is not read-only after CREATE OR REPLACE';
  END IF;
  RAISE NOTICE '127 ok — rotate_chat_invitation is read-only';
END
$$;
