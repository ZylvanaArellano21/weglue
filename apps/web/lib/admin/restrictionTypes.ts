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
 * The four outcomes a restriction action can report, kept distinct because the
 * founder must be able to tell them apart:
 *
 *   applied         restriction committed, sessions revoked
 *   sessionsFailed  committed, revocation FAILED. Access is still denied by the
 *                   database — degraded, not unsafe. The old access token
 *                   simply expires on its own against a database refusing it.
 *   reconcile       committed and revoked, but the outcome could not be
 *                   recorded; flagged for reconciliation.
 *   rejected        nothing changed.
 */
export type RestrictionOutcome = "applied" | "sessionsFailed" | "reconcile" | "rejected";

export interface RestrictionResult {
  ok: boolean;
  outcome: RestrictionOutcome;
  message: string;
  correlationId: string;
  sessionsRevoked: boolean;
}
