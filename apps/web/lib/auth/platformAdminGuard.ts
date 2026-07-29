// ============================================================================
// Student web app — platform-admin containment  (PURE; EDGE-SAFE)
// ============================================================================
//
// A platform-admin Auth identity has no `public.profiles` row (migration 053
// makes that structural) and must never enter the student web application:
// no Home, no feed, no clubs, no recommendations, no people, no onboarding, and
// crucially no code path that would create or repair a student profile for it.
//
// This module holds the pure routing decision so it can be unit-tested and
// imported from Edge middleware. It contains no `next/headers`, no Supabase
// client and no service-role anything.
//
// RELATIONSHIP TO ADMIN AUTHORIZATION — read before changing:
//   This decides "must this session be kept OUT of the student app?". It is a
//   fail-safe question. It NEVER decides "may this session read admin data?" —
//   that is `lib/admin/adminEnv.ts` + `lib/admin/secureAdmin.ts`, gated on the
//   immutable UUID allowlist + optional email match + aal2 MFA. `account_type`
//   grants nothing there and must not be added to it.
// ============================================================================

import { isPlatformAdminAuthUser } from "@weglue/shared/auth/platformAdmin";

/** The neutral page a contained platform-admin session is redirected to. */
export const PLATFORM_ADMIN_BLOCKED_PATH = "/account-restricted";

/**
 * Store-policy and account-management pages that must stay reachable for ANY
 * signed-in session. These are public, contain no student data, and both the
 * App Store and Play Store expect them to resolve. Blocking them would be a
 * real (if small) regression for no security gain.
 */
const ALWAYS_REACHABLE_PATHS = [
  "/privacy-policy",
  "/terms",
  "/terms-of-service",
  "/child-safety-standards",
  "/delete-account",
];

/**
 * Paths a signed-in platform admin may still load on the student web origin.
 *
 *   • the blocked page itself      — otherwise the redirect loops
 *   • /auth/*                      — sign-out and recovery callbacks must work
 *   • /admin*                      — has its own, stricter gate (and middleware
 *                                    already returned before reaching here)
 *   • the public legal pages       — see above
 */
export function isPlatformAdminExemptPath(pathname: string): boolean {
  if (
    pathname === PLATFORM_ADMIN_BLOCKED_PATH ||
    pathname.startsWith(`${PLATFORM_ADMIN_BLOCKED_PATH}/`)
  ) {
    return true;
  }
  if (pathname.startsWith("/auth/") || pathname === "/auth") return true;
  // Deliberately the SAME prefix test middleware uses to enter its admin
  // branch (`pathname.startsWith("/admin")`). Keeping the two identical is the
  // point: middleware returns before this guard ever runs for such a path, so a
  // stricter test here would only create a silent divergence between two guards
  // that must agree about what "an admin path" is.
  if (pathname.startsWith("/admin")) return true;
  return ALWAYS_REACHABLE_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/**
 * The student-web decision for one request.
 *
 * Returns the path to redirect to, or `null` to let the request proceed
 * unchanged. Returns `null` for every non-platform-admin session, so ordinary
 * `.edu` students are completely unaffected — this cannot alter student
 * routing, onboarding, or the `.edu` restriction in any way.
 *
 * Call ONLY with a server-validated user (`supabase.auth.getUser()`).
 */
export function platformAdminRedirectPath(
  user: { app_metadata?: Record<string, unknown> | null } | null | undefined,
  pathname: string
): string | null {
  if (!isPlatformAdminAuthUser(user)) return null;
  if (isPlatformAdminExemptPath(pathname)) return null;
  return PLATFORM_ADMIN_BLOCKED_PATH;
}
