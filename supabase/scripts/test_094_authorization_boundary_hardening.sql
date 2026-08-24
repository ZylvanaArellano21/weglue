-- Focused catalog regression checks for migration 094.
-- Run this after the migrations against a disposable faithful Supabase stack.

DO $$
DECLARE
  v_source text;
BEGIN
  IF has_function_privilege('anon', 'public.replace_pending_signup(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.replace_pending_signup(text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.replace_pending_signup(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '094: legacy pending-signup deletion remains executable by a client or service role';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.transfer_group_admin(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.transfer_group_admin(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '094: group-admin transfer grants are not fail-closed';
  END IF;

  SELECT prosrc INTO v_source
    FROM pg_proc
   WHERE oid = 'public.transfer_group_admin(uuid,uuid)'::regprocedure;

  IF v_source IS NULL
     OR v_source NOT LIKE '%auth.uid()%'
     OR v_source NOT LIKE '%v_current_admin <> v_me%'
     OR v_source NOT LIKE '%conversation_participants%'
     OR v_source NOT LIKE '%hidden_at IS NULL%' THEN
    RAISE EXCEPTION '094: group-admin transfer does not contain the required caller, owner, and active-member checks';
  END IF;

  SELECT prosrc INTO v_source
    FROM pg_proc
   WHERE oid = 'public.handle_new_user()'::regprocedure;
  IF v_source IS NULL
     OR v_source NOT LIKE '%NEW.id%'
     OR v_source NOT LIKE '%agreed_to_terms%'
     OR v_source NOT LIKE '%agreed_at%' THEN
    RAISE EXCEPTION '094: signup consent is not bound to the Auth-created identity';
  END IF;
END;
$$;

SELECT '094 authorization boundary checks passed' AS result;
