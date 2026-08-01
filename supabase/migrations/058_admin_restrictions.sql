-- ===========================================================================
-- 058 — Administrator account restrictions  (Day 10B2)
--
-- Adds the canonical `account_restrictions` model: an ADMINISTRATOR-controlled
-- access state for a student account, enforced server-side so an existing
-- access token, a modified client, or a raw PostgREST request gains nothing.
--
-- TERMINOLOGY — read this before changing anything in here.
--   * An ADMINISTRATOR RESTRICTION is what this migration implements:
--       'suspended'        temporary or indefinite, may carry suspended_until
--       'platform_blocked' indefinite until an administrator unblocks
--     It is We Glue acting on an account.
--   * A STUDENT BLOCK (migration 057, `user_blocks`) is a DIFFERENT system: a
--     student's own choice about their own experience.
--   There is deliberately NO shared "blocked" value, column, function or label
--   between the two, and 057 is neither weakened nor duplicated here.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * No Supabase Auth `banned_until` — founder decision. A restricted student
--     must still be able to SIGN IN far enough to reach account deletion.
--     Enforcement is database-side; session revocation is a separate,
--     non-transactional step handled by the application (see §6 of the review).
--   * No content deletion. Posts, messages, clubs, memberships, officer roles,
--     RSVPs, reports and media are untouched by a restriction.
--   * No account deletion. `delete_own_account_atomic()` is deliberately NOT
--     gated — see §5.
--   * No migration 051. No change to 054/055/056/057.
--
-- EXPIRY IS A PREDICATE, NOT A JOB
--   An expired suspension stops restricting access the moment its timestamp
--   passes, because the access predicate evaluates `suspended_until > now()`.
--   The historical row may sit un-lifted until an administrator reconciles it;
--   that is a bookkeeping state, never an access state. No cron is required for
--   correctness, and the system is correct if no cleanup ever runs.
--
-- PERFORMANCE CONTRACT
--   `current_student_can_access_app()` takes NO ARGUMENTS, so wrapping it as
--   `(SELECT public.current_student_can_access_app())` gives PostgreSQL a
--   once-per-statement InitPlan instead of a per-row call — the same shape 057
--   uses for `blocked_user_ids()`. The lookup rides a PARTIAL index covering
--   only active restrictions, which stays a page or two even at millions of
--   accounts because restricted accounts are a vanishing fraction of the whole.
-- ===========================================================================

BEGIN;

-- 055 created this in production; the guard keeps 058 self-contained for a
-- fresh shadow database.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 1. CANONICAL MODEL
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.account_restrictions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NO foreign key, deliberately — the same rule 055 applies to the audit
  -- tables. An FK to profiles/auth.users would let a student's own account
  -- deletion destroy administrator enforcement evidence. Retention is a
  -- documented policy decision (§9), not an accident of referential action.
  user_id          uuid        NOT NULL,

  restriction_type text        NOT NULL
                     CHECK (restriction_type IN ('suspended','platform_blocked')),

  -- 'active'  : currently the account's administrative state
  -- 'lifted'  : an administrator explicitly ended it
  -- 'expired' : bookkeeping ONLY, set by an optional reconciliation pass.
  --             The access predicate never consults this value — it evaluates
  --             suspended_until directly — so a stale 'active' row whose
  --             timestamp has passed does NOT restrict anyone.
  status           text        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','lifted','expired')),

  internal_reason  text        NOT NULL
                     CHECK (char_length(internal_reason) BETWEEN 3 AND 500),

  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  suspended_until  timestamptz,

  lifted_at        timestamptz,
  lifted_by        uuid,
  lift_reason      text
                     CHECK (lift_reason IS NULL
                            OR char_length(lift_reason) BETWEEN 3 AND 500),

  correlation_id   uuid        NOT NULL,

  -- A platform block is indefinite by definition.
  CONSTRAINT ar_block_has_no_expiry
    CHECK (restriction_type <> 'platform_blocked' OR suspended_until IS NULL),
  -- A lift must carry its evidence; a live row must not pretend to be lifted.
  CONSTRAINT ar_lift_consistency
    CHECK ((status = 'lifted'  AND lifted_at IS NOT NULL AND lifted_by IS NOT NULL)
        OR (status <> 'lifted' AND lifted_at IS NULL     AND lifted_by IS NULL)),
  CONSTRAINT ar_expiry_forward
    CHECK (suspended_until IS NULL OR suspended_until > created_at)
);

COMMENT ON TABLE public.account_restrictions IS
  'Administrator-controlled access state for a student account (suspended / '
  'platform_blocked). NOT related to user_blocks, which is student-to-student '
  'blocking. No FK to profiles: enforcement history must survive account '
  'deletion.';

-- ONE active restriction per account, and the enforcement lookup index.
-- Partial, so it holds only restricted accounts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_restrictions_active
  ON public.account_restrictions (user_id) WHERE status = 'active';

