// ============================================================================
// Entry-gate ticket cookie — server-side write/clear helper
// ============================================================================
//
// Deliberately its OWN module rather than living in `actions.ts`: that file is a
// `"use server"` boundary where every export becomes a callable Server Action.
// Cookie revocation is an internal helper, not something a client should ever be
// able to invoke directly.
//
// Uses `next/headers`, so it is Node/Server-Component only and must never be
// imported from middleware (see `entryGate.ts` for the Edge-safe primitives).
// ============================================================================

import { cookies } from "next/headers";
import {
  ADMIN_ENTRY_COOKIE_NAME,
  ADMIN_ENTRY_COOKIE_PATH,
  shouldUseSecureCookie,
} from "./entryGate";

/**
 * Delete the entry-gate ticket so /admin returns an ordinary 404 again and the
 * private gateway must be passed afresh.
 *
 * Written with an immediate expiry as well as an empty value so browsers drop it
 * even where a bare `.delete()` would not match on attributes. Safe to call when
 * no ticket is present, and best-effort by design: some server contexts do not
 * allow cookie writes, and the ticket is short-lived regardless.
 */
export function clearEntryTicketCookie(): void {
  try {
    cookies().set({
      name: ADMIN_ENTRY_COOKIE_NAME,
      value: "",
      httpOnly: true,
      secure: shouldUseSecureCookie(),
      sameSite: "strict",
      path: ADMIN_ENTRY_COOKIE_PATH,
      maxAge: 0,
      expires: new Date(0),
    });
  } catch {
    /* not writable in this context — see note above */
  }
}
