"use server";

if (typeof window !== "undefined") throw new Error("deletionActions is server-only.");

import { revalidatePath } from "next/cache";
import { createAdminClient } from "../supabase/admin";
import { requireRecentMfaWrite, SecureAdminError } from "./secureAdmin";
import { newCorrelationId } from "./atomicMutation";
import { MIN_INTERNAL_REASON, MIN_PUBLIC_REASON, MAX_REASON, type DeletionBasis, type ViolationCategory } from "./restrictionTypes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories = new Set<ViolationCategory>(["targeted_harassment","threats_or_violence","hate_speech","sexual_harassment","impersonation","spam_or_scams","privacy_violation","inappropriate_content","repeated_guidelines_violations","fraudulent_or_deceptive_behavior","safety_concern","other"]);
const bases = new Set<DeletionBasis>(["student_reports","multiple_complaints","administrator_observation","safety_concern","legal_or_institutional_request","repeated_violations","fraud_or_impersonation_concern","other"]);

export interface DeletionActionInput {
  userId: string;
  violationCategory: ViolationCategory;
  publicReason: string;
  internalReason: string;
  basis: DeletionBasis;
  evidenceReferences?: string;
  noEvidenceConfirmed: boolean;
  confirmation: string;
  immediate?: boolean;
  skipAppealAcknowledged?: boolean;
}
export interface DeletionActionResult { ok: boolean; message: string; correlationId: string; status: string; }

function failed(correlationId: string, message: string, status = "notApplied"): DeletionActionResult { return { ok: false, message, correlationId, status }; }
function clean(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

async function submit(input: DeletionActionInput): Promise<DeletionActionResult> {
  const correlationId = newCorrelationId();
  try {
    const actor = await requireRecentMfaWrite();
    const publicReason = clean(input.publicReason); const internalReason = clean(input.internalReason);
    const evidence = clean(input.evidenceReferences);
    const requiredConfirmation = input.immediate ? "DELETE NOW" : "DELETE";
    if (!UUID_RE.test(input.userId)) return failed(correlationId, "This account ID is invalid.");
    if (input.confirmation.trim().toUpperCase() !== requiredConfirmation) return failed(correlationId, `Type ${requiredConfirmation} to confirm.`);
    if (input.immediate && input.skipAppealAcknowledged !== true) return failed(correlationId, "Acknowledge that the seven-day appeal period will be skipped.");
    if (!categories.has(input.violationCategory) || publicReason.length < MIN_PUBLIC_REASON || publicReason.length > MAX_REASON || internalReason.length < MIN_INTERNAL_REASON || internalReason.length > MAX_REASON || !bases.has(input.basis)) return failed(correlationId, "Complete the required category, student explanation, internal note, and basis for action.");
    if (!evidence && !input.noEvidenceConfirmed) return failed(correlationId, "Confirm that no supporting evidence is attached, or add an optional reference.");
    const admin = createAdminClient();
    const rpc = input.immediate ? "admin_tx_delete_account_immediately" : "admin_tx_schedule_account_deletion";
    const { data, error } = await admin.rpc(rpc, {
      p_actor_id: actor.id, p_actor_email: actor.email ?? null, p_internal_reason: internalReason,
      p_correlation_id: correlationId, p_user_id: input.userId, p_violation_category: input.violationCategory,
      p_public_reason: publicReason, p_basis: input.basis, p_evidence_references: evidence || null,
      p_no_evidence_confirmed: input.noEvidenceConfirmed,
    });
    if (error) return failed(correlationId, "The action was not applied.", "databaseFailure");
    const row = (Array.isArray(data) ? data[0] : data) as { status?: string } | null;
    if (row?.status !== "ok") return failed(correlationId, "The action was not applied.", row?.status ?? "notApplied");
    revalidatePath(`/admin/users/${input.userId}`); revalidatePath("/admin/restrictions");
    return { ok: true, correlationId, status: "applied", message: input.immediate ? "Queued — We Glue access is blocked and the durable worker will process the emergency deletion." : "Scheduled — We Glue access is blocked and permanent deletion is set for seven days from now." };
  } catch (error) {
    const reason = error instanceof SecureAdminError ? error.reason : null;
    return failed(correlationId, reason === "writes_disabled" ? "Admin writes are currently disabled." : reason === "stepup_required" || reason === "mfa_required" ? "Your recent MFA verification expired. Verify again and retry." : "The action was not applied.", reason ?? "notApplied");
  }
}

export async function scheduleAccountDeletion(input: DeletionActionInput): Promise<DeletionActionResult> { return submit({ ...input, immediate: false }); }
export async function deleteAccountImmediately(input: DeletionActionInput): Promise<DeletionActionResult> { return submit({ ...input, immediate: true }); }

export async function cancelScheduledDeletion(userId: string, internalReason: string, confirmation: string): Promise<DeletionActionResult> {
  const correlationId = newCorrelationId();
  try {
    const actor = await requireRecentMfaWrite();
    if (!UUID_RE.test(userId) || clean(internalReason).length < MIN_INTERNAL_REASON || clean(internalReason).length > MAX_REASON || confirmation.trim().toUpperCase() !== "CANCEL DELETION") return failed(correlationId, "Provide an internal cancellation reason and type CANCEL DELETION to confirm.");
    const { data, error } = await createAdminClient().rpc("admin_tx_cancel_account_deletion", { p_actor_id: actor.id, p_actor_email: actor.email ?? null, p_internal_reason: clean(internalReason), p_correlation_id: correlationId, p_user_id: userId });
    if (error || ((Array.isArray(data) ? data[0] : data) as { status?: string } | null)?.status !== "ok") return failed(correlationId, "The cancellation was not applied.", "databaseFailure");
    revalidatePath(`/admin/users/${userId}`); return { ok: true, message: "Cancelled — normal access is available after a fresh validation; no session was created.", correlationId, status: "applied" };
  } catch { return failed(correlationId, "The cancellation was not applied."); }
}
