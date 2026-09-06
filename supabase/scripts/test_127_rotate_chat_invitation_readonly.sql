-- ============================================================
-- Verification for migration 127 — rotate_chat_invitation is read-only.
--
-- Migration 127 re-applies the approved behaviour lost when version 115's
-- ledger slot was consumed by seed_math_society_club
-- (docs/audits/migration-ledger-reconciliation.md). After 127 the function:
--
--   1. keeps its signature `(p_conversation_id uuid) RETURNS text`
--      (older mobile builds keep working);
--   2. contains no `UPDATE chat_invitations` and no
--      `get_or_create_chat_invitation` — it neither revokes nor creates
--      a token;
--   3. still gates on `auth.uid()` / `can_manage_chat_invitation`;
--   4. grants EXECUTE to `authenticated` only (not anon / PUBLIC).
--
-- Static checks only — no fixtures. Run against a stack with migrations
-- through 127. Wrapped in a transaction and rolled back.
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.rotate_chat_invitation(uuid)') IS NULL THEN
    RAISE EXCEPTION 'FAIL 127-1: rotate_chat_invitation(uuid) does not exist';
  END IF;

  v_src := pg_get_functiondef('public.rotate_chat_invitation(uuid)'::regprocedure);

  IF position('UPDATE chat_invitations' IN v_src) > 0
     OR position('get_or_create_chat_invitation' IN v_src) > 0 THEN
    RAISE EXCEPTION 'FAIL 127-2: body still mutates chat_invitations / creates a token';
  END IF;

  IF position('can_manage_chat_invitation' IN v_src) = 0
     OR position('auth.uid()' IN v_src) = 0 THEN
    RAISE EXCEPTION 'FAIL 127-3: authorization guard is missing';
  END IF;

  IF position('RETURNS text' IN lower(v_src)) = 0
     AND position('returns text' IN lower(v_src)) = 0 THEN
    RAISE EXCEPTION 'FAIL 127-1: return type changed';
  END IF;

  IF has_function_privilege('anon', 'public.rotate_chat_invitation(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 127-4: anon can execute rotate_chat_invitation';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.rotate_chat_invitation(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 127-4: authenticated cannot execute rotate_chat_invitation';
  END IF;

  RAISE NOTICE 'PASS 127: rotate_chat_invitation is read-only, guarded, authenticated-only';
END
$$;

ROLLBACK;
