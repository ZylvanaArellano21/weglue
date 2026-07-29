// ============================================================================
// Platform-admin Auth identities — ONE shared predicate for every client
// ============================================================================
//
// The founder's Admin Dashboard account is a Supabase Auth identity that is
// deliberately NOT a student: it has no `public.profiles` row (migration 053
// makes that structural), no campus, no interests, no clubs, and it must never
// appear in discovery, recommendations, Gluemates or any student surface.
//
// This module is the SINGLE source of truth that recognizes such an account on
// the client side. It is imported by:
//
//   • apps/mobile  — iOS and Android run the exact same JS from this file, so
//                    there is no platform-specific branch that could let one
//                    platform through. No `Platform.OS` check exists here or in
//                    any of its callers.
//   • apps/web     — the student web app's Edge middleware and its auth
//                    callback / blocked page.
//
// It is a mirror of the server-side `public.is_platform_admin_auth(jsonb)`
// predicate and uses identical matching semantics (exact string equality on
// app_metadata.account_type).
//
// ── WHY app_metadata, AND WHY THIS IS NOT AUTHORIZATION ─────────────────────
//
// `app_metadata` is writable ONLY by the service role, through GoTrue's admin
// API. There is no client-facing endpoint that can set it: `signUp({ options:
// { data } })` and `auth.updateUser({ data })` both write `user_metadata`. A
// browser, iOS or Android client therefore cannot forge this marker for itself.
//
// It is still only a CLASSIFICATION. It answers "should this client refuse to
// act as a student app?" — a fail-safe question where the worst case of a false
// positive is a blocked screen. It must NEVER answer "may this session read
// admin data?". Admin Dashboard authorization lives exclusively in
// apps/web/lib/admin/adminEnv.ts + secureAdmin.ts and is gated on the immutable
// UUID allowlist, the optional email consistency check, and aal2 MFA. Nothing
// in this file is read by that gate.
//
// This module is intentionally dependency-free (no react, no zustand, no
// supabase client) so it is safe to import from Next.js Edge middleware.
// ============================================================================

/** The one recognized marker value, mirroring migration 053. */
export const PLATFORM_ADMIN_ACCOUNT_TYPE = "platform_admin";

/**
 * The message shown on iOS and Android when a platform-admin session reaches
 * the mobile app. Deliberately points at "your browser" and NOT at a URL: the
 * Admin Dashboard location is never advertised through a student-facing app.
 */
export const PLATFORM_ADMIN_MOBILE_MESSAGE =
  "This account is reserved for We Glue administration. Use the Admin Dashboard in your browser.";

/**
 * The message shown on the student web app's blocked page. Same rule: it names
 * the dashboard but never links to it or reveals its path.
 */
export const PLATFORM_ADMIN_WEB_MESSAGE =
  "This account is reserved for We Glue administration. Open the private Admin Dashboard login.";

/** The neutral student-web route a platform-admin session is sent to. */
export const PLATFORM_ADMIN_BLOCKED_PATH = "/account-restricted";

/**
 * Minimal structural shape of what we need off a Supabase `User`. Typed loosely
 * on purpose so this module never has to import `@supabase/supabase-js` types
 * (which would drag the SDK into the Edge middleware bundle).
 */
export interface PlatformAdminCandidate {
  app_metadata?: Record<string, unknown> | null;
}

/**
 * True iff a *server-validated* auth user is a platform-admin identity.
 *
 * Only ever call this with a user obtained from `supabase.auth.getUser()` or a
 * verified session — never with client-supplied JSON. Fails CLOSED to `false`
 * (i.e. "treat as an ordinary student") for null/undefined input, which is the
 * safe direction: an unrecognized account keeps the existing student behavior
 * rather than being locked out.
 *
 * Semantics are identical to the SQL predicate: an exact string match. A
 * boolean/number/object value, a differently-cased string, or a missing key are
 * all `false`.
 */
export function isPlatformAdminAuthUser(
  user: PlatformAdminCandidate | null | undefined
): boolean {
  const value = user?.app_metadata?.["account_type"];
  return typeof value === "string" && value === PLATFORM_ADMIN_ACCOUNT_TYPE;
}
