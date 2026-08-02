// ============================================================================
// Admin Dashboard — durable audit logging  (SERVER-ONLY)
// ============================================================================
//
// Day 10A replaced the console-only mechanism with a real, append-only table
// (migration 055). Every admin mutation and every sensitive read now writes a
// row to `admin_audit_events` through `public.admin_audit_log()` — the single
// database entry point that even the service-role key cannot bypass.
//
// WHAT CALLERS SEE
// ----------------
// `adminAudit()` is now ASYNC. It never throws: an action must not fail, and a
// user must not see an error, because an audit write had trouble. It returns
// `{ persisted }` so a caller that cares can react, and it always emits the
// structured operational log line either way.
//
// TRANSACTION SEMANTICS — stated plainly, not implied
// ---------------------------------------------------
// The audit insert is a SEPARATE database round-trip from the mutation it
// describes. It is NOT atomic with it, and this module does not pretend
// otherwise:
//
//   • A `success: true` row means the mutation had already committed when the
//     row was written.        audit row present ⇒ mutation happened.
//   • The converse does not hold. If the audit insert itself fails, the
//     mutation has already committed and cannot be rolled back. That gap is
//     always DETECTABLE: `admin_audit_persist_failed` is logged to operational
//     telemetry, and `persisted: false` is returned. It is never silent.
//   • Because the two are separate transactions, a failed audit insert can
//     never cause the mutation to partially commit. That independence is the
//     property this design is buying.
//
// Genuine atomicity would require rewriting every admin mutation as a single
// in-database function that writes its own audit row in the same transaction —
// a far larger change than Day 10A, recorded as future work rather than faked.
//
// WHICH FAILURES ARE DURABLE
// --------------------------
//   • DURABLE — any failure reached AFTER a validated secure-admin session
//     exists (validation errors, not-found, refused transitions, RPC statuses).
//     There is a real, authorized actor to attribute them to.
//   • OPERATIONAL-ONLY — authorization failures themselves (portal disabled,
//     unauthenticated, non-founder, expired session, MFA required, writes
//     disabled). Those throw SecureAdminError before any actor exists, so they
//     never reach this module. That is DELIBERATE: if unauthorized callers
//     could create audit rows, anyone who found the endpoint could flood the
//     founder's own evidence table.
//
// AUTHORIZATION ORDERING
// ----------------------
// This module builds the service-role client. Every caller invokes it only
// AFTER `requireSecureAdmin()` has resolved, so the key is never constructed
// for an unauthorized request. The actor is always the server-validated `User`
// — browser-supplied identity is never accepted here or anywhere upstream.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/audit.ts is server-only and must not be imported in the browser.");
}

import { randomUUID } from "crypto";
import { createAdminClient } from "../supabase/admin";
import {
  AUDIT_ACTIONS,
  isAuditAction,
  sanitizeState,
  sanitizeTarget,
  sanitizeReason,
  sanitizeErrorCode,
  type AuditAction,
} from "./auditSanitize";

export type { AuditAction } from "./auditSanitize";

export interface AdminAuditEntry {
  /** Must exist in the controlled vocabulary (AUDIT_ACTIONS / migration 055). */
  action: AuditAction | string;
  /** Server-validated administrator id. Never accepted from the browser. */
  actorId: string;
  actorEmail?: string | null;
  /** Loosely-shaped call-site data; reduced to (target_id, metadata) by allowlist. */
  target: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  ok: boolean;
  error?: string;
  /** Required by the database for destructive actions on SUCCESS rows. */
  reason?: string | null;
  /** Supply to group the steps of one logical operation; generated otherwise. */
  correlationId?: string;
  /**
   * Record lifecycle. Omit for ordinary operations — it is then derived from
   * `ok` (success/failure). Supply 'attempt' / 'reconciliation_required' only
   * from the cross-service flow in crossService.ts, where the outcome is
   * genuinely not yet known.
   */
  eventType?: AdminAuditEventType;
}

export type AdminAuditEventType = "attempt" | "success" | "failure" | "reconciliation_required";

export interface AdminAuditResult {
  /** True only when the row is committed to admin_audit_events. */
  persisted: boolean;
  correlationId: string;
  auditId?: string;
}

