"use server";

// ============================================================================
// Administrator account restrictions — privileged write actions  (SERVER-ONLY)
// ============================================================================
//
// Day 10B2. Each action follows the contract established by Day 10A/10B1:
//
//   1. requireRecentMfaWrite()  — portal + immutable founder allowlist +
//      absolute session max age + aal2 + ADMIN_WRITES_ENABLED + recent MFA,
//      in that order. This is the WRITE-specific composition added in Day 10B1
//      precisely so a step-up cannot bypass the kill switch.
//   2. strict input validation on a FIXED shape — no generic mutation endpoint.
//   3. runAtomicMutation() -> a migration-058 admin_tx_restriction_* function,
//      which commits the restriction row AND its durable audit event in ONE
//      transaction, or neither.
//   4. runCrossServiceOperation() -> Supabase Auth session revocation, under
//      the attempt -> outcome pattern with the SAME correlation id, because
//      Postgres and Auth cannot share a transaction.
//
// THE ACTOR IS NEVER SUPPLIED BY THE BROWSER. It is the server-validated
// `User` returned by the gate. A form field cannot impersonate an administrator.
//
// WITH ADMIN_WRITES_ENABLED UNSET, EVERY FUNCTION HERE THROWS BEFORE TOUCHING
// DATA. That is the production posture today.
//
// NO `banned_until`. Founder decision: a restricted student must still be able
// to sign in far enough to reach account deletion. Enforcement is database-side
// (migration 058); revocation only ends existing sessions.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/restrictionActions.ts is server-only.");
}

import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { requireRecentMfaWrite } from "./secureAdmin";
import { runAtomicMutation, newCorrelationId, type ActionResult } from "./atomicMutation";
import { runCrossServiceOperation } from "./crossService";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export const MIN_REASON = 3;
export const MAX_REASON = 500;

/**
 * The four outcomes a restriction action can report, kept distinct because the
 * founder must be able to tell them apart:
 *
 *   applied            restriction committed, sessions revoked
 *   sessionsFailed     restriction committed; revocation failed. ACCESS IS
 *                      STILL DENIED by the database — this is degraded, not
 *                      unsafe, and the existing token merely lives out its hour
 *                      against a database that refuses it.
 *   reconcile          restriction committed, revocation performed, but its
 *                      outcome could not be recorded. Flagged for reconciliation.
 *   rejected           nothing changed.
 */
export type RestrictionOutcome = "applied" | "sessionsFailed" | "reconcile" | "rejected";

export interface RestrictionResult {
  ok: boolean;
  outcome: RestrictionOutcome;
  message: string;
  correlationId: string;
  sessionsRevoked: boolean;
}

function reasonError(): RestrictionResult {
  return {
    ok: false,
    outcome: "rejected",
    message: `A reason of ${MIN_REASON}–${MAX_REASON} characters is required.`,
    correlationId: "",
    sessionsRevoked: false,
  };
}

function validReason(reason: string): boolean {
  const t = (reason ?? "").trim();
  return t.length >= MIN_REASON && t.length <= MAX_REASON;
}

/**
 * Revoke the target's Supabase Auth sessions under the attempt→outcome pattern.
 *
 * ORDER MATTERS AND IS FIXED: the database restriction has ALREADY committed
 * before this runs. If Auth succeeded first and the database write then failed,
 * the student would be signed out with no record of why — the worst outcome.
 * This ordering degrades instead to "restriction in force, old token dies of
 * old age", which is safe and honestly reportable.
 */
async function revokeSessions(
  actor: User,
  userId: string,
  reason: string,
  correlationId: string
): Promise<{ revoked: boolean; reconcile: boolean }> {
  const admin = createAdminClient();
  const res = await runCrossServiceOperation({
    action: "restriction.revokeSessions",
    actor,
    reason,
    target: { userId, scope: "global" },
    perform: async () => {
      // `global` ends every session on every device. It does NOT prevent a new
      // sign-in — deliberately, so the restricted shell and account deletion
      // remain reachable.
      const { error } = await admin.auth.admin.signOut(userId, "global");
      if (error) throw new Error(error.message);
      return true;
    },
  });
  return { revoked: res.ok, reconcile: !res.ok && res.reconciliationRequired };
}

