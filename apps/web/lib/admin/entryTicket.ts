// ============================================================================
// Entry-gate ticket — server-side read (Server Components / Route Handlers)
// ============================================================================
//
// Uses `next/headers`, so this is Node/Server-only and must NEVER be imported
// from middleware. The Edge-safe primitives live in `entryGate.ts`.
//
// WHY THE /admin 404 IS PRODUCED HERE AND NOT IN MIDDLEWARE
// --------------------------------------------------------
// A middleware `NextResponse.rewrite()` attaches an `x-middleware-rewrite`
// header to the response. That header is a tell: a genuine 404 for a mistyped URL
// carries no such header, so a rewrite-based concealment would announce that
// /admin is handled specially — exactly what this layer exists to prevent. (Some
// platforms consume the header at the edge; relying on that is not a security
// property we control.)
//
// Calling `notFound()` from inside the /admin layout and each /admin/api route
// instead makes Next render its OWN not-found response for the requested URL:
// identical body, identical headers, real 404 status, no rewrite artifact.
//
// Middleware still short-circuits these requests BEFORE the Supabase session
// lookup, so probing /admin costs no auth round-trip.
// ============================================================================

import { cookies } from "next/headers";
import {
  ADMIN_ENTRY_COOKIE_NAME,
  adminEntryCookieSecret,
  verifyEntryTicket,
} from "./entryGate";

/**
 * True only when the request carries a valid, unexpired, correctly signed entry
 * ticket. Fails CLOSED: an unconfigured cookie secret, a missing cookie, a
 * tampered value or an expired ticket all return false.
 *
 * This answers "should /admin be visible at all?" — never "is this caller an
 * administrator?". Authorization remains entirely in secureAdmin.ts.
 */
export async function hasValidEntryTicket(): Promise<boolean> {
  const secret = adminEntryCookieSecret();
  if (!secret) return false;
  try {
    const value = cookies().get(ADMIN_ENTRY_COOKIE_NAME)?.value;
    return (await verifyEntryTicket(secret, value)) !== null;
  } catch {
    return false;
  }
}