-- History reads for the admin detail page, newest first.
CREATE INDEX IF NOT EXISTS idx_account_restrictions_user_created
  ON public.account_restrictions (user_id, created_at DESC);

-- Trace an audit correlation id back to the restriction it produced.
CREATE INDEX IF NOT EXISTS idx_account_restrictions_correlation
  ON public.account_restrictions (correlation_id);

-- Append-mostly. Rows are inserted on restrict and UPDATED on lift; they are
-- never deleted by the application. This mirrors the 055 audit posture.
CREATE OR REPLACE FUNCTION private.account_restrictions_block_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'account_restrictions is append-only; rows may be lifted, never deleted'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS account_restrictions_no_delete ON public.account_restrictions;
CREATE TRIGGER account_restrictions_no_delete
  BEFORE DELETE ON public.account_restrictions
  FOR EACH ROW EXECUTE FUNCTION private.account_restrictions_block_delete();

DROP TRIGGER IF EXISTS account_restrictions_no_truncate ON public.account_restrictions;
CREATE TRIGGER account_restrictions_no_truncate
  BEFORE TRUNCATE ON public.account_restrictions
  FOR EACH STATEMENT EXECUTE FUNCTION private.account_restrictions_block_delete();

ALTER TABLE public.account_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_restrictions FORCE ROW LEVEL SECURITY;

-- ZERO policies, exactly like admin_audit_events. Nothing reaches this table
-- through PostgREST: students cannot read internal reasons or restriction
-- history, and a restricted student cannot alter their own restriction,
-- because there is no path. Writes happen only inside SECURITY DEFINER
-- functions owned by the migration role.
--
-- Supabase's DEFAULT PRIVILEGES grant service_role full DML on every new table
-- in `public`, so an explicit REVOKE is required — granting SELECT alone is not
-- enough. (Learned during the Day 10B1 release, where user_blocks kept its
-- default DML until it was revoked explicitly.)
REVOKE ALL    ON public.account_restrictions FROM anon;
REVOKE ALL    ON public.account_restrictions FROM authenticated;
REVOKE ALL    ON public.account_restrictions FROM service_role;
GRANT  SELECT ON public.account_restrictions TO service_role;

-- ===========================================================================
-- 2. CENTRAL ACCESS PREDICATES
-- ===========================================================================

-- Effective access state for an arbitrary account.
--   'active'           no access-restricting row
--   'suspended'        an active suspension that has not expired
--   'platform_blocked' an active platform block
--
-- Expiry is evaluated HERE, which is what makes it exact to the second and
-- independent of any cleanup job.
CREATE OR REPLACE FUNCTION public.get_account_access_state(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT ar.restriction_type
      FROM public.account_restrictions ar
     WHERE ar.user_id = p_user
       AND ar.status  = 'active'
       AND (ar.restriction_type = 'platform_blocked'
            OR ar.suspended_until IS NULL
            OR ar.suspended_until > now())
     -- A platform block outranks a suspension if both were somehow active.
     ORDER BY (ar.restriction_type = 'platform_blocked') DESC, ar.created_at DESC
     LIMIT 1
  ), 'active');
$$;

