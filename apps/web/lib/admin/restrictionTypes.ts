// ============================================================================
// Administrator restrictions — shared constants and types
// ============================================================================
//
// Deliberately NOT in `restrictionActions.ts`. That file carries "use server",
// and a Server Actions module may only export async functions — exporting a
// plain constant from it fails the production build outright. Keeping the
// value-and-type surface here lets both the server actions and the client
// dialog import the same bounds without duplicating them.

/** Reason bounds. Enforced in three independent places, and this is the first:
 *  1. this bound, in the dialog and the server action;
 *  2. the server action's own re-validation before the database is touched;
 *  3. the database CHECK on account_restrictions.internal_reason (migration 058)
 *     and on admin_audit_events.reason (migration 055).
 *  A client that skips the dialog still cannot write a bad reason. */
export const MIN_INTERNAL_REASON = 3;
export const MIN_PUBLIC_REASON = 10;
export const MAX_REASON = 500;

export const VIOLATION_CATEGORIES = [
  ["targeted_harassment", "Targeted harassment"],
  ["threats_or_violence", "Threats or violence"],
  ["hate_speech", "Hate speech"],
  ["sexual_harassment", "Sexual harassment"],
  ["impersonation", "Impersonation"],
  ["spam_or_scams", "Spam or scams"],
  ["privacy_violation", "Privacy violation"],
  ["inappropriate_content", "Inappropriate content"],
  ["repeated_guidelines_violations", "Repeated Community Guidelines violations"],
  ["fraudulent_or_deceptive_behavior", "Fraudulent or deceptive behavior"],
  ["safety_concern", "Safety concern"],
  ["other", "Other"],
] as const;

export type ViolationCategory = (typeof VIOLATION_CATEGORIES)[number][0];
export const DELETION_BASES = [
  ["student_reports", "Reports from students"],
  ["multiple_complaints", "Multiple complaints"],
  ["administrator_observation", "Administrator observation"],
  ["safety_concern", "Safety concern"],
  ["legal_or_institutional_request", "Legal or institutional request"],
  ["repeated_violations", "Repeated violations"],
  ["fraud_or_impersonation_concern", "Fraud or impersonation concern"],
  ["other", "Other"],
] as const;
export type DeletionBasis = (typeof DELETION_BASES)[number][0];

/**
 * The result is deliberately structured. The browser receives an honest safe
 * category, while operational details remain only in the correlated server log.
 *
 * `ok` means the restriction transition committed. It can therefore be true
 * for a post-commit session-revocation or audit-reconciliation warning.
 */
export type RestrictionStatus =
  | "applied"
  | "restrictionAppliedAccessInvalidated"
  | "restrictionAppliedClientRefreshPending"
  | "stepupRequired"
  | "writesDisabled"
  | "invalidTarget"
  | "invalidTransition"
  | "databaseFailure"
  | "auditFailure"
  | "reconciliationRequired"
  | "notApplied";

export interface RestrictionResult {
  ok: boolean;
  status: RestrictionStatus;
  message: string;
  correlationId: string;
  restrictionCommitted: boolean;
  accessInvalidated: boolean;
  clientRefreshPending: boolean;
  reconciliationRequired: boolean;
}

export interface RestrictionReasonInput {
  violationCategory: ViolationCategory;
  publicReason: string;
  internalReason: string;
}
