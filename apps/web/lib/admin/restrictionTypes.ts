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
export const MIN_REASON = 3;
export const MAX_REASON = 500;

/**
 * The result is deliberately structured. The browser receives an honest safe
 * category, while operational details remain only in the correlated server log.
 *
 * `ok` means the restriction transition committed. It can therefore be true
 * for a post-commit session-revocation or audit-reconciliation warning.
 */
export type RestrictionStatus =
  | "applied"
  | "appliedSessionsRevoked"
  | "appliedSessionsFailed"
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
  sessionRevocationAttempted: boolean;
  sessionsRevoked: boolean;
  reconciliationRequired: boolean;
}
