"use server";

// ============================================================================
// Administrator account restrictions — privileged write actions (SERVER-ONLY)
// ============================================================================
//
// Each action uses the same fixed path:
//   secure founder + aal2 + write switch + recent MFA → strict input validation
//   → one migration-058 RPC (restriction + primary audit atomically) → optional
//   Auth session revocation under an attempt/outcome audit pattern → revalidate.
//
// The browser supplies only a target, reason, and optional expiry. It never
// supplies an administrator identity, correlation id, or RPC name.
//
// NO `banned_until`: a restricted student must still reach account deletion.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/restrictionActions.ts is server-only.");
}

import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { requireRecentMfaWrite, SecureAdminError } from "./secureAdmin";
import { runAtomicMutation, newCorrelationId, type AtomicFailureDiagnostic } from "./atomicMutation";
import { runCrossServiceOperation } from "./crossService";
import {
  diagnosticFromUnknown,
  logRestrictionAction,
  type RestrictionActionName,
  type RestrictionActionStage,
  type RestrictionDiagnostic,
} from "./restrictionObservability";
import { MIN_REASON, MAX_REASON, type RestrictionResult, type RestrictionStatus } from "./restrictionTypes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

interface ActionContext {
  action: RestrictionActionName;
  correlationId: string;
  targetId: string | null;
  actor: User;
}

type PrepareResult = { context: ActionContext } | { result: RestrictionResult };

function result(
  correlationId: string,
  status: RestrictionStatus,
  message: string,
  overrides: Partial<Pick<RestrictionResult, "restrictionCommitted" | "sessionRevocationAttempted" | "sessionsRevoked" | "reconciliationRequired">> = {}
): RestrictionResult {
  const restrictionCommitted = overrides.restrictionCommitted ?? false;
  return {
    ok: restrictionCommitted,
    status,
    message,
    correlationId,
    restrictionCommitted,
    sessionRevocationAttempted: overrides.sessionRevocationAttempted ?? false,
    sessionsRevoked: overrides.sessionsRevoked ?? false,
    reconciliationRequired: overrides.reconciliationRequired ?? false,
  };
}

function log(
  context: Pick<ActionContext, "action" | "correlationId" | "targetId"> & { actor?: User | null },
  stage: RestrictionActionStage,
  success: boolean,
  state: Pick<RestrictionResult, "restrictionCommitted" | "sessionRevocationAttempted" | "sessionsRevoked" | "reconciliationRequired">,
  diagnostic?: RestrictionDiagnostic | null
): void {
  logRestrictionAction({
    correlationId: context.correlationId,
    action: context.action,
    stage,
    targetId: context.targetId,
    administratorId: context.actor?.id ?? null,
    success,
    diagnostic,
    restrictionCommitted: state.restrictionCommitted,
    sessionRevocationAttempted: state.sessionRevocationAttempted,
    sessionRevocationSucceeded: state.sessionRevocationAttempted ? state.sessionsRevoked : null,
    reconciliationRequired: state.reconciliationRequired,
  });
}

function respond(
  context: Pick<ActionContext, "action" | "correlationId" | "targetId"> & { actor?: User | null },
  actionResult: RestrictionResult,
  diagnostic?: RestrictionDiagnostic | null
): RestrictionResult {
  log(context, "response_serialization", actionResult.ok, actionResult, diagnostic);
  return actionResult;
}

function secureFailure(
  action: RestrictionActionName,
  correlationId: string,
  targetId: string | null,
  error: unknown
): RestrictionResult {
  const diagnostic = diagnosticFromUnknown(error);
  const reason = error instanceof SecureAdminError ? error.reason : null;
  const status: RestrictionStatus =
    reason === "writes_disabled"
      ? "writesDisabled"
      : reason === "stepup_required" || reason === "mfa_required"
      ? "stepupRequired"
      : "notApplied";
  const message =
    status === "writesDisabled"
      ? "Admin writes are currently disabled."
      : status === "stepupRequired"
      ? "Your recent MFA verification expired. Verify again and retry."
      : "The action was not applied.";
  const failure = result(correlationId, status, message);
  const stage: RestrictionActionStage =
    reason === "writes_disabled" ? "write_switch" : reason === "stepup_required" ? "recent_mfa" : "admin_authorization";
  const context = { action, correlationId, targetId, actor: null };
  log(context, stage, false, failure, diagnostic);
  return respond(context, failure, diagnostic);
}