CREATE OR REPLACE FUNCTION public.is_account_restricted(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.get_account_access_state(p_user) <> 'active';
$$;

CREATE OR REPLACE FUNCTION public.can_student_access_app(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user IS NOT NULL
     AND public.get_account_access_state(p_user) = 'active';
$$;

-- THE hot-path predicate. Argument-free on purpose: call sites wrap it as
-- `(SELECT public.current_student_can_access_app())` for a once-per-statement
-- InitPlan.
--
-- A platform-admin identity is NEVER a student account. It has no profiles row
-- (053) and is contained out of the student app by its own guard, so it is
-- reported as unable to access the student experience rather than being
-- silently treated as an ordinary unrestricted student.
CREATE OR REPLACE FUNCTION public.current_student_can_access_app()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND NOT EXISTS (
           SELECT 1 FROM auth.users u
            WHERE u.id = (SELECT auth.uid())
              AND public.is_platform_admin_auth(u.raw_app_meta_data)
         )
     AND public.get_account_access_state((SELECT auth.uid())) = 'active';
$$;

-- The ONLY restriction information a student client may read about ITSELF.
--
-- Returns the minimum the restricted shell needs and nothing more: no internal
-- reason, no administrator identity, no history, no correlation id. It is
-- scoped to auth.uid() inside the body, so there is no parameter through which
-- another account's state could be requested — a student cannot enumerate
-- anyone else's restriction.
--
-- 'platform_blocked' is deliberately NOT surfaced to the client. The student
-- sees the generic 'restricted', so the UI cannot leak how severe the internal
-- classification is.
CREATE OR REPLACE FUNCTION public.my_access_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'state', CASE public.get_account_access_state((SELECT auth.uid()))
               WHEN 'active'           THEN 'active'
               WHEN 'suspended'        THEN 'suspended'
               ELSE                         'restricted'   -- generic on purpose
             END,
    'suspended_until', (
      SELECT ar.suspended_until
        FROM public.account_restrictions ar
       WHERE ar.user_id = (SELECT auth.uid())
         AND ar.status = 'active'
         AND ar.restriction_type = 'suspended'
         AND (ar.suspended_until IS NULL OR ar.suspended_until > now())
       ORDER BY ar.created_at DESC LIMIT 1
    ),
    'support_email', 'info@weglue.app'
  );
$$;

REVOKE ALL ON FUNCTION public.get_account_access_state(uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_account_restricted(uuid)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_student_access_app(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_student_can_access_app()      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_access_state()                     FROM PUBLIC, anon;

-- Students may evaluate the ARGUMENT-FREE predicates (about themselves) but
-- NOT the per-user ones, which would let them probe other accounts' states.
GRANT EXECUTE ON FUNCTION public.current_student_can_access_app()   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_access_state()                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_account_access_state(uuid)     TO service_role;
GRANT EXECUTE ON FUNCTION public.is_account_restricted(uuid)        TO service_role;
GRANT EXECUTE ON FUNCTION public.can_student_access_app(uuid)       TO service_role;

-- ===========================================================================
-- 3. AUDIT CATALOG
--
-- `target_type = 'user'` is already permitted by the 055 CHECK constraint, so
-- no constraint change is needed — only new controlled-vocabulary rows.
-- ===========================================================================

INSERT INTO public.admin_audit_actions (action, target_type, sensitivity, requires_reason, description) VALUES
  ('restriction.suspend',        'user', 'destructive', TRUE,
   'Suspend a student account (temporary or indefinite).'),
  ('restriction.unsuspend',      'user', 'sensitive',   TRUE,
   'Lift an active suspension.'),
  ('restriction.block',          'user', 'destructive', TRUE,
   'Block a student account from We Glue indefinitely.'),
  ('restriction.unblock',        'user', 'sensitive',   TRUE,
   'Lift an active platform block.'),
  ('restriction.adjustExpiry',   'user', 'sensitive',   TRUE,
   'Change the expiration of an active suspension (explicit, audited).'),
  ('restriction.revokeSessions', 'user', 'sensitive',   TRUE,
   'Revoke a restricted student''s Supabase Auth sessions (cross-service).')
ON CONFLICT (action) DO NOTHING;

COMMIT;

BEGIN;

-- ===========================================================================
-- 4. SERVER-SIDE ENFORCEMENT
--
-- A restricted student's EXISTING access token must not buy ordinary app use.
-- Client routing is not a control; this section is.
--
-- WHY THIS IS APPLIED PROGRAMMATICALLY.
-- There are 54 student-write policies across 33 tables. Hand-editing each one
-- would be long, and — far worse — silently incomplete the day someone adds a
-- table. The loop below is EXHAUSTIVE BY CONSTRUCTION: it walks pg_policies and
-- appends the predicate to every policy granted to `authenticated` for a
-- writing command, except an explicit, justified exemption list. Anything added
-- later is caught by re-running the verification query in the harness.
--
-- The appended term is `(SELECT public.current_student_can_access_app())`,
-- which PostgreSQL evaluates ONCE per statement as an InitPlan.
-- ===========================================================================

DO $enforce$
DECLARE
  r            record;
  v_qual       text;
  v_check      text;
  v_cmd        text;
  v_roles      text;
  v_new_qual   text;
  v_new_check  text;
  v_sql        text;
  v_count      int := 0;
  -- Paths the RESTRICTED SHELL itself depends on. Gating these would make the
  -- restriction unescapable in the wrong way — a student who cannot delete
  -- their account is a store-compliance failure, not a security win.
  v_exempt     text[] := ARRAY[
    'deletion_requests'   -- the lost-access deletion request form
  ];
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check, roles
      FROM pg_policies
     WHERE schemaname = 'public'
       AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
       AND 'authenticated' = ANY (roles)
       AND NOT (tablename = ANY (v_exempt))
     ORDER BY tablename, policyname
  LOOP
    v_cmd   := r.cmd;
    v_roles := array_to_string(r.roles, ', ');
    v_qual  := r.qual;
    v_check := r.with_check;

    -- Skip anything already carrying the predicate (idempotent re-run).
    IF COALESCE(v_qual,'')  LIKE '%current_student_can_access_app%'
    OR COALESCE(v_check,'') LIKE '%current_student_can_access_app%' THEN
      CONTINUE;
    END IF;

    v_new_qual  := CASE WHEN v_qual  IS NULL THEN NULL
                        ELSE '(' || v_qual  || ') AND (SELECT public.current_student_can_access_app())' END;
    v_new_check := CASE WHEN v_check IS NULL THEN NULL
                        ELSE '(' || v_check || ') AND (SELECT public.current_student_can_access_app())' END;

    -- An INSERT policy has only WITH CHECK; if it somehow has neither, adding a
    -- WITH CHECK is the safe direction.
    IF v_new_qual IS NULL AND v_new_check IS NULL THEN
      v_new_check := '(SELECT public.current_student_can_access_app())';
    END IF;

    v_sql := format('DROP POLICY %I ON public.%I;', r.policyname, r.tablename);
    EXECUTE v_sql;

    v_sql := format('CREATE POLICY %I ON public.%I AS PERMISSIVE FOR %s TO %s',
                    r.policyname, r.tablename, v_cmd, v_roles);
    IF v_new_qual  IS NOT NULL THEN v_sql := v_sql || format(' USING (%s)', v_new_qual); END IF;
    IF v_new_check IS NOT NULL THEN v_sql := v_sql || format(' WITH CHECK (%s)', v_new_check); END IF;
    EXECUTE v_sql || ';';

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE '058: access predicate applied to % student-write policies', v_count;
END
$enforce$;

-- ── Protected student READS ────────────────────────────────────────────────
-- Writes alone are not enough: a restricted student must not keep browsing
-- private surfaces with an old token. These are the reads that constitute
-- "using the app". Public club/event information is deliberately NOT gated —
-- a restricted student seeing what any signed-in student sees is not a leak,
-- and gating it would double policy cost on the feed for no security gain.

DROP POLICY IF EXISTS "messages: participants can read" ON public.messages;
CREATE POLICY "messages: participants can read"
  ON public.messages FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id)
         AND (SELECT public.current_student_can_access_app()));

DROP POLICY IF EXISTS "conversations: participants can read" ON public.conversations;
CREATE POLICY "conversations: participants can read"
  ON public.conversations FOR SELECT TO authenticated
  USING (public.is_conversation_participant(id)
         AND (SELECT public.current_student_can_access_app()));

DROP POLICY IF EXISTS "conversations: non-members see club group chats" ON public.conversations;
CREATE POLICY "conversations: non-members see club group chats"
  ON public.conversations FOR SELECT TO authenticated
  USING (type = 'club_group'
         AND (SELECT public.current_student_can_access_app()));

DROP POLICY IF EXISTS "conv_participants: participants can read" ON public.conversation_participants;
CREATE POLICY "conv_participants: participants can read"
  ON public.conversation_participants FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id)
         AND (SELECT public.current_student_can_access_app()));

