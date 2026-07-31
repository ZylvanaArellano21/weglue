-- ============================================================================
-- 055_durable_admin_audit.sql
--
-- Day 10A — durable, append-only Admin Dashboard audit system.
--
-- Replaces the console-log-only mechanism in apps/web/lib/admin/audit.ts with a
-- real table that survives log rotation and can be queried by the founder from
-- the secured Admin Dashboard.
--
-- ── THE FIVE GUARANTEES THIS MIGRATION MAKES ───────────────────────────────
--
--  1. NO CLIENT ACCESS AT ALL. `anon` and `authenticated` hold no grants and
--     there is no RLS policy of any kind, so every SELECT/INSERT/UPDATE/DELETE
--     from a browser session — INCLUDING the founder's own authenticated
--     session — is denied by default. RLS is FORCEd so even the table owner is
--     subject to it.
--
--  2. NOT EVEN THE SERVICE-ROLE KEY MAY INSERT DIRECTLY. `service_role` is
--     explicitly REVOKEd from INSERT on the table. Rows can only be created
--     through public.admin_audit_log(), a SECURITY DEFINER function that
--     validates and sanitizes before writing. A leaked service key therefore
--     cannot forge an arbitrary audit row shape; it can only call the validated
--     entry point. (`service_role` has BYPASSRLS, so grants — not policies —
--     are what constrain it. That is why this is written as a REVOKE.)
--
--  3. APPEND-ONLY IS ENFORCED BY TRIGGER, NOT BY POLICY. Triggers fire for
--     every role including `service_role` and the table owner, so
--     admin_audit_block_mutation() is the guarantee that no UPDATE or DELETE
--     can ever alter recorded history. UPDATE/DELETE/TRUNCATE grants are also
--     revoked, as defense in depth.
--
--  4. HISTORY SURVIVES ACCOUNT DELETION. actor_user_id and target_id are plain
--     UUID columns with NO foreign key to auth.users / profiles / clubs. When
--     an administrator or a target account is deleted (hard cascade, 044/052),
--     the audit trail is untouched — the identifiers remain as immutable
--     evidence. This is deliberate and must not be "fixed" by adding an FK.
--
--  5. CONSTRAINED VOCABULARY. `action` is an FK into a catalog table, so an
--     unknown action name fails loudly instead of silently creating a new
--     category. `target_type` is CHECK-constrained. Adding an action is a
--     deliberate, reviewable migration step.
--
-- ── WHAT THIS MIGRATION DOES *NOT* DO ──────────────────────────────────────
--  • It does NOT backfill history. There are no historical records to recover;
--    fabricating them would defeat the purpose of an audit trail. The table
--    starts empty and is truthful from its first row.
--  • It does NOT make auditing atomic with the mutation being audited. See the
--    "TRANSACTION SEMANTICS" note at the bottom of this file — the honest
--    limitation is documented rather than papered over.
--  • It does NOT enable any administrator mutation. ADMIN_WRITES_ENABLED stays
--    false; this migration only changes where audit records are written.
--
-- Fully additive: no existing table, column, policy, function, trigger or RLS
-- rule is modified. Safe to apply while the app is running. Idempotent.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — Helper schema
-- ============================================================================
-- `private` already exists (migration 050) and is NOT in PostgREST's exposed
-- schemas, so nothing here is reachable over the REST API. IF NOT EXISTS
-- because 050 may or may not have created it in a given environment.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;


-- ============================================================================
-- SECTION 2 — Action catalog (constrained vocabulary)
-- ============================================================================
-- Every auditable action must exist here before it can be recorded. This is
-- what makes `action` a controlled value rather than free text, and it is where
-- per-action sensitivity and the reason requirement are declared.
--
-- sensitivity:
--   ordinary    — routine administration
--   sensitive   — privacy-relevant or privileged reads/changes
--   destructive — removes or irreversibly alters canonical data
CREATE TABLE IF NOT EXISTS admin_audit_actions (
  action          TEXT PRIMARY KEY,
  target_type     TEXT NOT NULL,
  sensitivity     TEXT NOT NULL,
  requires_reason BOOLEAN NOT NULL DEFAULT FALSE,
  description     TEXT,
  CONSTRAINT admin_audit_actions_sensitivity_chk
    CHECK (sensitivity IN ('ordinary', 'sensitive', 'destructive')),
  -- The catalog is constrained to the SAME target_type vocabulary as the events
  -- table. Without this, a catalog row could declare a target_type that the
  -- events CHECK would later reject, producing an action that type-checks at
  -- registration time but is impossible to actually record.
  CONSTRAINT admin_audit_actions_target_type_chk CHECK (target_type IN (
    'user', 'profile', 'club', 'club_member', 'club_officer', 'university',
    'post', 'comment', 'event', 'rsvp', 'gluemate',
    'conversation', 'channel', 'message', 'notification',
    'report', 'portal', 'system'
  )),
  -- Enforces the `noun.verb` / `noun.verbPhrase` naming convention so the
  -- vocabulary cannot drift into ad-hoc strings.
  CONSTRAINT admin_audit_actions_name_chk
    CHECK (action ~ '^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$')
);

