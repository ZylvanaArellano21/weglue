// ============================================================================
// Admin Dashboard — cross-service audit pattern  (SERVER-ONLY)
// ============================================================================
//
// PostgreSQL, Supabase Auth and Supabase Storage cannot share a transaction, so
// the migration-056 guarantee ("mutation and audit commit together, or neither
// does") is IMPOSSIBLE for any operation that touches Auth or Storage. This
// module implements the honest alternative — an append-only correlated flow —
// and deliberately does NOT claim atomicity.
//
//   1. Write a durable ATTEMPT record BEFORE touching the external service.
//   2. If that record cannot be persisted, DO NOT perform the external action.
//      An unrecorded external side-effect is the thing we are preventing; when
//      in doubt, do nothing.
//   3. Perform the external operation.
//   4. Write a SEPARATE success or failure record with the SAME correlation id.
//   5. The attempt record is NEVER updated or overwritten. It cannot be —
//      admin_audit_events is append-only at the database level.
//   6. If the outcome record cannot be persisted, write a
//      RECONCILIATION_REQUIRED record. If even that fails, the attempt record
//      still stands alone, which is itself the signal: an attempt with no
//      sibling outcome means "we started this and do not know how it ended".
//
// WHAT THIS BUYS, PRECISELY
//   • No external side-effect can occur with no trace at all.
//   • An operator can always tell "started" from "completed" from "unknown".
//   • It does NOT guarantee the external effect matches the record. Nothing
//     short of a distributed transaction could, and Supabase offers none.
//
// CURRENT SCOPE: exactly one operation uses this today — `portal.lock`, which
// signs the administrator out through Supabase Auth. User deletion and
// deleted-message retention are NOT implemented here; they are future work, and
// this module exists so they inherit a reviewed pattern rather than inventing
// one under pressure.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/crossService.ts is server-only and must not be imported in the browser.");
}

import type { User } from "@supabase/supabase-js";
import { adminAudit, newCorrelationId } from "./audit";
import { assertAuditReason, type AuditAction } from "./auditSanitize";

export type CrossServiceOutcome<T> =
  | { ok: true; data: T; correlationId: string; attempted: true; succeeded: true }
  | {
      ok: false;
      error: string;
      correlationId: string;
      reconciliationRequired: boolean;
      attempted: boolean;
      succeeded: boolean | null;
      failure: "audit" | "external";
      diagnostic?: { code: string | null; sqlState: string | null; message: string | null };
    };

export interface CrossServiceOptions<T> {
  action: AuditAction;
  actor: User;
  reason?: string | null;
  target: Record<string, unknown>;
  /** Reuse the parent mutation correlation id for every cross-service leg. */
  correlationId?: string;
  /** The external side-effect. Anything it throws is treated as a failure. */
  perform: () => Promise<T>;
}

function diagnosticFromError(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : null;
  return {
    code,
    sqlState: code && /^[0-9A-Z]{5}$/i.test(code) ? code : null,
    message: typeof candidate?.message === "string" ? candidate.message : null,
  };
}

/**
 * Run an Auth/Storage/multi-service administrator operation under the
 * attempt→outcome pattern described above.
 */
export async function runCrossServiceOperation<T>(
  opts: CrossServiceOptions<T>
): Promise<CrossServiceOutcome<T>> {
  const correlationId = opts.correlationId ?? newCorrelationId();
  const reason = opts.reason ?? null;

  // Reason first: a destructive cross-service action must not even record an
  // attempt (let alone perform one) without its justification.
  try {
    assertAuditReason(opts.action, reason);
  } catch {
    await adminAudit({
      action: opts.action,
      actorId: opts.actor.id,
      actorEmail: opts.actor.email,
      target: opts.target,
      ok: false,
      error: "reason_required",
      correlationId,
    });
    return {
      ok: false,
      error: "A reason is required for this action.",
      correlationId,
      reconciliationRequired: false,
      attempted: false,
      succeeded: null,
      failure: "audit",
    };
  }

  // STEP 1 — the intention, durably, BEFORE anything external happens.
  const attempt = await adminAudit({
    action: opts.action,
    actorId: opts.actor.id,
    actorEmail: opts.actor.email,
    target: opts.target,
    reason,
    ok: true,
    correlationId,
    eventType: "attempt",
  });

  // STEP 2 — refuse to proceed if the intention could not be recorded.
  if (!attempt.persisted) {
    return {
      ok: false,
      error: "Could not record this action for audit, so it was not performed.",
      correlationId,
      reconciliationRequired: false,
      attempted: false,
      succeeded: null,
      failure: "audit",
    };
  }

  // STEP 3 — the external side-effect.
  let result: T;
  try {
    result = await opts.perform();
  } catch (e) {
    const failureOutcome = await adminAudit({
      action: opts.action,
      actorId: opts.actor.id,
      actorEmail: opts.actor.email,
      target: opts.target,
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "external_operation_failed",
      correlationId,
      eventType: "failure",
    });
    // The external effect may be ambiguous when its client throws. Preserve the
    // attempt row and create the same durable reconciliation signal used for a
    // missing success outcome; never describe this as a fully recorded failure.
    if (!failureOutcome.persisted) {
      await adminAudit({
        action: opts.action,
        actorId: opts.actor.id,
        actorEmail: opts.actor.email,
        target: opts.target,
        ok: false,
        error: "outcome_not_recorded",
        correlationId,
        eventType: "reconciliation_required",
      });
      return {
        ok: false,
        error:
          "This action may have been performed, but its failure outcome could not be recorded. It has been flagged for reconciliation.",
        correlationId,
        reconciliationRequired: true,
        attempted: true,
        succeeded: null,
        failure: "audit",
        diagnostic: diagnosticFromError(e),
      };
    }
    return {
      ok: false,
      error: "Could not complete this action.",
      correlationId,
      reconciliationRequired: false,
      attempted: true,
      succeeded: false,
      failure: "external",
      diagnostic: diagnosticFromError(e),
    };
  }

  // STEP 4 — a SEPARATE outcome record. The attempt row is never touched.
  const outcome = await adminAudit({
    action: opts.action,
    actorId: opts.actor.id,
    actorEmail: opts.actor.email,
    target: opts.target,
    reason,
    ok: true,
    correlationId,
    eventType: "success",
  });

  // STEP 6 — the external effect HAPPENED but we could not record that it did.
  // Say so loudly rather than reporting a clean success.
  if (!outcome.persisted) {
    await adminAudit({
      action: opts.action,
      actorId: opts.actor.id,
      actorEmail: opts.actor.email,
      target: opts.target,
      ok: false,
      error: "outcome_not_recorded",
      correlationId,
      eventType: "reconciliation_required",
    });
    return {
      ok: false,
      error:
        "This action was performed, but its outcome could not be recorded. It has been flagged for reconciliation.",
      correlationId,
      reconciliationRequired: true,
      attempted: true,
      succeeded: true,
      failure: "audit",
    };
  }

  return { ok: true, data: result, correlationId, attempted: true, succeeded: true };
}
