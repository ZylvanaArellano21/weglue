-- Day 10F Production runtime correction.
--
-- Hosted PostgREST exposes signed JWT claims in request.jwt.claims JSON. The
-- 067 helper checked the retired per-claim GUC, which caused the service-role
-- reconciliation worker to fail closed before it could claim any work.
--
-- This is deliberately limited to the caller-authentication predicate. It
-- does not change grants, policies, evidence access, retention, or purge
-- behavior.

BEGIN;

CREATE OR REPLACE FUNCTION private.is_service_role_request()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_claims_raw text;
  v_claims jsonb;
BEGIN
  v_claims_raw := NULLIF(current_setting('request.jwt.claims', true), '');
  IF v_claims_raw IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_claims := v_claims_raw::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  RETURN COALESCE(v_claims ->> 'role', '') = 'service_role';
END;
$$;

COMMENT ON FUNCTION private.is_service_role_request() IS
  'Day 10F service-only gate. Reads only PostgREST-verified request.jwt.claims JSON and fails closed for absent, malformed, or non-service claims.';

COMMIT;