async function prepareAction(action: RestrictionActionName, targetId: unknown): Promise<PrepareResult> {
  const correlationId = newCorrelationId();
  const target = typeof targetId === "string" ? targetId : null;

  try {
    const actor = await requireRecentMfaWrite();
    const context = { action, correlationId, targetId: target, actor };
    const baseline = result(correlationId, "notApplied", "The action has not been applied.");
    // The guard is deliberately the authority for all three checks. These
    // success records make the enforced path observable without exposing MFA
    // material or credentials.
    log(context, "admin_authorization", true, baseline);
    log(context, "write_switch", true, baseline);
    log(context, "recent_mfa", true, baseline);
    return { context };
  } catch (error) {
    return { result: secureFailure(action, correlationId, target, error) };
  }
}

function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON ? trimmed : null;
}

function invalidInput(
  context: ActionContext,
  status: RestrictionStatus,
  message: string
): RestrictionResult {
  const failed = result(context.correlationId, status, message);
  log(context, "input_validation", false, failed);
  return respond(context, failed);
}

function validateTargetAndReason(context: ActionContext, userId: unknown, reason: unknown): { reason: string } | RestrictionResult {
  if (!isUuid(userId)) return invalidInput(context, "invalidTarget", "This account ID is invalid.");
  const normalizedReason = normalizeReason(reason);
  if (!normalizedReason) {
    return invalidInput(context, "notApplied", `A reason of ${MIN_REASON}–${MAX_REASON} characters is required.`);
  }
  return { reason: normalizedReason };
}

function parseSuspensionExpiry(
  context: ActionContext,
  rawValue: unknown
): { until: string | null } | RestrictionResult {
  if (rawValue === null || rawValue === undefined || rawValue === "") return { until: null };
  if (typeof rawValue !== "string") return invalidInput(context, "notApplied", "Invalid expiration date.");
  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return invalidInput(context, "notApplied", "Invalid expiration date.");
  if (date.getTime() <= Date.now()) {
    return invalidInput(context, "notApplied", "The expiration must be in the future.");
  }
  return { until: date.toISOString() };
}

function restrictionStatusForFailure(
  failure: "validation" | "business" | "database" | "audit",
  rpcStatus?: string
): RestrictionStatus {
  if (failure === "audit") return "auditFailure";
  if (failure === "database") return "databaseFailure";
  if (
    rpcStatus === "invalid_target" ||
    rpcStatus === "user_not_found" ||
    rpcStatus === "platform_admin_target" ||
    rpcStatus === "self_target"
  ) {
    return "invalidTarget";
  }
  if (
    rpcStatus === "invalid_transition" ||
    rpcStatus === "already_suspended" ||
    rpcStatus === "already_blocked" ||
    rpcStatus === "not_restricted"
  ) {
    return "invalidTransition";
  }
  return "notApplied";
}

function toDiagnostic(diagnostic: AtomicFailureDiagnostic | undefined): RestrictionDiagnostic | undefined {
  if (!diagnostic) return undefined;
  return {
    code: diagnostic.code,
    sqlState: diagnostic.sqlState,
    message: diagnostic.message,
  };
}

async function revalidateRestrictionViews(context: ActionContext, actionResult: RestrictionResult): Promise<void> {
  try {
    revalidatePath(`/admin/users/${context.targetId}`);
    revalidatePath("/admin/restrictions");
    log(context, "revalidation", true, actionResult);
  } catch (error) {
    // The transition has already committed. Never transform a cache failure into
    // a false "not applied" result; client-side router.refresh() remains a
    // second convergence path.
    log(context, "revalidation", false, actionResult, diagnosticFromUnknown(error));
  }
}

