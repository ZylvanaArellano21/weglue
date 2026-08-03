// ============================================================================
// Admin Dashboard — atomic mutation runner  (SERVER-ONLY)
// ============================================================================
//
// Every DATABASE-ONLY administrator mutation goes through here. It calls one of
// the migration-056 `admin_tx_*` functions, each of which performs the canonical
// mutation AND writes its audit row in a SINGLE database transaction.
//
// The ordering below is the whole point:
//
//   1. requireSecureAdmin({ write: true })  — done by the caller, before this.
//   2. assertAuditReason()  — BEFORE the RPC. A destructive action with no
//      reason never reaches the database at all, so there is nothing to roll
//      back and no chance of a "mutated but unaudited" window. The database
//      enforces the same rule independently (055 trigger), which is what makes
//      the guarantee real rather than a client-side courtesy.
//   3. The RPC. Inside one transaction: mutate + audit, or neither.
//
// Outcomes:
//   • status 'ok'         → mutation and audit BOTH committed.
//   • status other        → a validated business rejection. NO mutation
//                           happened, and the RPC already committed a durable
//                           FAILURE audit row. We only translate the code.
//   • transport/SQL error → the whole transaction rolled back, so nothing
//                           mutated and nothing was audited. We then write a
//                           durable failure record from here (a separate
//                           transaction, which is safe precisely because there
//                           is no mutation left to be inconsistent with).
//
// Callers never need to write an audit call themselves for these operations.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/atomicMutation.ts is server-only and must not be imported in the browser.");
}

import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { adminAudit, newCorrelationId } from "./audit";
import { assertAuditReason, type AuditAction } from "./auditSanitize";

export interface AtomicFailureDiagnostic {
  code: string | null;
  sqlState: string | null;
  message: string | null;
}

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      failure: "validation" | "business" | "database" | "audit";
      rpcStatus?: string;
      diagnostic?: AtomicFailureDiagnostic;
    };

function diagnosticFromError(error: unknown): AtomicFailureDiagnostic {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = typeof candidate?.code === "string" ? candidate.code : null;
  return {
    code,
    sqlState: code && /^[0-9A-Z]{5}$/i.test(code) ? code : null,
    message: typeof candidate?.message === "string" ? candidate.message : null,
  };
}

/**
 * Founder-facing wording for every status the 056 functions can return.
 * Deliberately plain: no SQLSTATE, no function name, no internal detail.
 */
const STATUS_MESSAGE: Record<string, string> = {
  // membership / officers (including the migration-054 codes)
  not_member: "This user is not a member of this club.",
  already_member: "This user is already a member of this club.",
  not_officer: "This member is not an officer.",
  last_officer:
    "This club would be left without any officer. Promote another member to officer first, or transfer the role.",
  invalid_role: "Invalid role.",
  invalid_role_title: "Officer title must be 2–40 characters.",
  club_not_found: "Club not found.",
  user_not_found: "User not found.",
  different_university: "User belongs to a different university than this club.",
  same_user: "Choose a different member.",
  from_not_officer: "That member is not currently an officer of this club.",
  // gluemates
  not_gluemates: "These users are not gluemates.",
  // universities
  invalid_name: "Name must be 2–100 characters.",
  invalid_slug: "Slug must be lowercase words separated by hyphens.",
  duplicate: "A university with that name or slug already exists.",
  // content
  not_found: "That record no longer exists.",
  not_tagged: "This post is not tagged to that club.",
  caption_too_long: "Caption is too long.",
  invalid_content: "Comment text must be 1–2000 characters.",
  invalid_title: "Title must be 2–120 characters.",
  invalid_visibility: "Invalid visibility.",
  // rsvps
  invalid_status: "Invalid status.",
  event_not_found: "Event not found.",
  // channels
  duplicate_name: "A channel with that name already exists in this conversation.",
  conversation_not_found: "Conversation not found.",
  main_channel: "The Main chat cannot be changed or removed.",
  channel_not_empty:
    "This channel still holds messages. Removing a non-empty channel is disabled until the approved deleted-message lifecycle is deployed.",
  invalid_permission: "Invalid posting permission.",
  // reports
  no_change: "The report is already in that state.",
  terminal_decision_required: "This report already has a terminal decision or requires the resolution panel.",
  terminal_decision: "This report already has a terminal decision and cannot be silently reopened.",
  invalid_outcome: "Choose a valid report outcome.",
  invalid_enforcement: "Choose a valid enforcement action.",
  enforcement_unavailable: "Automated enforcement is not available for this report target.",
  enforcement_failed: "The enforcement action was not applied, so the report remains unresolved.",
  public_explanation_required: "A public category and specific explanation are required for enforcement.",
  // Shared by report status changes (056) and restriction transitions (058).
  invalid_transition:
    "That change is not allowed from the record's current state. A blocked account must be unblocked first, as a separate action.",
  // clubs
  already_active: "This club is already active.",
  // account restrictions (migration 058)
  already_suspended: "This account is already suspended.",
  already_blocked: "This account is already blocked from We Glue.",
  not_restricted: "This account is not currently restricted.",
  platform_admin_target: "Administrator accounts cannot be restricted.",
  self_target: "You cannot restrict your own account.",
  invalid_expiry: "The suspension expiration must be a valid date in the future.",
  invalid_target: "Invalid target account.",
  // Day 10C content lifecycle (migration 063).
  already_removed: "This content is already removed from student surfaces.",
  not_removed: "This content is not currently removed.",
  invalid_reason: "Internal reasons must be between 3 and 500 characters.",
  creator_deleted: "This content was permanently deleted by its creator and cannot be restored.",
  parent_missing: "The parent post no longer exists, so this comment cannot be restored.",
  parent_unavailable: "Restore the parent post before restoring this comment.",
  purge_in_progress: "This content is pending permanent purge and can no longer be restored.",
  already_purged: "This content was permanently purged and cannot be changed.",
};

