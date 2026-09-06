"use server";

// ============================================================================
// Admin Dashboard — interest catalog + club-interest matching write actions
// ============================================================================
//
// Same contract as actions.ts:
//   1. requireSecureAdmin({ write: true })   — portal + allowlist + aal2 + write switch
//   2. strict input validation
//   3. runAtomicMutation → a migration-125 admin_tx_* function (mutation + audit
//      row commit in ONE transaction, or neither)
//   4. structured { ok } result, never a throw to the client
//
// Interests are NEVER hard-deleted here — "remove" from the dashboard means
// deactivate (is_active = false, history preserved). A true purge is a separate
// destructive-data decision and has no action in this file.
// ============================================================================

import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import { requireSecureAdmin, SecureAdminError } from "./secureAdmin";
import { runAtomicMutation } from "./atomicMutation";
import { adminAudit } from "./audit";
import type { ActionResult } from "./atomicMutation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

async function authorize(): Promise<User | ActionResult> {
  try {
    return await requireSecureAdmin({ write: true });
  } catch (error) {
    if (error instanceof SecureAdminError) return { ok: false, error: error.message, failure: "validation" as const };
    return { ok: false, error: "Could not verify administrator authorization.", failure: "validation" as const };
  }
}

async function fail(action: string, actor: User, error: string, target: Record<string, unknown>): Promise<ActionResult> {
  await adminAudit({ action, actorId: actor.id, actorEmail: actor.email, target, ok: false, error });
  return { ok: false, error, failure: "validation" };
}

function revalidate(clubId?: string) {
  revalidatePath("/admin/interests");
  revalidatePath("/admin/clubs");
  if (clubId) revalidatePath(`/admin/clubs/${clubId}`);
}

// ── Catalog ─────────────────────────────────────────────────────────────────

export async function createInterest(label: string): Promise<ActionResult> {
  const actor = await authorize();
  if ("ok" in actor) return actor;
  if (typeof label !== "string" || label.trim().length < 2 || label.trim().length > 40) {
    return fail("interest.create", actor, "Interest name must be 2–40 characters.", { label });
  }
  const result = await runAtomicMutation({
    action: "interest.create",
    actor,
    rpc: "admin_tx_interest_create",
    args: { p_label: label.trim(), p_slug: null },
    target: { label: label.trim() },
  });
  if (result.ok) revalidate();
  return result;
}

export async function renameInterest(interestId: string, label: string): Promise<ActionResult> {
  const actor = await authorize();
  if ("ok" in actor) return actor;
  if (!isUuid(interestId)) return fail("interest.rename", actor, "Invalid interest id.", { interestId });
  if (typeof label !== "string" || label.trim().length < 2 || label.trim().length > 40) {
    return fail("interest.rename", actor, "Interest name must be 2–40 characters.", { interestId, label });
  }
  const result = await runAtomicMutation({
    action: "interest.rename",
    actor,
    rpc: "admin_tx_interest_rename",
    args: { p_interest_id: interestId, p_label: label.trim() },
    target: { interestId, label: label.trim() },
  });
  if (result.ok) revalidate();
  return result;
}

export async function setInterestActive(
  interestId: string,
  isActive: boolean,
  reason: string,
): Promise<ActionResult> {
  const actor = await authorize();
  if ("ok" in actor) return actor;
  const action = isActive ? "interest.reactivate" : "interest.deactivate";
  if (!isUuid(interestId)) return fail(action, actor, "Invalid interest id.", { interestId });
  const result = await runAtomicMutation({
    action,
    actor,
    reason,
    rpc: "admin_tx_interest_set_active",
    args: { p_interest_id: interestId, p_active: !!isActive },
    target: { interestId },
  });
  if (result.ok) revalidate();
  return result;
}

// ── Club ↔ interest assignments ─────────────────────────────────────────────

function validTier(v: unknown): v is "primary" | "secondary" {
  return v === "primary" || v === "secondary";
}

export async function assignClubInterest(
  clubId: string,
  interestId: string,
  tier: "primary" | "secondary",
): Promise<ActionResult> {
  const actor = await authorize();
  if ("ok" in actor) return actor;
  if (!isUuid(clubId) || !isUuid(interestId)) return fail("club.interestAssign", actor, "Invalid id.", { clubId, interestId });
  if (!validTier(tier)) return fail("club.interestAssign", actor, "Choose Primary or Secondary.", { clubId, interestId, tier });
  const result = await runAtomicMutation({
    action: "club.interestAssign",
    actor,
    rpc: "admin_tx_assign_club_interest",
    args: { p_club_id: clubId, p_interest_id: interestId, p_tier: tier },
    target: { clubId, interestId, tier },
  });
  if (result.ok) revalidate(clubId);
  return result;
}

export async function setClubInterestTier(
  clubId: string,
  interestId: string,
  tier: "primary" | "secondary",
): Promise<ActionResult> {
  const actor = await authorize();
  if ("ok" in actor) return actor;
  if (!isUuid(clubId) || !isUuid(interestId)) return fail("club.interestRetier", actor, "Invalid id.", { clubId, interestId });
  if (!validTier(tier)) return fail("club.interestRetier", actor, "Choose Primary or Secondary.", { clubId, interestId, tier });
  const result = await runAtomicMutation({
    action: "club.interestRetier",
    actor,
    rpc: "admin_tx_set_club_interest_tier",
    args: { p_club_id: clubId, p_interest_id: interestId, p_tier: tier },
    target: { clubId, interestId, tier },
  });
  if (result.ok) revalidate(clubId);
  return result;
}

export async function removeClubInterest(
  clubId: string,
  interestId: string,
  reason: string,
): Promise<ActionResult> {
  const actor = await authorize();
  if ("ok" in actor) return actor;
  if (!isUuid(clubId) || !isUuid(interestId)) return fail("club.interestRemove", actor, "Invalid id.", { clubId, interestId });
  const result = await runAtomicMutation({
    action: "club.interestRemove",
    actor,
    reason,
    rpc: "admin_tx_remove_club_interest",
    args: { p_club_id: clubId, p_interest_id: interestId },
    target: { clubId, interestId },
  });
  if (result.ok) revalidate(clubId);
  return result;
}
