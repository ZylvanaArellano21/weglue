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
//   • restoring/purging a deleted message — retained content is privacy-locked
//     (migration 051 not deployed); admin never resurrects or hard-deletes it.
//   • permanent purge of ANY entity — no approved canonical purge lifecycle; we
//     never perform a direct hard delete as a shortcut.
// ============================================================================

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import { adminAudit } from "./audit";
import type { ActionResult } from "./actions";
import type { User } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
function fail(action: string, actor: User, error: string, target: Record<string, unknown>): { ok: false; error: string } {
  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: false, error });
  return { ok: false, error };
}

/**
 * Restore (reactivate) a deactivated club: clubs.is_active = true. Canonical,
 * reversible, and read-back verified. Refuses if the club is already active.
 */
export async function reactivateClub(clubId: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "deletedContent.reactivateClub";
  const target = { clubId };
  if (!isUuid(clubId)) return fail(action, actor, "Invalid club id.", target);

  const admin = createAdminClient();
  const { data: before } = await admin.from("clubs").select("id, is_active").eq("id", clubId).maybeSingle();
  if (!before) return fail(action, actor, "Club not found.", target);
  if (before.is_active) return fail(action, actor, "Club is already active.", target);

  const { data: row, error } = await admin
    .from("clubs")
    .update({ is_active: true })
    .eq("id", clubId)
    .select("id, is_active")
    .maybeSingle();
  if (error || !row) return fail(action, actor, "Could not reactivate the club.", target);
  if (row.is_active !== true) return fail(action, actor, "Reactivation did not take effect.", target);

  adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: true, before, after: row });
  return { ok: true, data: row };
}