async function revokeSessions(context: ActionContext, reason: string) {
  const before = result(context.correlationId, "notApplied", "", {
    restrictionCommitted: true,
    sessionRevocationAttempted: true,
  });
  log(context, "revocation_attempt", true, before);

  const outcome = await runCrossServiceOperation({
    action: "restriction.revokeSessions",
    actor: context.actor,
    reason,
    target: { userId: context.targetId, scope: "global" },
    correlationId: context.correlationId,
    perform: async () => {
      const admin = createAdminClient();
      const { error } = await admin.auth.admin.signOut(context.targetId!, "global");
      if (error) {
        const wrapped = new Error(error.message);
        Object.assign(wrapped, { code: error.code });
        throw wrapped;
      }
      return true;
    },
  });

  const state = {
    restrictionCommitted: true,
    sessionRevocationAttempted: outcome.attempted,
    sessionsRevoked: outcome.succeeded === true,
    reconciliationRequired: !outcome.ok && outcome.reconciliationRequired,
  };
  log(context, "revocation_outcome", outcome.ok, state, outcome.ok ? undefined : outcome.diagnostic);
  return { outcome, ...state };
}

/** Shared tail: atomic database transition, optional session revocation, cache convergence. */
async function applyRestriction(opts: {
  context: ActionContext;
  rpc: string;
  action: Parameters<typeof runAtomicMutation>[0]["action"];
  reason: string;
  rpcArgs?: Record<string, unknown>;
  targetMetadata?: Record<string, unknown>;
  /** Lifting a restriction must neither create nor revoke a session. */
  revoke: boolean;
}): Promise<RestrictionResult> {
  const { context } = opts;
  const baseline = result(context.correlationId, "notApplied", "");
  log(context, "restriction_rpc", true, baseline);

  const db = await runAtomicMutation({
    action: opts.action,
    actor: context.actor,
    reason: opts.reason,
    rpc: opts.rpc,
    // Keep transport arguments separate from audit metadata. PostgREST matches
    // RPCs by these exact names: `suspendedUntil` is metadata, never an RPC arg.
    args: { p_user_id: context.targetId!, ...(opts.rpcArgs ?? {}) },
    target: { userId: context.targetId, ...(opts.targetMetadata ?? {}) },
    correlationId: context.correlationId,
  });

  if (!db.ok) {
    const failed = result(
      context.correlationId,
      restrictionStatusForFailure(db.failure, db.rpcStatus),
      db.failure === "database" || db.failure === "audit" ? "The action was not applied." : db.error
    );
    const diagnostic = toDiagnostic(db.diagnostic);
    log(context, "restriction_rpc", false, failed, diagnostic);
    return respond(context, failed, diagnostic);
  }

  const committed = result(context.correlationId, "applied", "", { restrictionCommitted: true });
  log(context, "restriction_committed", true, committed);

  if (!opts.revoke) {
    const applied = result(
      context.correlationId,
      "applied",
      "Restriction lifted. The student can sign in normally again.",
      { restrictionCommitted: true }
    );
    await revalidateRestrictionViews(context, applied);
    return respond(context, applied);
  }

  const revocation = await revokeSessions(context, opts.reason);
  let applied: RestrictionResult;
  if (revocation.outcome.ok) {
    applied = result(
      context.correlationId,
      "appliedSessionsRevoked",
      "Restriction applied and existing sessions revoked.",
      revocation
    );
  } else if (revocation.reconciliationRequired) {
    applied = result(
      context.correlationId,
      "reconciliationRequired",
      "The restriction was applied, but session revocation needs reconciliation.",
      revocation
    );
  } else if (revocation.outcome.failure === "audit") {
    applied = result(
      context.correlationId,
      "auditFailure",
      "The restriction was applied, but session revocation needs attention.",
      revocation
    );
  } else {
    applied = result(
      context.correlationId,
      "appliedSessionsFailed",
      "The restriction was applied, but session revocation needs attention.",
      revocation
    );
  }

  await revalidateRestrictionViews(context, applied);
  return respond(context, applied, revocation.outcome.ok ? undefined : revocation.outcome.diagnostic);
}