-- ── profiles: two DIFFERENT questions, both answered ───────────────────────
--   (a) a RESTRICTED student must not browse other people;
--   (b) a restricted student must not APPEAR to other people.
-- (b) needs a per-row test, so it uses the same argument-free InitPlan shape
-- 057 established for blocked_user_ids().
CREATE OR REPLACE FUNCTION public.restricted_user_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(array_agg(DISTINCT ar.user_id), ARRAY[]::uuid[])
    FROM public.account_restrictions ar
   WHERE ar.status = 'active'
     AND (ar.restriction_type = 'platform_blocked'
          OR ar.suspended_until IS NULL
          OR ar.suspended_until > now());
$$;

COMMENT ON FUNCTION public.restricted_user_ids() IS
  'Every currently access-restricted account id, as a once-per-statement '
  'InitPlan array. Restricted accounts are a vanishing fraction of all '
  'accounts, so this stays tiny. Returns ids only — never a reason, a type, or '
  'an administrator identity.';

REVOKE ALL ON FUNCTION public.restricted_user_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restricted_user_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS "profiles: authenticated read, block-aware" ON public.profiles;
DROP POLICY IF EXISTS "profiles: authenticated read, block-and-restriction-aware" ON public.profiles;
CREATE POLICY "profiles: authenticated read, block-and-restriction-aware"
  ON public.profiles FOR SELECT TO authenticated
  USING (
        -- Always yourself: the restricted shell and the deletion flow must be
        -- able to resolve the signed-in account even while restricted.
        id = (SELECT auth.uid())
    OR  (
              id <> ALL ((SELECT public.blocked_user_ids())::uuid[])   -- 057
          AND id <> ALL ((SELECT public.restricted_user_ids())::uuid[]) -- 058
          AND (SELECT public.current_student_can_access_app())
        )
  );

COMMIT;

BEGIN;

-- ===========================================================================
-- 5. ATOMIC ADMINISTRATOR MUTATIONS
--
-- Each function performs the canonical restriction change AND writes its audit
-- row in ONE transaction, using the migration-056 primitives
-- (private.admin_tx_ok / private.admin_tx_fail). If the audit write is refused,
-- the mutation rolls back with it; if the mutation fails, no success record can
-- exist. Callers never write an audit row themselves.
--
-- ACCOUNT DELETION IS DELIBERATELY NOT GATED ANYWHERE IN THIS MIGRATION.
-- `delete_own_account_atomic()` is SECURITY DEFINER, so table RLS cannot reach
-- it, and its EXECUTE grant is untouched. A restricted student can still sign
-- in (no banned_until, by founder decision), land on the restricted shell, and
-- delete their account. That is a store-compliance requirement, not a nicety.
-- ===========================================================================

