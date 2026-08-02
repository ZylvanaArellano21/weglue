"use server";

// ============================================================================
// Admin Dashboard — Day 10C content lifecycle write actions  (SERVER-ONLY)
// posts, post comments, events: remove / restore / request purge / retry purge
// ============================================================================
//
// WHY THIS IS A SEPARATE MODULE FROM contentActions.ts.
// `contentActions.ts` is the Day-3 SAFE-operations module, and a test asserts
// its export list exactly, precisely so a destructive operation can never be
// slipped in beside the safe ones. Lifecycle control is a different, stronger
// class of action, so it gets its own module with its own, stronger guard.
//
// THE GUARD, IN ORDER, FOR EVERY EXPORT BELOW (`requireRecentMfaWrite`):
//   1. ADMIN_PORTAL_ENABLED               (portal kill switch)
//   2. authenticated user                 (validated JWT — never browser-supplied)
//   3. immutable founder id allowlist     (email alone never grants)
//   4. absolute session maximum age
//   5. aal2                               (MFA satisfied this session)
//   6. ADMIN_WRITES_ENABLED               (global write kill switch)
//   7. recent-MFA freshness window        (step-up)
// then, in this file:
//   8. entity id is a real UUID
//   9. reason is 3–500 characters of ACTUAL text (whitespace-only rejected)
//  10. for purge only: the operator typed the exact word PURGE
// and finally, in the database (migration 061), independently:
//  11. the transition is legal from the CURRENT committed state, serialized by
//      an entity-scoped advisory lock, with the mutation and its audit row in
//      ONE transaction (the migration-056 architecture).
//
// NOTHING HERE IS A GENERIC ENDPOINT. There is no `mutate(table, id, patch)`.
// Each export names one entity type and one transition, and maps to exactly one
// narrow `admin_tx_*` function. `entity_type` is a closed three-value
// vocabulary in the database; nothing a browser sends can widen it.
//
// WHAT NEVER APPEARS IN A RESULT: the internal reason, the administrator's
// identity, the report status, or the content payload. Failures are returned as
// the real state the database observed, in plain founder-facing words — never a
// SQLSTATE, never a function name, and never a success.
// ============================================================================

import type { User } from "@supabase/supabase-js";
import { requireRecentMfaWrite } from "./secureAdmin";
import { adminAudit, newCorrelationId } from "./audit";
import { runAtomicMutation, type ActionResult } from "./atomicMutation";
import type { AuditAction } from "./auditSanitize";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The exact word an operator must type to authorize an irreversible purge.
 * NOT exported: a "use server" module may only export async functions, and this
 * value is a UI contract rather than a server capability. The client component
 * passes the literal and this file re-checks it — the check that matters is the
 * one on this side, because the client's can be bypassed.
 */
const PURGE_CONFIRMATION = "PURGE";

const REASON_MIN = 3;
const REASON_MAX = 500;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * The same 3–500 rule the database enforces (061 `private.content_reason_ok`
 * and the 055 audit CHECK). Validated HERE first so the operator gets a
 * sentence instead of a rejected transaction — but the database check is what
 * makes it true, because this one can be bypassed and that one cannot.
 */
function normalizeReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) return null;
  return trimmed;
}

async function reject(
  action: AuditAction,
  actor: User,
  error: string,
  target: Record<string, unknown>,
  correlationId: string
): Promise<{ ok: false; error: string }> {
  // A refused attempt is still an administrator action and is recorded as one.
  await adminAudit({
    action,
    actorId: actor.id,
    actorEmail: actor.email,
    target,
    ok: false,
    error: "rejected_before_mutation",
    correlationId,
  });
  return { ok: false, error };
}

type Entity = "post" | "comment" | "event";
type Transition = "remove" | "restore" | "purgeRequested";

/** entity+transition → the ONE narrow database function that performs it. */
const RPC: Record<Entity, Record<Transition, string>> = {
  post: {
    remove: "admin_tx_post_remove",
    restore: "admin_tx_post_restore",
    purgeRequested: "admin_tx_post_request_purge",
  },
  comment: {
    remove: "admin_tx_comment_remove",
    restore: "admin_tx_comment_restore",
    purgeRequested: "admin_tx_comment_request_purge",
  },
  event: {
    remove: "admin_tx_event_remove",
    restore: "admin_tx_event_restore",
    purgeRequested: "admin_tx_event_request_purge",
  },
};

const TARGET_ID_KEY: Record<Entity, string> = {
  post: "postId",
  comment: "commentId",
  event: "eventId",
};

/**
 * Shared body. Kept private so the guard order, the reason rule and the purge
 * confirmation are evaluated in exactly ONE place and cannot drift between nine
 * hand-written copies.
 */