-- Defensive: if the catalog table pre-dates this constraint in some
-- environment, add it rather than silently skipping (CREATE TABLE IF NOT
-- EXISTS would not have applied the inline CHECK above).
DO $$ BEGIN
  ALTER TABLE admin_audit_actions ADD CONSTRAINT admin_audit_actions_target_type_chk
    CHECK (target_type IN (
      'user', 'profile', 'club', 'club_member', 'club_officer', 'university',
      'post', 'comment', 'event', 'rsvp', 'gluemate',
      'conversation', 'channel', 'message', 'notification',
      'report', 'portal', 'system'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE admin_audit_actions IS
  'Controlled vocabulary of auditable Admin Dashboard actions. Adding a row is a deliberate migration step; admin_audit_events.action is an FK into this table.';


-- ============================================================================
-- SECTION 3 — The audit event table
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_audit_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Server-side clock only. The write path never accepts a caller-supplied
  -- timestamp, so an administrator cannot backdate their own trail.
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Immutable evidence. Intentionally NO foreign key: deleting the actor's or
  -- the target's account must never delete audit history (guarantee 4).
  actor_user_id  UUID NOT NULL,
  actor_email    TEXT,

  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      UUID,

  -- Lifecycle of the record itself, NOT of the operation's business outcome:
  --   attempt                 — intention recorded BEFORE a cross-service
  --                             operation begins (Auth/Storage/multi-service).
  --                             Never updated; the outcome is a SEPARATE row
  --                             sharing the correlation id.
  --   success                 — the operation completed.
  --   failure                 — the operation did not complete.
  --   reconciliation_required — the external side-effect may have happened but
  --                             the outcome row could not be persisted at the
  --                             time. Requires human reconciliation; the
  --                             dashboard surfaces these prominently.
  -- Database-only mutations skip 'attempt' entirely: their audit row commits in
  -- the SAME transaction as the mutation (migration 056), so an intention
  -- record would describe a state that can never be observed.
  event_type     TEXT NOT NULL DEFAULT 'success',

  reason         TEXT,

  -- Sanitized, allowlisted snapshots. Never raw request bodies, never private
  -- message content, never secrets — enforced by SECTION 5 and by the
  -- application-side allowlist in lib/admin/auditSanitize.ts.
  before_state   JSONB,
  after_state    JSONB,
  metadata       JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Nullable ONLY for 'attempt' and 'reconciliation_required', where the
  -- outcome is genuinely not yet known. Recording those as success=false would
  -- assert a failure that has not happened.
  success        BOOLEAN,
  error_code     TEXT,

  -- Connects the steps of one logical operation (e.g. a transfer that writes
  -- both club_members and club_officers) into a single reviewable unit.
  correlation_id UUID NOT NULL,

  CONSTRAINT admin_audit_events_target_type_chk CHECK (target_type IN (
    'user', 'profile', 'club', 'club_member', 'club_officer', 'university',
    'post', 'comment', 'event', 'rsvp', 'gluemate',
    'conversation', 'channel', 'message', 'notification',
    'report', 'portal', 'system'
  )),
  CONSTRAINT admin_audit_events_reason_len_chk
    CHECK (reason IS NULL OR char_length(reason) BETWEEN 3 AND 500),
  CONSTRAINT admin_audit_events_error_code_len_chk
    CHECK (error_code IS NULL OR char_length(error_code) <= 200),
  CONSTRAINT admin_audit_events_actor_email_len_chk
    CHECK (actor_email IS NULL OR char_length(actor_email) <= 320),
  -- event_type, success and error_code must agree. This is what stops a
  -- rolled-back or never-attempted operation from being filed as a success.
  CONSTRAINT admin_audit_events_outcome_chk CHECK (
    (event_type = 'attempt'                 AND success IS NULL  AND error_code IS NULL)     OR
    (event_type = 'success'                 AND success = TRUE   AND error_code IS NULL)     OR
    (event_type = 'failure'                 AND success = FALSE  AND error_code IS NOT NULL) OR
    (event_type = 'reconciliation_required' AND success IS NULL  AND error_code IS NOT NULL)
  ),
  -- Bounds audit rows so a buggy or hostile caller cannot bloat the table.
  CONSTRAINT admin_audit_events_state_size_chk CHECK (
    pg_column_size(COALESCE(before_state, '{}'::JSONB)) <= 16384 AND
    pg_column_size(COALESCE(after_state,  '{}'::JSONB)) <= 16384 AND
    pg_column_size(metadata) <= 16384
  )
);

-- Closed set of record lifecycles. Added as a separate ALTER so an environment
-- whose table pre-dates the column still gains the constraint (CREATE TABLE IF
-- NOT EXISTS would silently skip an inline CHECK).
DO $$ BEGIN
  ALTER TABLE admin_audit_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'success';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE admin_audit_events ADD CONSTRAINT admin_audit_events_event_type_chk
    CHECK (event_type IN ('attempt', 'success', 'failure', 'reconciliation_required'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- FK into the controlled vocabulary. RESTRICT so a catalog row can never be
-- removed while events reference it; CASCADE on update allows a rename to
-- propagate rather than orphan history.
DO $$ BEGIN
  ALTER TABLE admin_audit_events
    ADD CONSTRAINT admin_audit_events_action_fkey
    FOREIGN KEY (action) REFERENCES admin_audit_actions(action)
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE admin_audit_events IS
  'Append-only Admin Dashboard audit trail. No client access; inserts only via public.admin_audit_log(). UPDATE/DELETE blocked by trigger for every role. No FK to accounts so history survives account deletion.';
COMMENT ON COLUMN admin_audit_events.actor_user_id IS
  'Administrator UUID from the server-validated session. Deliberately has no FK: deleting the account must not delete the evidence.';
COMMENT ON COLUMN admin_audit_events.correlation_id IS
  'Groups the steps of one logical operation into a single reviewable unit.';

-- Indexes sized for the Audit History page's filters (date range, action,
-- target, success) and for correlation lookups.
CREATE INDEX IF NOT EXISTS admin_audit_events_occurred_idx
  ON admin_audit_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_events_action_occurred_idx
  ON admin_audit_events (action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_events_target_idx
  ON admin_audit_events (target_type, target_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_events_actor_idx
  ON admin_audit_events (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_events_correlation_idx
  ON admin_audit_events (correlation_id);
CREATE INDEX IF NOT EXISTS admin_audit_events_failures_idx
  ON admin_audit_events (occurred_at DESC) WHERE success = FALSE;

-- Reconciliation items must be findable instantly: they mean an external
-- side-effect may have happened with no recorded outcome.
CREATE INDEX IF NOT EXISTS admin_audit_events_reconcile_idx
  ON admin_audit_events (occurred_at DESC) WHERE event_type = 'reconciliation_required';

-- Unresolved attempts (an 'attempt' with no sibling outcome) are found by
-- correlation; this supports that scan.
CREATE INDEX IF NOT EXISTS admin_audit_events_attempt_idx
  ON admin_audit_events (correlation_id) WHERE event_type = 'attempt';


-- ============================================================================
-- SECTION 4 — Append-only enforcement (trigger-level, all roles)
-- ============================================================================
-- RLS policies cannot deliver this: `service_role` has BYPASSRLS, and the table
-- owner would bypass non-FORCEd RLS. Triggers fire for EVERY role, so this is
-- the actual guarantee that recorded history is immutable.
CREATE OR REPLACE FUNCTION private.admin_audit_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'admin_audit_events is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_events_no_update ON admin_audit_events;
CREATE TRIGGER admin_audit_events_no_update
  BEFORE UPDATE ON admin_audit_events
  FOR EACH ROW EXECUTE FUNCTION private.admin_audit_block_mutation();

DROP TRIGGER IF EXISTS admin_audit_events_no_delete ON admin_audit_events;
CREATE TRIGGER admin_audit_events_no_delete
  BEFORE DELETE ON admin_audit_events
  FOR EACH ROW EXECUTE FUNCTION private.admin_audit_block_mutation();

-- TRUNCATE bypasses row-level triggers entirely, so it needs its own statement
-- trigger. Without this, a single TRUNCATE would erase the whole trail.
DROP TRIGGER IF EXISTS admin_audit_events_no_truncate ON admin_audit_events;
CREATE TRIGGER admin_audit_events_no_truncate
  BEFORE TRUNCATE ON admin_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION private.admin_audit_block_mutation();

-- The catalog is likewise protected from deletion, so history can never be
-- orphaned by removing the vocabulary out from under it. UPDATE is allowed
-- (ON UPDATE CASCADE handles renames); DELETE is not.
CREATE OR REPLACE FUNCTION private.admin_audit_block_catalog_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'admin_audit_actions rows are permanent: DELETE is not permitted'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_actions_no_delete ON admin_audit_actions;
CREATE TRIGGER admin_audit_actions_no_delete
  BEFORE DELETE ON admin_audit_actions
  FOR EACH ROW EXECUTE FUNCTION private.admin_audit_block_catalog_delete();


-- ============================================================================
-- SECTION 5 — Server-side sanitization guard (defense in depth)
-- ============================================================================
-- The application already allowlists fields before calling in
-- (lib/admin/auditSanitize.ts). This is the SECOND, independent barrier: even a
-- compromised or buggy server build cannot persist a credential or a private
-- message body, because the database refuses the row.

-- Recursively walks a JSONB value and returns the first offending key path, or
-- NULL when the payload is clean.
CREATE OR REPLACE FUNCTION private.admin_audit_find_forbidden(payload JSONB, path TEXT DEFAULT '')
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  k        TEXT;
  v        JSONB;
  item     JSONB;
  found    TEXT;
  lowered  TEXT;
  -- Substring match: catches password/user_password, token/access_token, etc.
  forbidden TEXT[] := ARRAY[
    'password', 'passwd', 'secret', 'token', 'jwt', 'apikey', 'api_key',
    'servicerole', 'service_role', 'service_key', 'anon_key', 'cookie',
    'authorization', 'auth_header', 'totp', 'otp', 'mfa_code',
    'verification_code', 'entry_path', 'entry_phrase', 'entry_ticket',
    'ticket', 'signature', 'private_key', 'credential', 'session_id'
  ];
BEGIN
  IF payload IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(payload) = 'object' THEN
    FOR k, v IN SELECT * FROM jsonb_each(payload) LOOP
      lowered := lower(k);
      FOR i IN 1 .. array_length(forbidden, 1) LOOP
        IF position(forbidden[i] IN lowered) > 0 THEN
          RETURN path || k;
        END IF;
      END LOOP;

      found := private.admin_audit_find_forbidden(v, path || k || '.');
      IF found IS NOT NULL THEN
        RETURN found;
      END IF;
    END LOOP;

  ELSIF jsonb_typeof(payload) = 'array' THEN
    FOR item IN SELECT * FROM jsonb_array_elements(payload) LOOP
      found := private.admin_audit_find_forbidden(item, path || '[].');
      IF found IS NOT NULL THEN
        RETURN found;
      END IF;
    END LOOP;

  ELSIF jsonb_typeof(payload) = 'string' THEN
    lowered := payload #>> '{}';
    -- A JWT (Supabase access/refresh token, service-role key) always begins
    -- with the base64url encoding of {"alg": ...
    IF lowered ~ '^eyJ[A-Za-z0-9_-]{10,}\.' THEN
      RETURN path || '<jwt-like-value>';
    END IF;
    -- Pre-signed Storage/S3 URLs carry retrievable credentials in the query.
    IF lowered ~* '(X-Amz-Signature|X-Amz-Credential|[?&]token=|Signature=)' THEN
      RETURN path || '<signed-url-value>';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- Keys that may never appear on a message-targeted audit row. Message bodies,
-- attachments and poll text are private content: only metadata (id, length,
-- attachment-present) is ever auditable.
CREATE OR REPLACE FUNCTION private.admin_audit_find_message_content(payload JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  k         TEXT;
  v         JSONB;
  item      JSONB;
  found     TEXT;
  banned    TEXT[] := ARRAY[
    'content', 'body', 'message_body', 'text', 'caption',
    'attachment_url', 'signed_url', 'url',
    'poll_question', 'question', 'content_snapshot', 'attachment_snapshot'
  ];
BEGIN
  IF payload IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(payload) = 'object' THEN
    FOR k, v IN SELECT * FROM jsonb_each(payload) LOOP
      IF lower(k) = ANY (banned) THEN
        RETURN k;
      END IF;
      found := private.admin_audit_find_message_content(v);
      IF found IS NOT NULL THEN
        RETURN found;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(payload) = 'array' THEN
    FOR item IN SELECT * FROM jsonb_array_elements(payload) LOOP
      found := private.admin_audit_find_message_content(item);
      IF found IS NOT NULL THEN
        RETURN found;
      END IF;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

-- BEFORE INSERT validation: sanitization + the per-action reason requirement.
CREATE OR REPLACE FUNCTION private.admin_audit_validate_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  offending    TEXT;
  needs_reason BOOLEAN;
BEGIN
  -- 1. No credentials or credential-bearing values, anywhere, ever.
  FOREACH offending IN ARRAY ARRAY[
    private.admin_audit_find_forbidden(NEW.before_state),
    private.admin_audit_find_forbidden(NEW.after_state),
    private.admin_audit_find_forbidden(NEW.metadata)
  ] LOOP
    IF offending IS NOT NULL THEN
      RAISE EXCEPTION
        'admin audit payload rejected: forbidden key or credential-bearing value at "%"', offending
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- 2. Message-targeted rows carry metadata only — never the body.
  IF NEW.target_type = 'message' THEN
    offending := COALESCE(
      private.admin_audit_find_message_content(NEW.before_state),
      private.admin_audit_find_message_content(NEW.after_state),
      private.admin_audit_find_message_content(NEW.metadata)
    );
    IF offending IS NOT NULL THEN
      RAISE EXCEPTION
        'admin audit payload rejected: private message content ("%") may never be stored', offending
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- 3. Reason requirement, declared per action in the catalog.
  --    Enforced on SUCCESS and ATTEMPT rows: those are the points at which the
  --    operator is committing to the action, so the justification must exist.
  --    NOT enforced on failure/reconciliation rows — a failure can occur before
  --    the operator ever reached a reason prompt (e.g. input validation), and
  --    losing that record would be worse than recording it without a reason.
  --
  --    Because migration 056 writes this row in the SAME transaction as the
  --    mutation, a missing reason RAISES here and rolls the mutation back. The
  --    mutation therefore cannot commit unaudited for want of a reason.
  IF NEW.event_type IN ('success', 'attempt') THEN
    SELECT a.requires_reason INTO needs_reason
      FROM public.admin_audit_actions a
     WHERE a.action = NEW.action;

    IF COALESCE(needs_reason, FALSE)
       AND (NEW.reason IS NULL OR btrim(NEW.reason) = '') THEN
      RAISE EXCEPTION
        'admin audit: action "%" requires a reason', NEW.action
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_events_validate ON admin_audit_events;
CREATE TRIGGER admin_audit_events_validate
  BEFORE INSERT ON admin_audit_events
  FOR EACH ROW EXECUTE FUNCTION private.admin_audit_validate_event();


-- ============================================================================
-- SECTION 6 — The ONLY write path
-- ============================================================================
-- SECURITY DEFINER so it can insert despite service_role's INSERT being
-- revoked (SECTION 7). Executable by service_role only. Note what it does NOT
-- accept: no occurred_at (server clock only) and no way to reach any other
-- table. `search_path = ''` with fully-qualified names, no dynamic SQL, and no
-- executable input.
-- The pre-event_type signature is dropped first so this stays a REPLACEMENT
-- rather than creating a second overload on a re-apply.
DROP FUNCTION IF EXISTS public.admin_audit_log(
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB, JSONB, JSONB, BOOLEAN, TEXT, UUID
);

CREATE OR REPLACE FUNCTION public.admin_audit_log(
  p_actor_user_id  UUID,
  p_actor_email    TEXT,
  p_action         TEXT,
  p_target_type    TEXT,
  p_target_id      UUID    DEFAULT NULL,
  p_reason         TEXT    DEFAULT NULL,
  p_before_state   JSONB   DEFAULT NULL,
  p_after_state    JSONB   DEFAULT NULL,
  p_metadata       JSONB   DEFAULT '{}'::JSONB,
  p_success        BOOLEAN DEFAULT NULL,
  p_error_code     TEXT    DEFAULT NULL,
  p_correlation_id UUID    DEFAULT NULL,
  p_event_type     TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_id  UUID;
  catalog_target_type TEXT;
  resolved_event_type TEXT;
  resolved_success    BOOLEAN;
  resolved_error      TEXT;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'admin audit: actor_user_id is required'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- event_type is the authority. When a caller omits it (the pre-existing
  -- boolean-only contract), derive it so old call sites keep working.
  resolved_event_type := COALESCE(
    NULLIF(btrim(COALESCE(p_event_type, '')), ''),
    CASE WHEN COALESCE(p_success, TRUE) THEN 'success' ELSE 'failure' END
  );

  -- VALIDATE rather than normalize. A caller asserting both "this succeeded"
  -- and "here is the error" is confused, and silently discarding one half would
  -- write a record that misrepresents what happened. Refuse instead.
  resolved_error := NULLIF(btrim(COALESCE(p_error_code, '')), '');

  IF resolved_event_type = 'success' THEN
    IF p_success IS NOT NULL AND p_success = FALSE THEN
      RAISE EXCEPTION 'admin audit: error_consistency — event_type "success" contradicts success=false'
        USING ERRCODE = 'check_violation';
    END IF;
    IF resolved_error IS NOT NULL THEN
      RAISE EXCEPTION 'admin audit: error_consistency — a success record cannot carry an error_code'
        USING ERRCODE = 'check_violation';
    END IF;
    resolved_success := TRUE;

  ELSIF resolved_event_type = 'failure' THEN
    IF p_success IS NOT NULL AND p_success = TRUE THEN
      RAISE EXCEPTION 'admin audit: error_consistency — event_type "failure" contradicts success=true'
        USING ERRCODE = 'check_violation';
    END IF;
    IF resolved_error IS NULL THEN
      RAISE EXCEPTION 'admin audit: error_consistency — a failure record requires an error_code'
        USING ERRCODE = 'check_violation';
    END IF;
    resolved_success := FALSE;

  ELSIF resolved_event_type = 'attempt' THEN
    -- An intention record asserts nothing about the outcome.
    IF resolved_error IS NOT NULL THEN
      RAISE EXCEPTION 'admin audit: error_consistency — an attempt record cannot carry an error_code'
        USING ERRCODE = 'check_violation';
    END IF;
    resolved_success := NULL;

  ELSIF resolved_event_type = 'reconciliation_required' THEN
    IF resolved_error IS NULL THEN
      RAISE EXCEPTION 'admin audit: error_consistency — a reconciliation record requires an error_code'
        USING ERRCODE = 'check_violation';
    END IF;
    resolved_success := NULL;

  ELSE
    RAISE EXCEPTION 'admin audit: unknown event_type "%"', resolved_event_type
      USING ERRCODE = 'check_violation';
  END IF;

  -- The action must exist in the controlled vocabulary, and the caller's
  -- target_type must match what the catalog declares for it. This stops a
  -- correct action name from being filed under the wrong target category.
  SELECT a.target_type INTO catalog_target_type
    FROM public.admin_audit_actions a
   WHERE a.action = p_action;

  IF catalog_target_type IS NULL THEN
    RAISE EXCEPTION 'admin audit: unknown action "%"', p_action
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF catalog_target_type <> p_target_type THEN
    RAISE EXCEPTION
      'admin audit: action "%" is declared for target_type "%", not "%"',
      p_action, catalog_target_type, p_target_type
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.admin_audit_events (
    actor_user_id, actor_email, action, target_type, target_id, reason,
    before_state, after_state, metadata, event_type, success, error_code, correlation_id
  ) VALUES (
    p_actor_user_id,
    NULLIF(btrim(COALESCE(p_actor_email, '')), ''),
    p_action,
    p_target_type,
    p_target_id,
    NULLIF(btrim(COALESCE(p_reason, '')), ''),
    p_before_state,
    p_after_state,
    COALESCE(p_metadata, '{}'::JSONB),
    resolved_event_type,
    resolved_success,
    resolved_error,
    COALESCE(p_correlation_id, gen_random_uuid())
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

COMMENT ON FUNCTION public.admin_audit_log IS
  'The only path that may create an admin_audit_events row. Executable by service_role only; never by anon or authenticated. Timestamps are server-side.';


-- ============================================================================
-- SECTION 7 — Privileges
-- ============================================================================
-- Order matters: revoke everything from everyone, then grant back the minimum.

REVOKE ALL ON TABLE admin_audit_events  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE admin_audit_actions FROM PUBLIC, anon, authenticated, service_role;

-- The dashboard reads the trail through the service-role client, behind
-- requireSecureAdmin(). Reading is all it may do.
GRANT SELECT ON TABLE admin_audit_events  TO service_role;
GRANT SELECT ON TABLE admin_audit_actions TO service_role;

-- Deliberately NOT granted to service_role: INSERT (must go through
-- admin_audit_log), UPDATE, DELETE, TRUNCATE. Deliberately not granted to
-- anon/authenticated: anything at all.

REVOKE ALL ON FUNCTION public.admin_audit_log(
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB, JSONB, JSONB, BOOLEAN, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_audit_log(
  UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB, JSONB, JSONB, BOOLEAN, TEXT, UUID, TEXT
) TO service_role;

-- RLS with NO policies = deny-all for any role that does not bypass it. FORCE
-- extends that to the table owner as well.
ALTER TABLE admin_audit_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_events  FORCE  ROW LEVEL SECURITY;
ALTER TABLE admin_audit_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_actions FORCE  ROW LEVEL SECURITY;

-- Note: no CREATE POLICY statement appears anywhere in this migration. That is
-- intentional and is the mechanism by which browser sessions get no access.


-- ============================================================================
-- SECTION 8 — Seed the action catalog
-- ============================================================================
-- Exactly the 26 actions that lib/admin/*Actions.ts emits today. Nothing
-- speculative: an action is added here when the code that emits it ships.
--
-- requires_reason is TRUE for destructive operations and for privileged
-- changes whose justification a reviewer would need. It is deliberately FALSE
-- for message.revealBody / message.contentSearch in this phase — those are the
-- only two live (non-write-gated) sensitive actions, and turning the
-- requirement on before the UI collects an access reason would break a working
-- MFA-gated feature. Flipping them to TRUE is a one-line change, planned with
-- the Phase 5 reveal-reason UI.
INSERT INTO admin_audit_actions (action, target_type, sensitivity, requires_reason, description) VALUES
  ('membership.add',                'club_member',  'ordinary',    FALSE, 'Add a user to a club as an ordinary member'),
  ('membership.remove',             'club_member',  'destructive', TRUE,  'Remove a member from a club'),
  ('officer.promote',               'club_officer', 'sensitive',   FALSE, 'Promote a member to officer'),
  ('officer.demote',                'club_officer', 'destructive', TRUE,  'Demote an officer to ordinary member'),
  ('officer.add',                   'club_officer', 'sensitive',   FALSE, 'Add an officer roster entry'),
  ('officer.editTitle',             'club_officer', 'ordinary',    FALSE, 'Edit an officer display title'),
  ('gluemate.remove',               'gluemate',     'destructive', TRUE,  'Remove a gluemate (follow) relationship'),
  ('university.add',                'university',   'sensitive',   TRUE,  'Create a university'),
  ('university.edit',               'university',   'sensitive',   FALSE, 'Edit a university name or slug'),
  ('university.setActive',          'university',   'sensitive',   TRUE,  'Activate or deactivate a university'),
  ('portal.lock',                   'portal',       'ordinary',    FALSE, 'Lock the admin portal and clear the entry ticket'),
  ('post.editCaption',              'post',         'ordinary',    FALSE, 'Edit a post caption'),
  ('post.removeFromClub',           'post',         'destructive', TRUE,  'Remove a post''s club tag'),
  ('comment.editContent',           'comment',      'ordinary',    FALSE, 'Edit a comment body'),
  ('event.edit',                    'event',        'ordinary',    FALSE, 'Edit event fields'),
  ('rsvp.upsert',                   'rsvp',         'ordinary',    FALSE, 'Create or change an RSVP'),
  ('rsvp.remove',                   'rsvp',         'destructive', TRUE,  'Remove an RSVP'),
  ('message.revealBody',            'message',      'sensitive',   FALSE, 'Reveal one active message body (step-up MFA)'),
  ('message.contentSearch',         'message',      'sensitive',   FALSE, 'Search active message content (step-up MFA)'),
  ('channel.create',                'channel',      'ordinary',    FALSE, 'Create a conversation channel'),
  ('channel.rename',                'channel',      'ordinary',    FALSE, 'Rename a channel'),
  ('channel.setPermission',         'channel',      'ordinary',    FALSE, 'Change a channel post permission'),
  ('channel.deleteEmpty',           'channel',      'destructive', TRUE,  'Delete a channel that contains no messages'),
  ('notification.setRead',          'notification', 'ordinary',    FALSE, 'Mark a notification read or unread'),
  ('report.setStatus',              'report',       'sensitive',   FALSE, 'Transition a report status'),
  ('deletedContent.reactivateClub', 'club',         'sensitive',   TRUE,  'Reactivate a deactivated club')
ON CONFLICT (action) DO UPDATE SET
  target_type     = EXCLUDED.target_type,
  sensitivity     = EXCLUDED.sensitivity,
  requires_reason = EXCLUDED.requires_reason,
  description     = EXCLUDED.description;


-- ============================================================================
-- TRANSACTION SEMANTICS — read this before trusting the trail
-- ============================================================================
-- The audit insert is NOT atomic with the mutation it describes. Every admin
-- mutation is one or more PostgREST calls, and admin_audit_log() is a separate
-- call in a separate transaction. This is stated plainly rather than implied,
-- because the difference matters when reading the trail:
--
--   • A success row means the mutation had already committed when the row was
--     written.  audit row present  ⇒  mutation happened.
--   • The converse does NOT hold. If the audit insert itself fails (network,
--     rejected payload), the mutation has already committed and cannot be
--     rolled back. The gap is always detectable: the server helper logs an
--     `admin_audit_persist_failed` line to operational telemetry on that path,
--     and it never reports success for the audit write.
--   • Because the audit write is a separate transaction, a failed audit insert
--     can NEVER cause the mutation to partially commit. Independence is the
--     property being bought here, and it is the reason the design is acceptable.
--
-- Making the two genuinely atomic would require every admin mutation to be
-- rewritten as a single in-database function that writes its own audit row in
-- the same transaction. That is a much larger change than Day 10A, and it is
-- recorded as future work rather than pretended away here.
--
-- Which failures are DURABLE vs OPERATIONAL-ONLY:
--   • DURABLE  — any failure reached after a validated secure-admin session
--     exists (validation errors, not-found, refused transitions, RPC status
--     codes). These have a real, authorized actor to attribute.
--   • OPERATIONAL-ONLY — authorization failures themselves (portal disabled,
--     unauthenticated, non-founder, expired session, MFA required, writes
--     disabled). These are logged but never written here, BY DESIGN: an
--     unauthorized caller must not be able to create rows in the audit table,
--     which would otherwise be a trivial denial-of-service / trail-flooding
--     vector against the founder's own evidence.
--
-- ============================================================================
-- RETENTION
-- ============================================================================
-- Audit events are retained INDEFINITELY. There is no automatic purge job, and
-- none should be added without an explicit founder decision — the table is
-- evidence. At We Glue's scale (26 action types, single campus) growth is
-- negligible. If a retention policy is ever adopted it must be implemented as a
-- documented, reviewed migration, because the append-only triggers deliberately
-- make ad-hoc deletion impossible.
--
-- ============================================================================
-- ROLLBACK (manual, only if this migration must be reverted)
-- ============================================================================
--   DROP TRIGGER IF EXISTS admin_audit_events_no_truncate ON admin_audit_events;
--   DROP TRIGGER IF EXISTS admin_audit_events_no_delete   ON admin_audit_events;
--   DROP TRIGGER IF EXISTS admin_audit_events_no_update   ON admin_audit_events;
--   DROP TRIGGER IF EXISTS admin_audit_events_validate    ON admin_audit_events;
--   DROP TRIGGER IF EXISTS admin_audit_actions_no_delete  ON admin_audit_actions;
--   DROP FUNCTION IF EXISTS public.admin_audit_log(UUID,TEXT,TEXT,TEXT,UUID,TEXT,JSONB,JSONB,JSONB,BOOLEAN,TEXT,UUID,TEXT);
--   DROP FUNCTION IF EXISTS private.admin_audit_validate_event();
--   DROP FUNCTION IF EXISTS private.admin_audit_find_message_content(JSONB);
--   DROP FUNCTION IF EXISTS private.admin_audit_find_forbidden(JSONB, TEXT);
--   DROP FUNCTION IF EXISTS private.admin_audit_block_catalog_delete();
--   DROP FUNCTION IF EXISTS private.admin_audit_block_mutation();
--   DROP TABLE IF EXISTS admin_audit_events;
--   DROP TABLE IF EXISTS admin_audit_actions;
-- Dropping the tables destroys the audit trail. Export first.
-- ============================================================================
