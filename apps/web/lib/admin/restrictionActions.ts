"use server";

// Administrator restriction actions.  061 deliberately invalidates We Glue
// application access through the canonical database predicate; it does not
// pretend to revoke a different user's Supabase Auth token.

if (typeof window !== "undefined") throw new Error("restrictionActions is server-only.");

import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import { requireRecentMfaWrite, SecureAdminError } from "./secureAdmin";
import { runAtomicMutation, newCorrelationId, type AtomicFailureDiagnostic } from "./atomicMutation";
import { diagnosticFromUnknown, logRestrictionAction, type RestrictionActionName, type RestrictionDiagnostic } from "./restrictionObservability";
import { MIN_INTERNAL_REASON, MIN_PUBLIC_REASON, MAX_REASON, type RestrictionReasonInput, type RestrictionResult, type RestrictionStatus, type ViolationCategory } from "./restrictionTypes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Context { action: RestrictionActionName; correlationId: string; targetId: string | null; actor: User }

function result(correlationId: string, status: RestrictionStatus, message: string, committed = false, reconciliationRequired = false): RestrictionResult {
  return { ok: committed, status, message, correlationId, restrictionCommitted: committed, accessInvalidated: committed, clientRefreshPending: committed, reconciliationRequired };
}

function log(context: Pick<Context, "action" | "correlationId" | "targetId"> & { actor?: User | null }, stage: Parameters<typeof logRestrictionAction>[0]["stage"], success: boolean, state: RestrictionResult, diagnostic?: RestrictionDiagnostic): void {
  logRestrictionAction({
    correlationId: context.correlationId, action: context.action, stage, targetId: context.targetId,
    administratorId: context.actor?.id ?? null, success, diagnostic,
    restrictionCommitted: state.restrictionCommitted, accessInvalidated: state.accessInvalidated,
    clientRefreshPending: state.clientRefreshPending, reconciliationRequired: state.reconciliationRequired,
  });
}

function failureStatus(error: unknown): RestrictionStatus {
  const reason = error instanceof SecureAdminError ? error.reason : null;
  if (reason === "writes_disabled") return "writesDisabled";
  if (reason === "stepup_required" || reason === "mfa_required") return "stepupRequired";
  return "notApplied";
}

async function prepare(action: RestrictionActionName, userId: unknown): Promise<Context | RestrictionResult> {
  const correlationId = newCorrelationId();
  const targetId = typeof userId === "string" ? userId : null;
  try {
    const actor = await requireRecentMfaWrite();
    const context = { action, correlationId, targetId, actor };
    const baseline = result(correlationId, "notApplied", "The action has not been applied.");
    log(context, "admin_authorization", true, baseline);
    log(context, "write_switch", true, baseline);
    log(context, "recent_mfa", true, baseline);
    return context;
  } catch (error) {
    const state = result(correlationId, failureStatus(error), failureStatus(error) === "writesDisabled" ? "Admin writes are currently disabled." : "The action was not applied.");
    log({ action, correlationId, targetId, actor: null }, "admin_authorization", false, state, diagnosticFromUnknown(error));
    return state;
  }
}

function validCategory(value: unknown): value is ViolationCategory {
  return typeof value === "string" && ["targeted_harassment","threats_or_violence","hate_speech","sexual_harassment","impersonation","spam_or_scams","privacy_violation","inappropriate_content","repeated_guidelines_violations","fraudulent_or_deceptive_behavior","safety_concern","other"].includes(value);
}

function validateReasonInput(context: Context, userId: unknown, input: RestrictionReasonInput): { publicReason: string; internalReason: string; category: ViolationCategory } | RestrictionResult {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) return result(context.correlationId, "invalidTarget", "This account ID is invalid.");
  const publicReason = typeof input?.publicReason === "string" ? input.publicReason.trim() : "";
  const internalReason = typeof input?.internalReason === "string" ? input.internalReason.trim() : "";
  if (!validCategory(input?.violationCategory) || publicReason.length < MIN_PUBLIC_REASON || publicReason.length > MAX_REASON || internalReason.length < MIN_INTERNAL_REASON || internalReason.length > MAX_REASON) {
    return result(context.correlationId, "notApplied", `Choose a violation category, a ${MIN_PUBLIC_REASON}–${MAX_REASON} character student explanation, and a ${MIN_INTERNAL_REASON}–${MAX_REASON} character internal note.`);
  }
  return { publicReason, internalReason, category: input.violationCategory };
}

function validateLiftReason(context: Context, userId: unknown, reason: unknown): string | RestrictionResult {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (typeof userId !== "string" || !UUID_RE.test(userId)) return result(context.correlationId, "invalidTarget", "This account ID is invalid.");
  if (trimmed.length < MIN_INTERNAL_REASON || trimmed.length > MAX_REASON) return result(context.correlationId, "notApplied", `An internal lift reason of ${MIN_INTERNAL_REASON}–${MAX_REASON} characters is required.`);
  return trimmed;
}