// ── The four restriction controls ───────────────────────────────────────────

export async function suspendUser(
  userId: string,
  reason: string,
  suspendedUntilIso: string | null
): Promise<RestrictionResult> {
  const prepared = await prepareAction("suspend", userId);
  if ("result" in prepared) return prepared.result;
  const { context } = prepared;

  const validated = validateTargetAndReason(context, userId, reason);
  if ("status" in validated) return validated;
  const expiry = parseSuspensionExpiry(context, suspendedUntilIso);
  if ("status" in expiry) return expiry;
  log(context, "input_validation", true, result(context.correlationId, "notApplied", ""));

  return applyRestriction({
    context,
    rpc: "admin_tx_restriction_suspend",
    action: "restriction.suspend",
    reason: validated.reason,
    rpcArgs: { p_suspended_until: expiry.until },
    targetMetadata: { suspendedUntil: expiry.until },
    revoke: true,
  });
}

export async function unsuspendUser(userId: string, reason: string): Promise<RestrictionResult> {
  const prepared = await prepareAction("unsuspend", userId);
  if ("result" in prepared) return prepared.result;
  const { context } = prepared;
  const validated = validateTargetAndReason(context, userId, reason);
  if ("status" in validated) return validated;
  log(context, "input_validation", true, result(context.correlationId, "notApplied", ""));
  return applyRestriction({
    context,
    rpc: "admin_tx_restriction_unsuspend",
    action: "restriction.unsuspend",
    reason: validated.reason,
    revoke: false,
  });
}

export async function platformBlockUser(userId: string, reason: string): Promise<RestrictionResult> {
  const prepared = await prepareAction("block", userId);
  if ("result" in prepared) return prepared.result;
  const { context } = prepared;
  const validated = validateTargetAndReason(context, userId, reason);
  if ("status" in validated) return validated;
  log(context, "input_validation", true, result(context.correlationId, "notApplied", ""));
  return applyRestriction({
    context,
    rpc: "admin_tx_restriction_block",
    action: "restriction.block",
    reason: validated.reason,
    revoke: true,
  });
}

export async function unblockUser(userId: string, reason: string): Promise<RestrictionResult> {
  const prepared = await prepareAction("unblock", userId);
  if ("result" in prepared) return prepared.result;
  const { context } = prepared;
  const validated = validateTargetAndReason(context, userId, reason);
  if ("status" in validated) return validated;
  log(context, "input_validation", true, result(context.correlationId, "notApplied", ""));
  return applyRestriction({
    context,
    rpc: "admin_tx_restriction_unblock",
    action: "restriction.unblock",
    reason: validated.reason,
    revoke: false,
  });
}

/** Explicitly audited suspension-expiry adjustment; it never re-revokes sessions. */
export async function adjustSuspensionExpiry(
  userId: string,
  reason: string,
  suspendedUntilIso: string | null
): Promise<RestrictionResult> {
  const prepared = await prepareAction("adjustExpiry", userId);
  if ("result" in prepared) return prepared.result;
  const { context } = prepared;
  const validated = validateTargetAndReason(context, userId, reason);
  if ("status" in validated) return validated;
  const expiry = parseSuspensionExpiry(context, suspendedUntilIso);
  if ("status" in expiry) return expiry;
  log(context, "input_validation", true, result(context.correlationId, "notApplied", ""));
  return applyRestriction({
    context,
    rpc: "admin_tx_restriction_adjust_expiry",
    action: "restriction.adjustExpiry",
    reason: validated.reason,
    rpcArgs: { p_suspended_until: expiry.until },
    targetMetadata: { suspendedUntil: expiry.until },
    revoke: false,
  });
}
