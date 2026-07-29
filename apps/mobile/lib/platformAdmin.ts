import { isPlatformAdminAuthUser } from "@weglue/shared";

// ─── Mobile platform-admin routing decisions (iOS + Android) ─────────────────
//
// Every decision the mobile app makes about a platform-admin session lives
// here, as pure functions over the Supabase session. Two reasons:
//
//   1. ONE implementation for both platforms. There is no `Platform.OS` branch
//      in this file or in any of its callers, so iOS and Android cannot
//      diverge — the same JavaScript decides for both.
//   2. It is unit-testable. The blocking behavior is a security boundary; it
//      should be proven by tests, not by manually opening two simulators.
//
// Callers (all of them):
//   • app/_layout.tsx          — session bootstrap, profile sync, root render
//   • hooks/useAuthDeepLink.ts — auth deep links
//   • hooks/useInviteDeepLink.ts — invite deep links
//
// The marker itself comes from @weglue/shared (app_metadata.account_type),
// which is service-role-write-only and therefore unspoofable by a client. See
// packages/shared/src/auth/platformAdmin.ts.

/** Structural shape of what these decisions need off a Supabase session. */
export interface SessionLike {
  user?: {
    id?: string;
    email?: string | null;
    app_metadata?: Record<string, unknown> | null;
  } | null;
}

/**
 * True iff the signed-in account is a platform-admin Auth identity.
 * Fails closed to `false` (ordinary student behavior) for a missing session.
 */
export function isPlatformAdminSession(
  session: SessionLike | null | undefined
): boolean {
  return isPlatformAdminAuthUser(session?.user ?? null);
}

/**
 * The root routing decision, evaluated once per session change.
 *
 *   "signed-out"              → the normal unauthenticated Welcome flow
 *   "platform-admin-blocked"  → the blocking screen; NO student tree mounts
 *   "student"                 → the normal app, completely unchanged
 */
export type MobileSessionRoute =
  | "signed-out"
  | "platform-admin-blocked"
  | "student";

export function resolveMobileSessionRoute(
  session: SessionLike | null | undefined
): MobileSessionRoute {
  if (!session) return "signed-out";
  if (isPlatformAdminSession(session)) return "platform-admin-blocked";
  return "student";
}

/**
 * Whether the app may fetch/repair the student profile for this session.
 *
 * Gates BOTH the `profiles` select and the `ensure_profile()` RPC in
 * app/_layout.tsx. False for a platform admin, so the repair path — the one
 * thing that could recreate the deleted student profile row (and re-fire the
 * social-proof fan-out to every student) — is never reached from a phone.
 * Migration 053 makes that a server-side guarantee too; this is the client half.
 */
export function shouldSyncStudentProfile(
  session: SessionLike | null | undefined
): boolean {
  return resolveMobileSessionRoute(session) === "student";
}

/**
 * Whether deep links (auth callbacks, chat invites) may navigate this session
 * into the app. A platform-admin session must not be routed into an invite,
 * a chat, or any other student destination by an incoming URL.
 */
export function shouldHandleDeepLinkNavigation(
  session: SessionLike | null | undefined
): boolean {
  return !isPlatformAdminSession(session);
}