function normalizeExpiry(context: Context, value: unknown): string | null | RestrictionResult {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return result(context.correlationId, "notApplied", "The expiration must be in the future.");
  return date.toISOString();
}

function diagnostic(value: AtomicFailureDiagnostic | undefined): RestrictionDiagnostic | undefined {
  return value ? { code: value.code, sqlState: value.sqlState, message: value.message } : undefined;
}

async function run(context: Context, rpc: string, auditAction: Parameters<typeof runAtomicMutation>[0]["action"], internalReason: string, args: Record<string, unknown>): Promise<RestrictionResult> {
  const before = result(context.correlationId, "notApplied", "");
  log(context, "restriction_rpc", true, before);
  const db = await runAtomicMutation({ action: auditAction, actor: context.actor, reason: internalReason, rpc, args: { p_user_id: context.targetId!, ...args }, target: { userId: context.targetId }, correlationId: context.correlationId });
  if (!db.ok) {
    const status: RestrictionStatus = db.failure === "audit" ? "reconciliationRequired" : db.failure === "database" ? "databaseFailure" : db.rpcStatus === "invalid_transition" || db.rpcStatus === "already_suspended" || db.rpcStatus === "already_blocked" || db.rpcStatus === "not_restricted" ? "invalidTransition" : db.rpcStatus === "invalid_target" || db.rpcStatus === "user_not_found" || db.rpcStatus === "platform_admin_target" || db.rpcStatus === "self_target" ? "invalidTarget" : "notApplied";
    const failed = result(context.correlationId, status, db.error, false, db.failure === "audit");
    log(context, "restriction_rpc", false, failed, diagnostic(db.diagnostic));
    return failed;
  }
  const applied = result(context.correlationId, "restrictionAppliedAccessInvalidated", "Applied — We Glue access is blocked on all devices.", true);
  // This is an honest operational record: enforcement is already active in the
  // committed transaction.  Existing Auth tokens remain valid only to reach the
  // restricted shell and self-deletion, never ordinary application data.
  log(context, "access_invalidation", true, applied);
  revalidatePath(`/admin/users/${context.targetId}`);
  revalidatePath("/admin/restrictions");
  return applied;
}

export async function suspendUser(userId: string, input: RestrictionReasonInput, suspendedUntilIso: string | null): Promise<RestrictionResult> {
  const prepared = await prepare("suspend", userId); if ("status" in prepared) return prepared;
  const values = validateReasonInput(prepared, userId, input); if ("status" in values) return values;
  const expiry = normalizeExpiry(prepared, suspendedUntilIso); if (expiry !== null && typeof expiry === "object") return expiry;
  return run(prepared, "admin_tx_restriction_suspend_v2", "restriction.suspend", values.internalReason, { p_suspended_until: expiry, p_violation_category: values.category, p_public_reason: values.publicReason });
}

export async function platformBlockUser(userId: string, input: RestrictionReasonInput): Promise<RestrictionResult> {
  const prepared = await prepare("block", userId); if ("status" in prepared) return prepared;
  const values = validateReasonInput(prepared, userId, input); if ("status" in values) return values;
  return run(prepared, "admin_tx_restriction_block_v2", "restriction.block", values.internalReason, { p_violation_category: values.category, p_public_reason: values.publicReason });
}

export async function unsuspendUser(userId: string, internalReason: string): Promise<RestrictionResult> {
  const prepared = await prepare("unsuspend", userId); if ("status" in prepared) return prepared;
  const reason = validateLiftReason(prepared, userId, internalReason); if (typeof reason !== "string") return reason;
  return run(prepared, "admin_tx_restriction_unsuspend", "restriction.unsuspend", reason, {});
}

export async function unblockUser(userId: string, internalReason: string): Promise<RestrictionResult> {
  const prepared = await prepare("unblock", userId); if ("status" in prepared) return prepared;
  const reason = validateLiftReason(prepared, userId, internalReason); if (typeof reason !== "string") return reason;
  return run(prepared, "admin_tx_restriction_unblock", "restriction.unblock", reason, {});
}

export async function adjustSuspensionExpiry(userId: string, internalReason: string, suspendedUntilIso: string | null): Promise<RestrictionResult> {
  const prepared = await prepare("adjustExpiry", userId); if ("status" in prepared) return prepared;
  const reason = validateLiftReason(prepared, userId, internalReason); if (typeof reason !== "string") return reason;
  const expiry = normalizeExpiry(prepared, suspendedUntilIso); if (expiry !== null && typeof expiry === "object") return expiry;
  return run(prepared, "admin_tx_restriction_adjust_expiry", "restriction.adjustExpiry", reason, { p_suspended_until: expiry });
}
