"use server";

// Day 10C content lifecycle mutations. These actions deliberately expose only
// the six fixed admin_tx_* RPCs from migration 063. They never update a table
// from the browser and they do not accept an administrator identity, state, or
// audit payload from the caller.

if (typeof window !== "undefined") {
  throw new Error("contentLifecycleActions is server-only.");
}

import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import { adminAudit } from "./audit";
import { runAtomicMutation, newCorrelationId } from "./atomicMutation";
import type { AuditAction } from "./auditSanitize";
import { requireRecentMfaWrite, SecureAdminError } from "./secureAdmin";
import type { ActionResult } from "./actions";

export type LifecycleEntityType = "post" | "comment" | "event";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RPC: Record<LifecycleEntityType, { remove: string; restore: string; idArg: string }> = {
  post: { remove: "admin_tx_post_remove", restore: "admin_tx_post_restore", idArg: "p_post_id" },
  comment: { remove: "admin_tx_comment_remove", restore: "admin_tx_comment_restore", idArg: "p_comment_id" },
  event: { remove: "admin_tx_event_remove", restore: "admin_tx_event_restore", idArg: "p_event_id" },
};

function target(entityType: LifecycleEntityType, entityId: string) {
  const idKey = entityType === "post" ? "postId" : entityType === "comment" ? "commentId" : "eventId";
  return { [idKey]: entityId, entityType, entityId };
}

async function validationFailure(
  action: AuditAction,
  actor: User,
  entityType: LifecycleEntityType,
  entityId: string,
  error: string,
  correlationId: string
): Promise<ActionResult> {
  const audit = await adminAudit({
    action,
    actorId: actor.id,
    actorEmail: actor.email,
    target: target(entityType, entityId),
    ok: false,
    error,
    correlationId,
  });
  return { ok: false, error: audit.persisted ? error : "Could not record this request. No change was made." };
}

async function mutate(
  operation: "remove" | "restore",
  entityType: LifecycleEntityType,
  entityId: string,
  reason: string
): Promise<ActionResult> {
  const correlationId = newCorrelationId();
  const action = `${entityType}.${operation}` as AuditAction;

  // This must be the first privileged operation. It includes the private
  // portal, immutable founder allowlist, session age, AAL2, write switch and
  // recent-MFA checks. Authorization failures remain operational-only by
  // design; otherwise any caller could flood the founder audit history.
  let actor: User;
  try {
    actor = await requireRecentMfaWrite();
  } catch (error) {
    if (error instanceof SecureAdminError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not verify administrator authorization." };
  }

  if (!UUID_RE.test(entityId)) {
    return validationFailure(action, actor, entityType, entityId, "Invalid content id.", correlationId);
  }

  const result = await runAtomicMutation({
    action,
    actor,
    reason,
    rpc: RPC[entityType][operation],
    args: { [RPC[entityType].idArg]: entityId },
    target: target(entityType, entityId),
    correlationId,
  });

  if (result.ok) {
    // The pages are dynamic, but explicit revalidation makes an immediate
    // refresh correct even if their rendering strategy changes later.
    revalidatePath("/admin/content-lifecycle");
    revalidatePath(`/admin/content-lifecycle/${entityType}/${entityId}`);
    revalidatePath(`/admin/${entityType}s/${entityId}`);
    revalidatePath(`/admin/${entityType}s`);
  }

  return result;
}

export async function removePost(postId: string, reason: string): Promise<ActionResult> {
  return mutate("remove", "post", postId, reason);
}

export async function restorePost(postId: string, reason: string): Promise<ActionResult> {
  return mutate("restore", "post", postId, reason);
}

export async function removeComment(commentId: string, reason: string): Promise<ActionResult> {
  return mutate("remove", "comment", commentId, reason);
}

export async function restoreComment(commentId: string, reason: string): Promise<ActionResult> {
  return mutate("restore", "comment", commentId, reason);
}

export async function removeEvent(eventId: string, reason: string): Promise<ActionResult> {
  return mutate("remove", "event", eventId, reason);
}

export async function restoreEvent(eventId: string, reason: string): Promise<ActionResult> {
  return mutate("restore", "event", eventId, reason);
}