/** Shared tail: run the DB mutation atomically, then revoke sessions. */
async function applyRestriction(opts: {
  actor: User;
  rpc: string;
  action: Parameters<typeof runAtomicMutation>[0]["action"];
  userId: string;
  reason: string;
  args?: Record<string, unknown>;
  /** Lifting a restriction must NOT revoke sessions — see below. */
  revoke: boolean;
}): Promise<RestrictionResult> {
  const correlationId = newCorrelationId();

  const db = await runAtomicMutation({
    action: opts.action,
    actor: opts.actor,
    reason: opts.reason.trim(),
    rpc: opts.rpc,
    args: { p_user_id: opts.userId, ...(opts.args ?? {}) },
    target: { userId: opts.userId, ...(opts.args ?? {}) },
    correlationId,
  });

  if (!db.ok) {
    return { ok: false, outcome: "rejected", message: db.error, correlationId, sessionsRevoked: false };
  }

  if (!opts.revoke) {
    // Unsuspending / unblocking must NOT create a session, and must not destroy
    // one either: the student simply signs in normally again.
    return {
      ok: true,
      outcome: "applied",
      message: "Restriction lifted. The student can sign in normally again.",
      correlationId,
      sessionsRevoked: false,
    };
  }

  const { revoked, reconcile } = await revokeSessions(
    opts.actor,
    opts.userId,
    opts.reason.trim(),
    correlationId
  );

  if (revoked) {
    return {
      ok: true,
      outcome: "applied",
      message: "Restriction applied and existing sessions revoked.",
      correlationId,
      sessionsRevoked: true,
    };
  }
  if (reconcile) {
    return {
      ok: true,
      outcome: "reconcile",
      message:
        "Restriction applied. Sessions were revoked, but the outcome could not be recorded — flagged for reconciliation.",
      correlationId,
      sessionsRevoked: true,
    };
  }
  return {
    ok: true,
    outcome: "sessionsFailed",
    message:
      "Restriction applied, but session revocation FAILED. Access is still denied by the database; the existing token cannot be used and expires on its own.",
    correlationId,
    sessionsRevoked: false,
  };
}

// ── The four controls ────────────────────────────────────────────────────────

export async function suspendUser(
  userId: string,
  reason: string,
  suspendedUntilIso: string | null
): Promise<RestrictionResult> {
  const actor = await requireRecentMfaWrite();
  if (!isUuid(userId)) {
    return { ok: false, outcome: "rejected", message: "Invalid user id.", correlationId: "", sessionsRevoked: false };
  }
  if (!validReason(reason)) return reasonError();

  let until: string | null = null;
  if (suspendedUntilIso) {
    const d = new Date(suspendedUntilIso);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, outcome: "rejected", message: "Invalid expiration date.", correlationId: "", sessionsRevoked: false };
    }
    if (d.getTime() <= Date.now()) {
      return { ok: false, outcome: "rejected", message: "The expiration must be in the future.", correlationId: "", sessionsRevoked: false };
    }
    until = d.toISOString();
  }

  return applyRestriction({
    actor, rpc: "admin_tx_restriction_suspend", action: "restriction.suspend",
    userId, reason, args: { p_suspended_until: until, suspendedUntil: until }, revoke: true,
  });
}

export async function unsuspendUser(userId: string, reason: string): Promise<RestrictionResult> {
  const actor = await requireRecentMfaWrite();
  if (!isUuid(userId)) {
    return { ok: false, outcome: "rejected", message: "Invalid user id.", correlationId: "", sessionsRevoked: false };
  }
  if (!validReason(reason)) return reasonError();
  return applyRestriction({
    actor, rpc: "admin_tx_restriction_unsuspend", action: "restriction.unsuspend",
    userId, reason, revoke: false,
  });
}

export async function platformBlockUser(userId: string, reason: string): Promise<RestrictionResult> {
  const actor = await requireRecentMfaWrite();
  if (!isUuid(userId)) {
    return { ok: false, outcome: "rejected", message: "Invalid user id.", correlationId: "", sessionsRevoked: false };
  }
  if (!validReason(reason)) return reasonError();
  return applyRestriction({
    actor, rpc: "admin_tx_restriction_block", action: "restriction.block",
    userId, reason, revoke: true,
  });
}

export async function unblockUser(userId: string, reason: string): Promise<RestrictionResult> {
  const actor = await requireRecentMfaWrite();
  if (!isUuid(userId)) {
    return { ok: false, outcome: "rejected", message: "Invalid user id.", correlationId: "", sessionsRevoked: false };
  }
  if (!validReason(reason)) return reasonError();
  return applyRestriction({
    actor, rpc: "admin_tx_restriction_unblock", action: "restriction.unblock",
    userId, reason, revoke: false,
  });
}

/**
 * Change an active suspension's expiry.
 *
 * A SEPARATE, SEPARATELY AUDITED action rather than a silent edit of the
 * existing row: changing how long someone is locked out is a decision that
 * deserves its own record and its own reason. Sessions are NOT re-revoked —
 * they were already revoked when the suspension was applied.
 */
export async function adjustSuspensionExpiry(
  userId: string,
  reason: string,
  suspendedUntilIso: string | null
): Promise<RestrictionResult> {
  const actor = await requireRecentMfaWrite();
  if (!isUuid(userId)) {
    return { ok: false, outcome: "rejected", message: "Invalid user id.", correlationId: "", sessionsRevoked: false };
  }
  if (!validReason(reason)) return reasonError();

  let until: string | null = null;
  if (suspendedUntilIso) {
    const d = new Date(suspendedUntilIso);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, outcome: "rejected", message: "Invalid expiration date.", correlationId: "", sessionsRevoked: false };
    }
    if (d.getTime() <= Date.now()) {
      return { ok: false, outcome: "rejected", message: "The expiration must be in the future.", correlationId: "", sessionsRevoked: false };
    }
    until = d.toISOString();
  }

  return applyRestriction({
    actor, rpc: "admin_tx_restriction_adjust_expiry", action: "restriction.adjustExpiry",
    userId, reason, args: { p_suspended_until: until, suspendedUntil: until }, revoke: false,
  });
}
