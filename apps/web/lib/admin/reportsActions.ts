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
// Day 10D adds the separate append-only decision history and composes the
// existing Day 10B/10C enforcement RPCs. The canonical reports row remains a
// workflow-status source of truth; notes and outcomes never overwrite it.
// ============================================================================

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import { adminAudit } from "./audit";
import { runAtomicMutation } from "./atomicMutation";
import { isReportStatus } from "./reportsData";
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
export async function setReportStatus(reportId: string, nextStatus: string, internalReason = "Report review started."): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(reportId)) return fail("report.setStatus", actor, "Invalid report id.", { reportId, nextStatus });
  if (nextStatus !== "reviewing" || !isReportStatus(nextStatus)) {
    return fail("report.setStatus", actor, "Invalid report status.", { reportId, nextStatus });
  }
  return runAtomicMutation({
    action: "report.review",
    actor,
    reason: internalReason,
    rpc: "admin_tx_report_set_status",
    args: { p_report_id: reportId, p_next_status: nextStatus },
    target: { reportId, nextStatus },
  });
}

const OUTCOMES = new Set(["no_violation", "duplicate_or_invalid", "content_violation", "account_violation", "other"]);
const ENFORCEMENTS = new Set(["none", "post_remove", "event_remove", "suspend", "block", "schedule_deletion"]);

export async function resolveReport(input: {
  reportId: string;
  status: "resolved" | "dismissed";
  resolutionOutcome: string;
  internalReason: string;
  internalDecisionNote: string;
  publicCategory?: string;
  publicExplanation?: string;
  enforcementAction: string;
  suspendedUntil?: string | null;
}): Promise<ActionResult> {
  const actor = await requireSecureAdmin({ write: true });
  if (!isUuid(input.reportId)) return fail("report.resolve", actor, "Invalid report id.", { reportId: input.reportId });
  if (!OUTCOMES.has(input.resolutionOutcome) || !ENFORCEMENTS.has(input.enforcementAction)) {
    return fail("report.resolve", actor, "Choose a valid resolution and enforcement action.", { reportId: input.reportId });
  }
  if (input.internalReason.trim().length < 3 || input.internalReason.trim().length > 500 || input.internalDecisionNote.trim().length < 3 || input.internalDecisionNote.trim().length > 2000) {
    return fail("report.resolve", actor, "An internal reason and decision note are required.", { reportId: input.reportId });
  }
  if (input.enforcementAction !== "none" && (!input.publicCategory?.trim() || !input.publicExplanation || input.publicExplanation.trim().length < 10 || input.publicExplanation.trim().length > 500)) {
    return fail("report.resolve", actor, "A public category and specific explanation are required for enforcement.", { reportId: input.reportId });
  }
  const action = input.status === "dismissed" ? "report.dismiss" : "report.resolve";
  return runAtomicMutation({
    action,
    actor,
    reason: input.internalReason,
    rpc: "admin_tx_report_decide",
    args: {
      p_report_id: input.reportId,
      p_new_status: input.status,
      p_resolution_outcome: input.resolutionOutcome,
      p_internal_decision_note: input.internalDecisionNote,
      p_public_category: input.enforcementAction === "none" ? null : input.publicCategory?.trim(),
      p_public_explanation: input.enforcementAction === "none" ? null : input.publicExplanation?.trim(),
      p_enforcement_action: input.enforcementAction,
      p_suspended_until: input.suspendedUntil || null,
    },
    target: { reportId: input.reportId, resolutionOutcome: input.resolutionOutcome, enforcementAction: input.enforcementAction },
  });
}