async function runTransition(opts: {
  entity: Entity;
  transition: Transition;
  entityId: string;
  reason: string;
  /** Required for `purgeRequested`; ignored otherwise. */
  confirmation?: string;
}): Promise<ActionResult> {
  const actor = await requireRecentMfaWrite();
  const correlationId = newCorrelationId();
  const action = `${opts.entity}.${opts.transition}` as AuditAction;
  const target = {
    [TARGET_ID_KEY[opts.entity]]: opts.entityId,
    entityType: opts.entity,
    entityId: opts.entityId,
  };

  if (!isUuid(opts.entityId)) {
    return reject(action, actor, "Invalid content id.", target, correlationId);
  }

  const reason = normalizeReason(opts.reason);
  if (reason === null) {
    return reject(
      action,
      actor,
      `The reason must be ${REASON_MIN}–${REASON_MAX} characters of actual text.`,
      target,
      correlationId
    );
  }

  // Irreversible work needs a deliberate, typed act — not a click. Checked
  // case-sensitively and exactly: "purge" and "Purge" do not authorize it.
  if (opts.transition === "purgeRequested" && opts.confirmation !== PURGE_CONFIRMATION) {
    return reject(
      action,
      actor,
      `Type ${PURGE_CONFIRMATION} to confirm this permanent, irreversible purge.`,
      target,
      correlationId
    );
  }

  return runAtomicMutation({
    action,
    actor,
    reason,
    rpc: RPC[opts.entity][opts.transition],
    args: { p_entity_id: opts.entityId },
    target,
    correlationId,
  });
}

// ── Posts ───────────────────────────────────────────────────────────────────

/** Hide a post from every student surface. Reversible. */
export async function removePost(postId: string, reason: string): Promise<ActionResult> {
  return runTransition({ entity: "post", transition: "remove", entityId: postId, reason });
}

/** Return a removed post, with its original text, timestamps and engagement. */
export async function restorePost(postId: string, reason: string): Promise<ActionResult> {
  return runTransition({ entity: "post", transition: "restore", entityId: postId, reason });
}

/**
 * Begin the IRREVERSIBLE permanent purge of a post. Requires the operator to
 * type PURGE. The post must already be removed — there is no direct
 * active → purged path anywhere in this system.
 */
export async function requestPostPurge(
  postId: string,
  reason: string,
  confirmation: string
): Promise<ActionResult> {
  return runTransition({
    entity: "post",
    transition: "purgeRequested",
    entityId: postId,
    reason,
    confirmation,
  });
}

// ── Comments ────────────────────────────────────────────────────────────────

/** Hide a comment from every student surface. Reversible. */
export async function removeComment(commentId: string, reason: string): Promise<ActionResult> {
  return runTransition({ entity: "comment", transition: "remove", entityId: commentId, reason });
}

/**
 * Return a removed comment to its exact original position. Fails with a real
 * reason when the parent post is itself unavailable — a comment is never
 * restored into a thread a student cannot see.
 */
export async function restoreComment(commentId: string, reason: string): Promise<ActionResult> {
  return runTransition({ entity: "comment", transition: "restore", entityId: commentId, reason });
}

/** Begin the IRREVERSIBLE permanent purge of a comment. Requires PURGE. */
export async function requestCommentPurge(
  commentId: string,
  reason: string,
  confirmation: string
): Promise<ActionResult> {
  return runTransition({
    entity: "comment",
    transition: "purgeRequested",
    entityId: commentId,
    reason,
    confirmation,
  });
}

// ── Events ──────────────────────────────────────────────────────────────────

/**
 * Hide an event from every student surface. RSVPs and saves are PRESERVED, and
 * no cancellation notice is sent — the database suppresses reminders for a
 * removed event rather than announcing its removal to attendees.
 */
export async function removeEvent(eventId: string, reason: string): Promise<ActionResult> {
  return runTransition({ entity: "event", transition: "remove", entityId: eventId, reason });
}

/** Return a removed event, with its RSVPs and saves intact. */
export async function restoreEvent(eventId: string, reason: string): Promise<ActionResult> {
  return runTransition({ entity: "event", transition: "restore", entityId: eventId, reason });
}

/** Begin the IRREVERSIBLE permanent purge of an event. Requires PURGE. */
export async function requestEventPurge(
  eventId: string,
  reason: string,
  confirmation: string
): Promise<ActionResult> {
  return runTransition({
    entity: "event",
    transition: "purgeRequested",
    entityId: eventId,
    reason,
    confirmation,
  });
}

// ── Failed purges ───────────────────────────────────────────────────────────

/**
 * Re-queue a purge that FAILED. Only legal from `purge_failed`; a purge that is
 * still pending, already complete, or was never started is refused with the
 * real reason. This does not require the typed confirmation: the irreversible
 * decision was already authorized when the purge was requested, and this only
 * resumes it.
 */
export async function retryContentPurge(
  entityType: Entity,
  entityId: string,
  reason: string
): Promise<ActionResult> {
  const actor = await requireRecentMfaWrite();
  const correlationId = newCorrelationId();
  const action: AuditAction = "content.purgeRetry";
  const target = { entityType, entityId };

  if (entityType !== "post" && entityType !== "comment" && entityType !== "event") {
    return reject(action, actor, "Invalid content type.", target, correlationId);
  }
  if (!isUuid(entityId)) {
    return reject(action, actor, "Invalid content id.", target, correlationId);
  }
  const clean = normalizeReason(reason);
  if (clean === null) {
    return reject(
      action,
      actor,
      `The reason must be ${REASON_MIN}–${REASON_MAX} characters of actual text.`,
      target,
      correlationId
    );
  }

  return runAtomicMutation({
    action,
    actor,
    reason: clean,
    rpc: "admin_tx_content_retry_purge",
    args: { p_entity_type: entityType, p_entity_id: entityId },
    target,
    correlationId,
  });
}
