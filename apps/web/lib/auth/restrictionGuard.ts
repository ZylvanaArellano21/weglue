// ============================================================================
// Student web — administrator-restriction containment  (PURE; EDGE-SAFE)
// ============================================================================
//
// Day 10B2. The routing half of the restricted-account model, kept pure so it
// can be unit-tested and imported from Edge middleware: no `next/headers`, no
// Supabase client, no service-role anything.
//
// RELATIONSHIP TO THE OTHER GUARDS — read before changing:
//   • `platformAdminGuard.ts` keeps ADMINISTRATOR identities out of the student
//     app. Different question, different source (app_metadata on the session).
//   • This file keeps RESTRICTED STUDENTS out of the student app. The state
//     lives in the database, so middleware must look it up.
//   • Neither decides admin authorization. That is `lib/admin/secureAdmin.ts`.
//
// THIS IS NOT THE CONTROL. Migration 058 is: RLS and the RPC guards deny a
// restricted account server-side. If this file were bypassed entirely, a
// restricted student would reach a student page that renders nothing, because
// every query behind it returns empty or raises. This module exists so that
// experience is a clear explanation instead of a broken-looking screen.

/** Where a restricted student is sent. */
export const RESTRICTED_PATH = "/restricted";

/**
 * Pages that must stay reachable for ANY signed-in session, restricted or not.
 *
 * `/account/delete` and `/delete-account` are the load-bearing entries: a
 * restricted student must never lose the ability to delete their own account.
 * Blocking those would trade a real store-compliance obligation for no
 * security gain, since deletion is the one action that ends the restriction
 * problem entirely.
 */
const ALWAYS_REACHABLE = [
  "/privacy-policy",
  "/terms",
  "/terms-of-service",
  "/community-guidelines",
  "/child-safety-standards",
  "/delete-account",
  "/account/delete",
];

export function isRestrictionExemptPath(pathname: string): boolean {
  if (pathname === RESTRICTED_PATH || pathname.startsWith(`${RESTRICTED_PATH}/`)) return true;
  // Sign-out and recovery callbacks must work, or a restricted student cannot
  // even leave.
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return true;
  if (pathname === "/login" || pathname === "/logout") return true;
  // The private admin portal has its own, stricter gate and must not be
  // affected by student routing. Middleware returns before this guard for such
  // a path; keeping the same prefix test avoids a silent divergence.
  if (pathname.startsWith("/admin")) return true;
  return ALWAYS_REACHABLE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Access states this guard may be handed.
 *
 * Middleware reads them from `my_access_state()`, which is scoped to auth.uid()
 * and returns the GENERIC 'restricted' rather than 'platform_blocked' — the
 * per-user probe `get_account_access_state(uuid)` is deliberately service_role
 * only, so students cannot enumerate anyone else's state. Both spellings are
 * accepted here so the same pure function serves middleware and any
 * server-side caller that has the privileged value.
 */
export type ServerAccessState = "active" | "suspended" | "restricted" | "platform_blocked";

/**
 * The student-web decision for one request.
 *
 * Returns the path to redirect to, or `null` to let the request proceed.
 * Returns `null` for every unrestricted student, so ordinary routing is
 * completely unaffected.
 *
 * FAILS OPEN on an unknown state, deliberately and for the same reason the
 * mobile client does: an unreadable state must not lock out a healthy student,
 * and the server still refuses a genuinely restricted one.
 */
export function restrictionRedirectPath(
  state: ServerAccessState | null | undefined,
  pathname: string
): string | null {
  if (!state || state === "active") return null;
  if (isRestrictionExemptPath(pathname)) return null;
  return RESTRICTED_PATH;
}

/**
 * Should a signed-in student sitting ON the restricted page be sent back into
 * the app? True once their restriction has lapsed or been lifted, which is what
 * makes "expired suspension resumes access after the next check" work without
 * any client-side timer.
 */
export function shouldLeaveRestrictedShell(
  state: ServerAccessState | null | undefined,
  pathname: string
): boolean {
  return (
    (pathname === RESTRICTED_PATH || pathname.startsWith(`${RESTRICTED_PATH}/`)) &&
    (!state || state === "active")
  );
}