-- Shared validation. Returns NULL when the target is acceptable, or a failure
-- code. Every refusal is indistinguishable from "not a student" where that
-- matters, so the dashboard cannot be used to probe for platform-admin ids.
CREATE OR REPLACE FUNCTION private.admin_restriction_reject_target(
  p_actor uuid, p_target uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_target IS NULL                       THEN RETURN 'invalid_target';   END IF;
  IF p_target = p_actor                     THEN RETURN 'self_target';      END IF;
  -- Must be a real STUDENT. Platform-admin identities hold no profiles row
  -- (053), so this single check also refuses the founder's dashboard identity.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_target) THEN
    RETURN 'user_not_found';
  END IF;
  -- Belt and braces for the impossible case that one also holds a profile.
  IF EXISTS (SELECT 1 FROM auth.users u
              WHERE u.id = p_target
                AND public.is_platform_admin_auth(u.raw_app_meta_data)) THEN
    RETURN 'platform_admin_target';
  END IF;
  RETURN NULL;
END;
$$;

-- Sanitized snapshot for before_state / after_state.
-- NOTE THE OMISSION: internal_reason and lift_reason are NOT included. They
-- already live in admin_audit_events.reason; duplicating them into a JSONB blob
-- would double the surface for accidental disclosure for no benefit.
CREATE OR REPLACE FUNCTION private.admin_snap_restriction(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
              'id', ar.id,
              'user_id', ar.user_id,
              'restriction_type', ar.restriction_type,
              'status', ar.status,
              'suspended_until', ar.suspended_until,
              'created_at', ar.created_at,
              'lifted_at', ar.lifted_at,
              'access_state', public.get_account_access_state(p_user))
       FROM public.account_restrictions ar
      WHERE ar.user_id = p_user AND ar.status = 'active'
      ORDER BY ar.created_at DESC LIMIT 1),
    jsonb_build_object('user_id', p_user, 'access_state', 'active')
  );
$$;

-- ── SUSPEND ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_tx_restriction_suspend(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_user_id uuid, p_suspended_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta   jsonb := jsonb_build_object('userId', p_user_id, 'suspendedUntil', p_suspended_until);
  code   text;
  before jsonb;
  state  text;
BEGIN
  code := private.admin_restriction_reject_target(p_actor_id, p_user_id);
  IF code IS NOT NULL THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.suspend','user',p_user_id,meta,p_correlation_id,code);
  END IF;
  IF p_suspended_until IS NOT NULL AND p_suspended_until <= now() THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.suspend','user',p_user_id,meta,p_correlation_id,'invalid_expiry');
  END IF;

  -- Serialize concurrent administrator actions on THIS account.
  PERFORM pg_advisory_xact_lock(hashtextextended('account_restriction:'||p_user_id::text, 0));

  before := private.admin_snap_restriction(p_user_id);
  state  := public.get_account_access_state(p_user_id);

  IF state = 'suspended' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.suspend','user',p_user_id,meta,p_correlation_id,'already_suspended');
  END IF;
  IF state = 'platform_blocked' THEN
    -- platform_blocked -> suspended is NOT supported directly. The
    -- administrator must unblock first, as a separate audited action, so the
    -- de-escalation is never smuggled inside a "suspend" record.
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.suspend','user',p_user_id,meta,p_correlation_id,'invalid_transition');
  END IF;

  -- An expired-but-unlifted row must not collide with the partial unique index.
  UPDATE public.account_restrictions
     SET status = 'expired'
   WHERE user_id = p_user_id AND status = 'active'
     AND restriction_type = 'suspended'
     AND suspended_until IS NOT NULL AND suspended_until <= now();

  INSERT INTO public.account_restrictions
    (user_id, restriction_type, status, internal_reason, created_by, suspended_until, correlation_id)
  VALUES (p_user_id, 'suspended', 'active', btrim(p_reason), p_actor_id, p_suspended_until, p_correlation_id);

  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,'restriction.suspend','user',p_user_id,
                             p_reason, before, private.admin_snap_restriction(p_user_id),
                             meta, p_correlation_id);
END;
$$;

