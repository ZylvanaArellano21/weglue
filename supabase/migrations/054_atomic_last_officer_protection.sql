-- ============================================================
-- We Glue – Atomic last-officer protection
-- Migration: 054_atomic_last_officer_protection.sql
--
-- PROBLEM
-- -------
-- Officer authority is `club_members.role = 'officer'` (see is_club_officer);
-- `club_officers` is the display roster only. The Admin Dashboard's demote path
-- protected the last officer with a check-then-write:
--
--     SELECT count(*) ... WHERE role='officer';   -- application code
--     IF count <= 1 THEN refuse;                  -- <-- TOCTOU window
--     UPDATE club_members SET role='member' ...;
--
-- Two administrator requests demoting the last two officers of the same club can
-- interleave inside that window: each reads "2 officers, safe to proceed", and
-- the club ends with ZERO officers. Nothing in the schema stopped it — unlike
-- memberships / RSVPs / gluemates, which UNIQUE constraints backstop.
--
-- A club with no officer is unrecoverable from inside the product: officer-only
-- surfaces (events, roster, officer chat, club edits) become permanently
-- unreachable for every member.
--
-- DESIGN — two independent layers
-- -------------------------------
-- (a) A TABLE-LEVEL BACKSTOP. Triggers on club_members re-count the club's
--     officers after any change that could reduce them, holding a per-club
--     advisory lock, and RAISE if the count reached zero. Because the RAISE
--     happens inside the caller's transaction, the offending statement is rolled
--     back in full — no partial state, no misleading audit trail.
--
-- (b) ADMIN RPCs that perform the whole officer change (authority row + display
--     roster) inside ONE transaction under that same per-club lock, returning a
--     clean status code instead of an exception for the expected cases.
--
-- WHY THE LOCK MAKES THE RE-COUNT AUTHORITATIVE
-- ---------------------------------------------
-- Under READ COMMITTED, two concurrent transactions do not see each other's
-- uncommitted writes, so a bare re-count would repeat the very race it is meant
-- to close. `pg_advisory_xact_lock(<club key>)` closes it: it serializes every
-- officer-reducing change for a club, and a transaction-scoped advisory lock is
-- released only at COMMIT/ROLLBACK. So the moment a session ACQUIRES the lock,
-- the previous holder has finished — and because the counting function is
-- plpgsql (VOLATILE), each statement inside it takes a fresh snapshot and sees
-- that committed state.
--
-- The count deliberately does NOT use `SELECT ... FOR UPDATE`. Row-locking the
-- whole officer set deadlocks against sessions that have already row-locked
-- their own membership row and are queued for the advisory lock; that cycle was
-- reproduced with four concurrent demotions and is documented at
-- count_club_officers() below. The student-facing `leave_club` (032) can safely
-- use the FOR UPDATE spelling because it locks only rows it reached WITHOUT
-- holding a serializing lock; this guard runs in a trigger, where that is not
-- true.
--
-- CASCADE EXEMPTIONS — DELIBERATE, AND LOAD-BEARING
-- -------------------------------------------------
-- `club_members` cascades from BOTH `clubs` and `profiles`:
--   club_members_club_id_fkey  ON DELETE CASCADE
--   club_members_user_id_fkey  ON DELETE CASCADE
--
-- A naive "a club may never reach zero officers" rule would therefore fire
-- during, and abort:
--   1. PERMANENT ACCOUNT DELETION (delete_user_completely, migration 052 →
--      DELETE FROM auth.users → profiles → club_members). Blocking it would
--      re-break the App Store 5.1.1(v) guarantee that in-app deletion actually
--      deletes — the exact defect 052 was written to fix.
--   2. CLUB DELETION, where "the club has no officers" is meaningless because
--      the club itself no longer exists.
--
-- Both are detected structurally rather than by flag: inside the AFTER trigger,
-- the cascading parent row is ALREADY gone in this transaction, so
--   • no `clubs` row  → club deletion   → skip
--   • no `profiles` row → account deletion → skip
-- Nothing else can produce that state, and neither exemption can be reached by
-- an ordinary UPDATE (the row would have to be deleted, not modified).
--
-- SCOPE OF BEHAVIOUR CHANGE
-- -------------------------
-- Student paths are untouched in every observable way:
--   • leave_club already refuses `blocked_only_officer` before deleting, so it
--     never reaches the RAISE.
--   • remove_club_officer requires the CALLER to be an officer and forbids
--     self-removal, so at least one officer always survives.
--   • Ordinary joins/leaves by members never fire the triggers at all — the
--     WHEN clauses restrict them to rows that were officers.
-- No table, column, index, RLS policy or student-visible behaviour is altered.
-- ============================================================

