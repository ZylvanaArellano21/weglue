"use server";

// ============================================================================
// Admin Dashboard — Day-5 Deleted Content actions  (SERVER-ONLY)
// ============================================================================
// The ONLY canonical, safe restore that exists in the current schema is
// reactivating a deactivated club (clubs.is_active = false → true). It:
//   • does not re-expose any private deleted data,
//   • is fully supported by existing product queries (discovery filters on
//     is_active), and
//   • is read-back verifiable.
//
// Same hardened contract as every other action module: requireSecureAdmin({write})
// → strict validation → fixed canonical column → read-back → audit → { ok }.
//
// EXPLICITLY NOT IMPLEMENTED (disabled in the UI with reasons):
//   • restoring a deleted conversation — no canonical restore-conversation op.
//   • restoring/purging a deleted message — Day 10F makes sender deletion
//     privacy-locked and automatically purges it; admin never resurrects or
//     directly hard-deletes it.
//   • permanent purge of ANY entity — no approved canonical purge lifecycle; we
//     never perform a direct hard delete as a shortcut.
// ============================================================================

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import { adminAudit } from "./audit";
import { runAtomicMutation } from "./atomicMutation";
import type { ActionResult } from "./actions";
import type { User } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
async function fail(action: string, actor: User, error: string, target: Record<string, unknown>): Promise<{ ok: false; error: string }> {
  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: false, error });
  return { ok: false, error };
}

/**
 * Restore (reactivate) a deactivated club: clubs.is_active = true. Canonical,
 * reversible, and read-back verified. Refuses if the club is already active.
 */
export async function reactivateClub(clubId: string, reason: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(clubId)) return fail("deletedContent.reactivateClub", actor, "Invalid club id.", { clubId });
  return runAtomicMutation({
    action: "deletedContent.reactivateClub",
    actor,
    reason,
    rpc: "admin_tx_club_reactivate",
    args: { p_club_id: clubId },
    target: { clubId },
  });
}