-- ── UNSUSPEND ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_tx_restriction_unsuspend(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta jsonb := jsonb_build_object('userId', p_user_id);
  code text; before jsonb; state text;
BEGIN
  code := private.admin_restriction_reject_target(p_actor_id, p_user_id);
  IF code IS NOT NULL THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.unsuspend','user',p_user_id,meta,p_correlation_id,code);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account_restriction:'||p_user_id::text, 0));
  before := private.admin_snap_restriction(p_user_id);
  state  := public.get_account_access_state(p_user_id);

  IF state = 'active' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.unsuspend','user',p_user_id,meta,p_correlation_id,'not_restricted');
  END IF;
  IF state <> 'suspended' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.unsuspend','user',p_user_id,meta,p_correlation_id,'invalid_transition');
  END IF;

  UPDATE public.account_restrictions
     SET status='lifted', lifted_at=now(), lifted_by=p_actor_id, lift_reason=btrim(p_reason)
   WHERE user_id=p_user_id AND status='active' AND restriction_type='suspended';

  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,'restriction.unsuspend','user',p_user_id,
                             p_reason, before, private.admin_snap_restriction(p_user_id),
                             meta, p_correlation_id);
END;
$$;

-- ── PLATFORM BLOCK ─────────────────────────────────────────────────────────
-- May SUPERSEDE an active suspension atomically: the suspension is lifted and
-- the block inserted inside one transaction, so the account is never briefly
-- unrestricted between the two.
CREATE OR REPLACE FUNCTION public.admin_tx_restriction_block(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta jsonb := jsonb_build_object('userId', p_user_id);
  code text; before jsonb; state text; superseded int := 0;
BEGIN
  code := private.admin_restriction_reject_target(p_actor_id, p_user_id);
  IF code IS NOT NULL THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.block','user',p_user_id,meta,p_correlation_id,code);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account_restriction:'||p_user_id::text, 0));
  before := private.admin_snap_restriction(p_user_id);
  state  := public.get_account_access_state(p_user_id);

  IF state = 'platform_blocked' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.block','user',p_user_id,meta,p_correlation_id,'already_blocked');
  END IF;

  -- Supersede any active suspension (including an expired-but-unlifted one).
  UPDATE public.account_restrictions
     SET status='lifted', lifted_at=now(), lifted_by=p_actor_id,
         lift_reason='Superseded by platform block'
   WHERE user_id=p_user_id AND status='active';
  GET DIAGNOSTICS superseded = ROW_COUNT;

  INSERT INTO public.account_restrictions
    (user_id, restriction_type, status, internal_reason, created_by, suspended_until, correlation_id)
  VALUES (p_user_id, 'platform_blocked', 'active', btrim(p_reason), p_actor_id, NULL, p_correlation_id);

  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,'restriction.block','user',p_user_id,
                             p_reason, before, private.admin_snap_restriction(p_user_id),
                             meta || jsonb_build_object('supersededActive', superseded),
                             p_correlation_id);
END;
$$;

-- ── UNBLOCK ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_tx_restriction_unblock(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta jsonb := jsonb_build_object('userId', p_user_id);
  code text; before jsonb; state text;
BEGIN
  code := private.admin_restriction_reject_target(p_actor_id, p_user_id);
  IF code IS NOT NULL THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.unblock','user',p_user_id,meta,p_correlation_id,code);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account_restriction:'||p_user_id::text, 0));
  before := private.admin_snap_restriction(p_user_id);
  state  := public.get_account_access_state(p_user_id);

  IF state = 'active' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.unblock','user',p_user_id,meta,p_correlation_id,'not_restricted');
  END IF;
  IF state <> 'platform_blocked' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.unblock','user',p_user_id,meta,p_correlation_id,'invalid_transition');
  END IF;

  UPDATE public.account_restrictions
     SET status='lifted', lifted_at=now(), lifted_by=p_actor_id, lift_reason=btrim(p_reason)
   WHERE user_id=p_user_id AND status='active' AND restriction_type='platform_blocked';

  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,'restriction.unblock','user',p_user_id,
                             p_reason, before, private.admin_snap_restriction(p_user_id),
                             meta, p_correlation_id);
END;
$$;

-- ── ADJUST SUSPENSION EXPIRY ───────────────────────────────────────────────
-- An EXPLICIT, separately audited action, deliberately not a silent mutation of
-- the existing row's timestamp: changing how long someone is locked out is a
-- decision that deserves its own record with its own reason.
CREATE OR REPLACE FUNCTION public.admin_tx_restriction_adjust_expiry(
  p_actor_id uuid, p_actor_email text, p_reason text, p_correlation_id uuid,
  p_user_id uuid, p_suspended_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  meta jsonb := jsonb_build_object('userId', p_user_id, 'suspendedUntil', p_suspended_until);
  code text; before jsonb; state text;
BEGIN
  code := private.admin_restriction_reject_target(p_actor_id, p_user_id);
  IF code IS NOT NULL THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.adjustExpiry','user',p_user_id,meta,p_correlation_id,code);
  END IF;
  IF p_suspended_until IS NOT NULL AND p_suspended_until <= now() THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.adjustExpiry','user',p_user_id,meta,p_correlation_id,'invalid_expiry');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account_restriction:'||p_user_id::text, 0));
  before := private.admin_snap_restriction(p_user_id);
  state  := public.get_account_access_state(p_user_id);

  IF state <> 'suspended' THEN
    RETURN private.admin_tx_fail(p_actor_id,p_actor_email,'restriction.adjustExpiry','user',p_user_id,meta,p_correlation_id,'invalid_transition');
  END IF;

  UPDATE public.account_restrictions
     SET suspended_until = p_suspended_until
   WHERE user_id=p_user_id AND status='active' AND restriction_type='suspended';

  RETURN private.admin_tx_ok(p_actor_id,p_actor_email,'restriction.adjustExpiry','user',p_user_id,
                             p_reason, before, private.admin_snap_restriction(p_user_id),
                             meta, p_correlation_id);