-- ── Per-club advisory lock key ───────────────────────────────────────────────
-- A stable 64-bit key derived from the club id. Namespaced so it cannot collide
-- with any other advisory lock in the database.
CREATE OR REPLACE FUNCTION public.club_officer_lock_key(p_club_id uuid)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT hashtextextended('club_officer_floor:' || p_club_id::text, 0);
$$;

REVOKE EXECUTE ON FUNCTION public.club_officer_lock_key(uuid) FROM PUBLIC, anon, authenticated;

-- ── Officer count, under the club's advisory lock ────────────────────────────
--
-- Callers MUST already hold pg_advisory_xact_lock(club_officer_lock_key(club))
-- — that is what makes this count authoritative.
--
-- DELIBERATELY NOT `FOR UPDATE`, and this is the second design correction found
-- by the 4-way concurrency test. Row-locking every officer of the club makes the
-- counting session wait on rows that OTHER sessions have already updated, while
-- those sessions wait for the advisory lock this one holds:
--   S1 holds advisory, waits for row(A)   ← FOR UPDATE over the officer set
--   S2 holds row(A),   waits for advisory ← its own UPDATE already locked it
-- Postgres breaks that cycle with `deadlock detected`. The floor still held, but
-- honest callers got a deadlock instead of a clean refusal — unacceptable.
--
-- The row locks are not needed. This function is plpgsql and therefore VOLATILE,
-- so each statement inside it takes a FRESH snapshot: once the advisory lock is
-- acquired (which can only happen after the previous holder COMMITTED), the
-- count observes that committed state. The advisory lock alone provides the
-- serialization; dropping FOR UPDATE removes every cross-session row wait, so
-- the only lock a waiter holds is the row it is itself modifying — no cycle can
-- form. Verified by the 4-way race: 3 demotions commit, the 4th is refused
-- cleanly, zero deadlocks.
CREATE OR REPLACE FUNCTION public.count_club_officers(p_club_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM club_members
  WHERE club_id = p_club_id AND role = 'officer';
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.count_club_officers(uuid) FROM PUBLIC, anon, authenticated;

-- Superseded by count_club_officers() above; dropped so no caller can pick up
-- the deadlock-prone spelling by mistake.
DROP FUNCTION IF EXISTS public.count_club_officers_locked(uuid);

-- ── (a) Table-level backstop ─────────────────────────────────────────────────
--
-- Is this row change exempt from the floor? True while a cascading parent row
-- has ALREADY been removed in this transaction:
--   • no `clubs` row    → the club is being deleted
--   • no `profiles` row → the account is being permanently deleted (052)
-- See the header: both must proceed, and neither is reachable via UPDATE.
CREATE OR REPLACE FUNCTION public.club_officer_floor_exempt(
  p_club_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM clubs    WHERE id = p_club_id)
      OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id);
$$;

