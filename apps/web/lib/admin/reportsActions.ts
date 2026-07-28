"use server";

// ============================================================================
// Admin Dashboard — Day-5 moderation: report status transitions  (SERVER-ONLY)
// ============================================================================
// Same hardened contract as actions.ts / contentActions.ts / messagingActions.ts:
//   1. requireSecureAdmin({ write: true })   — portal + allowlist + aal2 + write switch
//   2. strict input + CURRENT-STATE transition validation
//   3. mutation on the FIXED canonical `reports.status` column (nothing else)
//   4. read the changed record back and confirm the new status took effect
//   5. structured audit (success AND failure) — no evidence in the audit target
//   6. { ok } result — never throws to the client
//
// The ONLY write is a status transition, validated against REPORT_TRANSITIONS
// from the report's live status. No report status outside the CHECK constraint
// is ever written; no invalid transition is allowed. Reporter-readable columns
// (content_snapshot / attachment_snapshot / details) are NEVER written here, so a
// moderation action can never leak evidence into a reporter-visible field.
//
// EXPLICITLY NOT IMPLEMENTED (surfaced as honest disabled affordances in the UI):
//   • moderation notes — the reports table has no notes/reviewer/updated_at
//     column; adding one requires a migration, which is deferred because the
//     separate migration 051 (deleted-message privacy) is unsequenced/undeployed.
//   • linking a report to a restriction/sanction — no canonical restriction
//     system exists (see /admin/restrictions); no sanction is ever auto-created.
// ============================================================================

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import { adminAudit } from "./audit";
import { canTransition, isReportStatus, type ReportStatus } from "./reportsData";
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
 * Transition a report to a new canonical status. Validates the transition
 * against the report's CURRENT status (REPORT_TRANSITIONS), writes only
 * reports.status, reads the row back, and audits. Returns { ok }.
 */
export async function setReportStatus(reportId: string, nextStatus: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  const action = "report.setStatus";
  const target = { reportId, nextStatus };
  if (!isUuid(reportId)) return fail(action, actor, "Invalid report id.", target);
  if (!isReportStatus(nextStatus)) return fail(action, actor, "Unsupported report status.", target);

  const admin = createAdminClient();
  // Read the current status ONLY — never the evidence columns.
  const { data: before } = await admin.from("reports").select("id, status, entity_type, entity_id").eq("id", reportId).maybeSingle();
  if (!before) return fail(action, actor, "Report not found.", target);

  const current = before.status as string;
  if (current === nextStatus) return fail(action, actor, `Report is already ${nextStatus}.`, target);
  if (!canTransition(current, nextStatus)) {
    return fail(action, actor, `Cannot move a ${current} report to ${nextStatus}.`, target);
  }

  const { data: row, error } = await admin
    .from("reports")
    .update({ status: nextStatus })
    .eq("id", reportId)
    .eq("status", current) // optimistic guard against a concurrent change
    .select("id, status")
    .maybeSingle();
  if (error || !row) return fail(action, actor, "Could not update the report.", target);
  if (row.status !== nextStatus) return fail(action, actor, "Status change did not take effect.", target);

  adminAudit({
    action,
    actorId: actor.id,
    actorEmail: actor.email,
    target: { reportId, entity_type: before.entity_type, entity_id: before.entity_id },
    ok: true,
    before: { status: current },
    after: { status: row.status as ReportStatus },
  });
  return { ok: true, data: { id: row.id, status: row.status } };
}