/** Generate a correlation id to thread through a multi-step operation. */
export function newCorrelationId(): string {
  return randomUUID();
}

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function maskOperationalId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 8 ? value : `${value.slice(0, 8)}…`;
}

function sanitizeOperationalMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "unknown";
  return message
    .replace(UUID_PATTERN, (id) => `${id.slice(0, 8)}…`)
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(/\b(Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .slice(0, 240);
}

function logOperational(record: Record<string, unknown>): void {
  // Secondary operational telemetry: a single structured line, greppable in
  // Vercel logs. This is NOT the audit trail any more — the table is — but it
  // remains the fastest way to correlate an incident with server behaviour, and
  // it is the only record of an audit write that failed to persist.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(record));
}

/**
 * Record an administrator action durably, then log it operationally.
 *
 * Never throws. Returns `{ persisted }` so a caller can distinguish "recorded"
 * from "mutation happened but the trail did not record it".
 */
export async function adminAudit(entry: AdminAuditEntry): Promise<AdminAuditResult> {
  const correlationId = entry.correlationId ?? newCorrelationId();
  const ts = new Date().toISOString();

  // An action outside the controlled vocabulary is a programming error. It is
  // logged loudly and NOT written: the database would reject it anyway, and a
  // silent unknown-action row would corrupt the vocabulary's meaning.
  if (!isAuditAction(entry.action)) {
    logOperational({
      tag: "admin_audit_unknown_action",
      ts,
      action: entry.action,
      actorId: maskOperationalId(entry.actorId),
      correlationId,
    });
    return { persisted: false, correlationId };
  }

  const action: AuditAction = entry.action;
  const spec = AUDIT_ACTIONS[action];
  const { targetId, metadata } = sanitizeTarget(action, entry.target);
  const beforeState = sanitizeState(spec.targetType, entry.before);
  const afterState = sanitizeState(spec.targetType, entry.after);
  const reason = sanitizeReason(entry.reason);
  // The database enforces (success XOR error_code); make the mapping explicit
  // rather than relying on callers to always pass an error on the failure path.
  const eventType: AdminAuditEventType = entry.eventType ?? (entry.ok ? "success" : "failure");
  // The database validates (event_type, success, error_code) agreement and
  // refuses a self-contradictory row, so normalize here rather than sending one.
  const wantsError = eventType === "failure" || eventType === "reconciliation_required";
  const errorCode = wantsError
    ? sanitizeErrorCode(entry.error) ?? (eventType === "failure" ? "unspecified_error" : "outcome_not_recorded")
    : null;
  const successFlag = eventType === "success" ? true : eventType === "failure" ? false : null;

  const operational = {
    tag: "admin_audit",
    ts,
    action,
    // Operational logs are intentionally less detailed than the durable,
    // founder-only audit record. They must remain safe to search and share.
    actorId: maskOperationalId(entry.actorId),
    targetType: spec.targetType,
    targetId: maskOperationalId(targetId),
    eventType,
    ok: entry.ok,
    errorCode,
    correlationId,
  };

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("admin_audit_log", {
      p_actor_user_id: entry.actorId,
      p_actor_email: entry.actorEmail ?? null,
      p_action: action,
      p_target_type: spec.targetType,
      p_target_id: targetId,
      p_reason: reason,
      p_before_state: beforeState,
      p_after_state: afterState,
      p_metadata: metadata,
      p_success: successFlag,
      p_error_code: errorCode,
      p_correlation_id: correlationId,
      p_event_type: eventType,
    });

    if (error) {
      // The mutation (if any) has already committed. Surface the gap loudly —
      // never swallow it, and never report the audit write as successful.
      logOperational({
        ...operational,
        tag: "admin_audit_persist_failed",
        persistError: sanitizeOperationalMessage(error.message),
      });
      return { persisted: false, correlationId };
    }

    logOperational({ ...operational, auditId: data ?? null, persisted: true });
    return { persisted: true, correlationId, auditId: (data as string | null) ?? undefined };
  } catch (e) {
    logOperational({
      ...operational,
      tag: "admin_audit_persist_failed",
      persistError: sanitizeOperationalMessage(e),
    });
    return { persisted: false, correlationId };
  }
}
