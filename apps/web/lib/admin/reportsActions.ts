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
import { runAtomicMutation } from "./atomicMutation";
import { canTransition, isReportStatus, type ReportStatus } from "./reportsData";
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
 * Transition a report to a new canonical status. Validates the transition
 * against the report's CURRENT status (REPORT_TRANSITIONS), writes only
 * reports.status, reads the row back, and audits. Returns { ok }.
 */
export async function setReportStatus(reportId: string, nextStatus: string): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(reportId)) return fail("report.setStatus", actor, "Invalid report id.", { reportId, nextStatus });
  if (!isReportStatus(nextStatus)) {
    return fail("report.setStatus", actor, "Invalid report status.", { reportId, nextStatus });
  }
  return runAtomicMutation({
    action: "report.setStatus",
    actor,
    rpc: "admin_tx_report_set_status",
    args: { p_report_id: reportId, p_next_status: nextStatus },
    target: { reportId, nextStatus },
  });
}