END;
$$;

-- service_role only: these are reached exclusively through the secured
-- administrator server path, never from a browser or a student client.
DO $grants$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'admin_tx_restriction_suspend(uuid,text,text,uuid,uuid,timestamptz)',
    'admin_tx_restriction_unsuspend(uuid,text,text,uuid,uuid)',
    'admin_tx_restriction_block(uuid,text,text,uuid,uuid)',
    'admin_tx_restriction_unblock(uuid,text,text,uuid,uuid)',
    'admin_tx_restriction_adjust_expiry(uuid,text,text,uuid,uuid,timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role;', fn);
  END LOOP;
END
$grants$;

COMMIT;

BEGIN;

-- ===========================================================================
-- 4b. GATING THE SECURITY DEFINER RPCs
--
-- THE GAP THIS CLOSES — found by the harness, not by inspection.
--
-- Section 4 gates TABLE access. It does nothing for a `SECURITY DEFINER`
-- function, which runs as its owner and therefore bypasses RLS by design. The
-- test that caught it: a SUSPENDED student successfully called
-- `block_user()` — a Day 10B1 RPC — because no policy is consulted on that
-- path at all. `FORCE ROW LEVEL SECURITY` is not an answer either: production's
-- `postgres` role is BYPASSRLS, which overrides it.
--
-- WHY RENAME-AND-WRAP RATHER THAN EDITING 40 FUNCTION BODIES.
-- Copying each production body into this migration would be thousands of lines
-- and would silently freeze those bodies at today's definition — any later
-- migration touching one would be quietly reverted by re-running this file.
-- Instead each target is RENAMED to `<name>__inner` (body untouched, never
-- copied) and a thin wrapper takes its original name and signature:
--
--     guard -> <name>__inner(original arguments)
--
-- The public signature every shipped client calls is unchanged, the original
-- logic is preserved verbatim, and the guard cannot be bypassed because the
-- inner function's EXECUTE is revoked from `authenticated`.
--
-- WHAT IS DELIBERATELY NOT GATED
--   delete_own_account_atomic  — a restricted student MUST be able to delete
--   my_access_state            — the restricted shell reads its own state
--   current_student_can_access_app
--   auth_signup_status / replace_pending_signup / resolve_signup_university_id
--                              — pre-authentication signup flow
--   ensure_profile             — runs during sign-in, before any state exists
--   pure predicates and trigger functions — they take no action of their own
-- ===========================================================================

DO $wrap$
DECLARE
  target      text;
  v_oid       oid;
  v_args      text;   -- IDENTITY args: 'p_a uuid, p_b text' (for ALTER/REVOKE)
  v_sigargs   text;   -- FULL args incl. DEFAULTS (for the wrapper signature)
  v_callargs  text;   -- 'p_a, p_b'                              (pass-through)
  v_ret       text;
  v_setof     boolean;
  v_inner     text;
  v_sql       text;
  v_done      int := 0;
  -- Student ACTION and READ RPCs that constitute "using We Glue".
  targets     text[] := ARRAY[
    -- Day 10B1 student blocking
    'block_user(uuid)',
    'unblock_user(uuid)',
    'get_my_blocked_users(integer,integer)',
    -- discovery / search
    'search_discovery(uuid,text)',
    'search_students(text,integer)',
    'get_discovery_people(uuid)',
    'get_discovery_clubs(uuid,text,integer,integer)',
    'get_discovery_events(uuid,integer,integer)',
    'get_my_club_recommendations()',
    'regenerate_my_club_recommendations()',
    'dismiss_club_recommendation_batch(uuid)',
    'preview_club_match_count(text[])',
    -- conversations and messaging
    'get_or_create_direct_chat(uuid)',
    'create_group_chat(text,uuid[],text,uuid)',
    'add_group_participants(uuid,uuid[])',
    'remove_group_participant(uuid,uuid)',
    'leave_group_chat(uuid,uuid)',
    'delete_group_conversation(uuid)',
    'unsend_message(uuid)',
    'mark_conversation_read(uuid)',
    'mark_channel_read(uuid)',
    'set_conversation_muted(uuid,boolean)',
    'set_conversation_archived(uuid,boolean)',
    'set_channel_muted(uuid,boolean)',
    'clear_official_chat(uuid)',
    'reopen_club_chat(uuid,text)',
    -- channels
    'create_conversation_channel(uuid,text,text)',
    'delete_conversation_channel(uuid)',
    'rename_conversation_channel(uuid,text)',
    'set_channel_avatar(uuid,text)',
    'set_channel_post_permission(uuid,text,uuid[])',
    -- invitations
    'get_or_create_chat_invitation(uuid)',
    'rotate_chat_invitation(uuid)',
    'join_chat_invitation(text)',
    -- polls
    'create_poll(uuid,uuid,text,text[],boolean)',
    'cast_poll_vote(uuid,uuid)',
    -- clubs / officers
    'leave_club(uuid)',
    'add_club_member_by_officer(uuid,uuid)',
    'remove_club_member_by_officer(uuid,uuid)',
    'add_club_officer(uuid,uuid,text)',
    'remove_club_officer(uuid,uuid)',
    'remove_post_from_club(uuid,uuid)',
    'delete_club_photo_everywhere(uuid)',
    -- notifications / push / misc
    'get_unread_summary()',
    'register_push_token(text,text,text,text)',
    'deactivate_push_token(text)',
    'dismiss_picture_prompt()',
    'report_message(uuid,text,text)'
  ];