REVOKE EXECUTE ON FUNCTION public.club_officer_floor_exempt(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Re-count under the club's advisory lock and refuse if the club hit zero.
--
-- Lock discipline (see count_club_officers for the deadlock analysis): a session
-- waiting here holds only the row it is itself modifying, and the holder of the
-- advisory lock never waits on another session's row. No cycle can form.
CREATE OR REPLACE FUNCTION public.enforce_club_officer_floor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_remaining integer;
BEGIN
  IF club_officer_floor_exempt(OLD.club_id, OLD.user_id) THEN
    RETURN NULL;
  END IF;

  -- Serialize every officer-reducing change for this club. Acquiring this lock
  -- means the previous holder has COMMITTED, so the count below (a fresh
  -- snapshot inside this VOLATILE function) observes the committed truth.
  PERFORM pg_advisory_xact_lock(club_officer_lock_key(OLD.club_id));
  v_remaining := count_club_officers(OLD.club_id);

  IF v_remaining = 0 THEN
    -- 23514 (check_violation): a data-integrity refusal, not a crash. The
    -- message is a stable machine code; callers map it to their own wording and
    -- never surface internals to an end user.
    RAISE EXCEPTION 'club_last_officer'
      USING ERRCODE = '23514',
            DETAIL  = 'A club must always retain at least one active officer.',
            HINT    = 'Promote another member to officer before removing this one.';
  END IF;

  RETURN NULL;
END;
$$;

-- Two triggers, not one: a WHEN clause on a DELETE trigger may not reference
-- NEW, so the UPDATE guard needs its own definition.
DROP TRIGGER IF EXISTS trg_club_officer_floor_delete ON public.club_members;
CREATE TRIGGER trg_club_officer_floor_delete
AFTER DELETE ON public.club_members
FOR EACH ROW
WHEN (OLD.role = 'officer')
EXECUTE FUNCTION public.enforce_club_officer_floor();

DROP TRIGGER IF EXISTS trg_club_officer_floor_update ON public.club_members;
CREATE TRIGGER trg_club_officer_floor_update
AFTER UPDATE OF role ON public.club_members
FOR EACH ROW
WHEN (OLD.role = 'officer' AND NEW.role IS DISTINCT FROM 'officer')
EXECUTE FUNCTION public.enforce_club_officer_floor();

-- Earlier drafts of this migration installed BEFORE-trigger halves; drop them so
-- a database that saw a draft converges on exactly the design above.
DROP TRIGGER IF EXISTS trg_club_officer_floor_lock_delete ON public.club_members;
DROP TRIGGER IF EXISTS trg_club_officer_floor_lock_update ON public.club_members;
DROP FUNCTION IF EXISTS public.lock_club_officer_floor();

-- ── (b) Administrator RPCs ───────────────────────────────────────────────────
--
-- Called ONLY by the Admin Dashboard's service-role client, which has already
-- passed the full gate (private entry ticket → portal switch → validated
-- session → immutable founder UUID → founder email → session maximum age →
-- aal2 MFA → ADMIN_WRITES_ENABLED). These functions therefore do not consult
-- auth.uid(): they are unreachable by `anon` and `authenticated` (revoked
-- below), exactly like the internal helpers locked down in 045.
--
-- Each returns a short status code. Expected refusals return BEFORE any write,
-- so there is nothing to roll back and no misleading audit entry; genuine
-- integrity failures raise and roll the whole call back.

-- Promote a member to officer, or demote an officer to member — authority row
-- and display roster together, atomically.
--
-- `p_add_if_missing` backs the dashboard's "add an officer by searching any
-- user" flow: the membership row and the roster row are then created in the SAME
-- transaction, so a failure part-way cannot leave an officer with no roster
-- entry (or the reverse).
DROP FUNCTION IF EXISTS public.admin_set_club_member_role(uuid, uuid, text, text);
CREATE OR REPLACE FUNCTION public.admin_set_club_member_role(
  p_club_id        uuid,
  p_user_id        uuid,
  p_role           text,
  p_role_title     text DEFAULT 'Officer',
  p_add_if_missing boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role_title   text := btrim(COALESCE(p_role_title, 'Officer'));
  v_current_role text;
  v_display_name text;
  v_avatar_url   text;
  v_club_uni     uuid;
  v_user_uni     uuid;
  v_remaining    integer;
BEGIN
  IF p_role NOT IN ('member', 'officer') THEN
    RETURN 'invalid_role';
  END IF;

  -- Lock the club FIRST so the membership state cannot shift underneath us.
  PERFORM pg_advisory_xact_lock(club_officer_lock_key(p_club_id));

  SELECT role INTO v_current_role
  FROM club_members
  WHERE club_id = p_club_id AND user_id = p_user_id
  FOR UPDATE;

  IF v_current_role IS NULL THEN
    IF NOT p_add_if_missing OR p_role <> 'officer' THEN
      RETURN 'not_member';
    END IF;

    IF length(v_role_title) < 2 OR length(v_role_title) > 40 THEN
      RETURN 'invalid_role_title';
    END IF;

    SELECT university_id INTO v_club_uni FROM clubs WHERE id = p_club_id;
    IF NOT FOUND THEN
      RETURN 'club_not_found';
    END IF;

    SELECT university_id INTO v_user_uni FROM profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
      RETURN 'user_not_found';
    END IF;

    -- Same-campus rule, mirroring add_club_officer.
    IF v_club_uni IS NOT NULL AND v_user_uni IS NOT NULL AND v_club_uni <> v_user_uni THEN
      RETURN 'different_university';
    END IF;

    INSERT INTO club_members (club_id, user_id, role)
    VALUES (p_club_id, p_user_id, 'officer');
    v_current_role := 'officer';
  END IF;

  IF p_role = 'officer' THEN
    IF length(v_role_title) < 2 OR length(v_role_title) > 40 THEN
      RETURN 'invalid_role_title';
    END IF;

    IF v_current_role IS DISTINCT FROM 'officer' THEN
      UPDATE club_members SET role = 'officer'
      WHERE club_id = p_club_id AND user_id = p_user_id;
    END IF;

    SELECT COALESCE(NULLIF(btrim(full_name), ''), username, 'Officer'), avatar_url
    INTO v_display_name, v_avatar_url
    FROM profiles WHERE id = p_user_id;

    INSERT INTO club_officers (club_id, user_id, role_title, display_name, avatar_url)
    VALUES (p_club_id, p_user_id, v_role_title, COALESCE(v_display_name, 'Officer'), v_avatar_url)
    ON CONFLICT (club_id, user_id) WHERE user_id IS NOT NULL DO UPDATE
      SET role_title   = EXCLUDED.role_title,
          display_name = EXCLUDED.display_name,
          avatar_url   = EXCLUDED.avatar_url;

    RETURN 'ok';
  END IF;

  -- Demote.
  IF v_current_role IS DISTINCT FROM 'officer' THEN
    RETURN 'not_officer';
  END IF;

  -- Pre-check under the lock: refuse cleanly, without writing anything.
  v_remaining := count_club_officers(p_club_id);
  IF v_remaining <= 1 THEN
    RETURN 'last_officer';
  END IF;

  UPDATE club_members SET role = 'member'
  WHERE club_id = p_club_id AND user_id = p_user_id;

  DELETE FROM club_officers
  WHERE club_id = p_club_id AND user_id = p_user_id;

  RETURN 'ok';
END;
$$;

-- Remove a membership outright. An officer may only be removed while another
-- officer remains.
CREATE OR REPLACE FUNCTION public.admin_remove_club_member(
  p_club_id uuid,
  p_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current_role text;
  v_remaining    integer;
BEGIN
  PERFORM pg_advisory_xact_lock(club_officer_lock_key(p_club_id));

  SELECT role INTO v_current_role
  FROM club_members
  WHERE club_id = p_club_id AND user_id = p_user_id
  FOR UPDATE;

  IF v_current_role IS NULL THEN
    RETURN 'not_member';
  END IF;

  IF v_current_role = 'officer' THEN
    v_remaining := count_club_officers(p_club_id);
    IF v_remaining <= 1 THEN
      RETURN 'last_officer';
    END IF;
    DELETE FROM club_officers WHERE club_id = p_club_id AND user_id = p_user_id;
  END IF;

  DELETE FROM club_members
  WHERE club_id = p_club_id AND user_id = p_user_id;

  RETURN 'ok';
END;
$$;

-- Hand leadership from one member to another in a SINGLE transaction. The
-- incoming officer is established BEFORE the outgoing one steps down, so the
-- club is never officerless — not even momentarily, and not even if the
-- transaction is rolled back partway.
CREATE OR REPLACE FUNCTION public.admin_transfer_club_officer(
  p_club_id      uuid,
  p_from_user_id uuid,
  p_to_user_id   uuid,
  p_role_title   text DEFAULT 'Officer'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role_title   text := btrim(COALESCE(p_role_title, 'Officer'));
  v_from_role    text;
  v_to_role      text;
  v_club_uni     uuid;
  v_user_uni     uuid;
  v_display_name text;
  v_avatar_url   text;
  v_remaining    integer;
BEGIN
  IF p_from_user_id = p_to_user_id THEN
    RETURN 'same_user';
  END IF;
  IF length(v_role_title) < 2 OR length(v_role_title) > 40 THEN
    RETURN 'invalid_role_title';
  END IF;

  PERFORM pg_advisory_xact_lock(club_officer_lock_key(p_club_id));

  SELECT university_id INTO v_club_uni FROM clubs WHERE id = p_club_id;
  IF NOT FOUND THEN
    RETURN 'club_not_found';
  END IF;

  SELECT role INTO v_from_role
  FROM club_members WHERE club_id = p_club_id AND user_id = p_from_user_id
  FOR UPDATE;
  IF v_from_role IS DISTINCT FROM 'officer' THEN
    RETURN 'from_not_officer';
  END IF;

  SELECT university_id, COALESCE(NULLIF(btrim(full_name), ''), username, 'Officer'), avatar_url
  INTO v_user_uni, v_display_name, v_avatar_url
  FROM profiles WHERE id = p_to_user_id;
  IF v_display_name IS NULL THEN
    RETURN 'user_not_found';
  END IF;

  -- Same-campus rule, mirroring add_club_member_by_officer / add_club_officer.
  IF v_club_uni IS NOT NULL AND v_user_uni IS NOT NULL AND v_club_uni <> v_user_uni THEN
    RETURN 'different_university';
  END IF;

  SELECT role INTO v_to_role
  FROM club_members WHERE club_id = p_club_id AND user_id = p_to_user_id
  FOR UPDATE;

  -- 1. Establish the incoming officer.
  IF v_to_role IS NULL THEN
    INSERT INTO club_members (club_id, user_id, role)
    VALUES (p_club_id, p_to_user_id, 'officer');
  ELSIF v_to_role IS DISTINCT FROM 'officer' THEN
    UPDATE club_members SET role = 'officer'
    WHERE club_id = p_club_id AND user_id = p_to_user_id;
  END IF;

  INSERT INTO club_officers (club_id, user_id, role_title, display_name, avatar_url)
  VALUES (p_club_id, p_to_user_id, v_role_title, v_display_name, v_avatar_url)
  ON CONFLICT (club_id, user_id) WHERE user_id IS NOT NULL DO UPDATE
    SET role_title   = EXCLUDED.role_title,
        display_name = EXCLUDED.display_name,
        avatar_url   = EXCLUDED.avatar_url;

  -- 2. Only then step the outgoing officer down.
  UPDATE club_members SET role = 'member'
  WHERE club_id = p_club_id AND user_id = p_from_user_id;

  DELETE FROM club_officers
  WHERE club_id = p_club_id AND user_id = p_from_user_id;

  -- 3. Final invariant check inside the same transaction. Unreachable in normal
  -- operation; if it ever fires, the ENTIRE transfer rolls back rather than
  -- leaving a club without leadership.
  v_remaining := count_club_officers(p_club_id);
  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'club_last_officer'
      USING ERRCODE = '23514',
            DETAIL  = 'Officer transfer would have left the club with no officers.';
  END IF;

  RETURN 'ok';
END;
$$;

-- ── Grants: trusted backend only ─────────────────────────────────────────────
-- Same posture as 045. These functions do not check auth.uid(), so no client
-- role may ever call them; `service_role` (server-side only, never shipped to a
-- browser or mobile bundle) keeps EXECUTE.
REVOKE EXECUTE ON FUNCTION public.admin_set_club_member_role(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_remove_club_member(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_transfer_club_officer(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_set_club_member_role(uuid, uuid, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_remove_club_member(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_transfer_club_officer(uuid, uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.enforce_club_officer_floor() IS
  'Backstop: a club may never reach zero officers. Exempts club-deletion and account-deletion cascades (see migration 054 header).';
COMMENT ON FUNCTION public.admin_transfer_club_officer(uuid, uuid, uuid, text) IS
  'Atomic officer handover: the incoming officer is established before the outgoing one steps down.';