function messageFor(status: string): string {
  return STATUS_MESSAGE[status] ?? "Could not complete this change.";
}

export interface AtomicMutationOptions {
  /** Controlled-vocabulary action, used for the reason guard and audit fallback. */
  action: AuditAction;
  /** Server-validated administrator. NEVER anything supplied by the browser. */
  actor: User;
  /** Required for destructive/sensitive actions; validated before the RPC. */
  reason?: string | null;
  /** The migration-056 function name. */
  rpc: string;
  /** Operation-specific parameters (everything after the four standard ones). */
  args: Record<string, unknown>;
  /** Call-site ids, used only if we must write a fallback failure record. */
  target: Record<string, unknown>;
  /** Supply to group multiple steps of one logical operation. */
  correlationId?: string;
}

export async function runAtomicMutation<T = unknown>(
  opts: AtomicMutationOptions
): Promise<ActionResult<T>> {
  const correlationId = opts.correlationId ?? newCorrelationId();
  const reason = opts.reason ?? null;

  // BEFORE the mutation, never after. A missing reason must not be discovered
  // at audit time — at that point the change would already have happened (and
  // the 055 trigger would roll it back, which works but wastes a round trip and
  // gives the operator a confusing database error instead of a clear one).
  try {
    assertAuditReason(opts.action, reason);
  } catch {
    const audit = await adminAudit({
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
      failure: audit.persisted ? "validation" : "audit",
    };
  }

  let data: unknown;
  let error: unknown;
  try {
    const admin = createAdminClient();
    const response = await admin.rpc(opts.rpc, {
      p_actor_id: opts.actor.id,
      p_actor_email: opts.actor.email ?? null,
      p_reason: reason,
      p_correlation_id: correlationId,
      ...opts.args,
    });
    data = response.data;
    error = response.error;
  } catch (caught) {
    error = caught;
  }

  if (error) {
    // The transaction rolled back: nothing mutated, nothing audited. Recording
    // the failure here is safe — there is no committed change for this record
    // to contradict.
    const audit = await adminAudit({
      action: opts.action,
      actorId: opts.actor.id,
      actorEmail: opts.actor.email,
      target: opts.target,
      ok: false,
      error: "transaction_failed",
      correlationId,
    });
    return {
      ok: false,
      error: "Could not complete this change.",
      failure: audit.persisted ? "database" : "audit",
      diagnostic: diagnosticFromError(error),
    };
  }

  const result = (Array.isArray(data) ? data[0] : data ?? {}) as { status?: string; after?: unknown };
  if (result.status !== "ok") {
    // The RPC already committed a durable failure record inside its own
    // transaction — do NOT write a second one here.
    return {
      ok: false,
      error: messageFor(result.status ?? "unknown"),
      failure: "business",
      rpcStatus: result.status ?? "unknown",
    };
  }

  return { ok: true, data: (result.after ?? result) as T };
}

export { newCorrelationId };