BEGIN
  FOREACH target IN ARRAY targets LOOP
    BEGIN
      v_oid := ('public.' || target)::regprocedure::oid;
    EXCEPTION WHEN undefined_function OR invalid_text_representation THEN
      -- Signature not present in this environment (e.g. a leaner shadow
      -- fixture). Skip rather than fail: the wrapper set is a superset.
      CONTINUE;
    END;

    -- TWO different argument renderings are needed, and confusing them breaks
    -- callers. `identity_arguments` omits DEFAULTs (correct for ALTER/REVOKE,
    -- which match on signature); `arguments` KEEPS them. The wrapper must be
    -- declared with the defaults, or every client that omits an optional
    -- parameter — e.g. `get_my_blocked_users()` or `search_students('bob')` —
    -- suddenly fails with "function does not exist". Caught by running the
    -- Day 10B1 harness against 058.
    SELECT pg_get_function_identity_arguments(v_oid),
           pg_get_function_arguments(v_oid),
           pg_get_function_result(v_oid),
           p.proretset,
           p.proname
      INTO v_args, v_sigargs, v_ret, v_setof, v_inner
      FROM pg_proc p WHERE p.oid = v_oid;

    -- Already wrapped (idempotent re-run).
    IF v_inner LIKE '%\_\_inner' THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname = v_inner || '__inner') THEN
      CONTINUE;
    END IF;

    -- Argument NAMES only, for the pass-through call. Identity arguments are
    -- 'name type' pairs; strip the type to get the name.
    SELECT string_agg(split_part(btrim(a), ' ', 1), ', ')
      INTO v_callargs
      FROM unnest(string_to_array(v_args, ',')) a
     WHERE btrim(a) <> '';

    EXECUTE format('ALTER FUNCTION public.%s RENAME TO %I;', target, v_inner || '__inner');
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated;',
                   v_inner || '__inner', v_args);

    IF v_ret = 'void' THEN
      -- A void function cannot `RETURN expr`; it must PERFORM the inner call.
      v_sql := format($f$
        CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
        AS $body$
        BEGIN
          IF (SELECT auth.uid()) IS NOT NULL
             AND NOT public.current_student_can_access_app() THEN
            RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
          END IF;
          PERFORM public.%I(%s);
        END;
        $body$;$f$, v_inner, v_sigargs, v_inner || '__inner', COALESCE(v_callargs,''));
    ELSIF v_setof THEN
      v_sql := format($f$
        CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
        AS $body$
        BEGIN
          IF (SELECT auth.uid()) IS NOT NULL
             AND NOT public.current_student_can_access_app() THEN
            RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
          END IF;
          RETURN QUERY SELECT * FROM public.%I(%s);
        END;
        $body$;$f$, v_inner, v_sigargs, v_ret, v_inner || '__inner', COALESCE(v_callargs,''));
    ELSE
      v_sql := format($f$
        CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
        AS $body$
        BEGIN
          IF (SELECT auth.uid()) IS NOT NULL
             AND NOT public.current_student_can_access_app() THEN
            RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
          END IF;
          RETURN public.%I(%s);
        END;
        $body$;$f$, v_inner, v_sigargs, v_ret, v_inner || '__inner', COALESCE(v_callargs,''));
    END IF;

    EXECUTE v_sql;
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon;', v_inner, v_args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated;', v_inner, v_args);
    v_done := v_done + 1;
  END LOOP;

  RAISE NOTICE '058: restriction guard wrapped around % student RPCs', v_done;
END
$wrap$;

COMMIT;
