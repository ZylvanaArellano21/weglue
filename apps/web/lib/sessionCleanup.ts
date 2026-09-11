"use client";

import type { QueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "./supabase-browser";

// ─── Centralized authenticated-session teardown (web) ────────────────────────
//
// Web mirror of apps/mobile/lib/sessionCleanup.ts: THE single cleanup path for
// every way an authenticated session ends. The mobile file is the source of
// truth for the ORDER, which is load-bearing:
//
//   1. Realtime channels first, so no subscription callback can rehydrate a
//      cache we are about to wipe.
//   2. Sign out — LOCAL scope. `scope` controls how many OTHER
//      sessions/devices get their refresh token revoked server-side, not
//      which storage this browser clears: `local`, `global`, and `others` all
//      clear this browser's own storage/httpOnly Supabase cookies and end
//      this tab's session. `global` additionally revokes every refresh token
//      for the account on every OTHER device (phone, other browsers) — this
//      previously ran as the DEFAULT (no `scope` argument = 'global'), which
//      is why an ordinary "Log out" here silently ended every session on the
//      account everywhere else too (task 7). A normal logout must only ever
//      end THIS session.
//   3. Wipe the in-memory React Query cache — all of it is account-scoped.
//   4. Hard navigation to the public landing page (never router.push): a full
//      document load discards every client cache, unmounts the authenticated
//      tree, and — because it is a `replace` — leaves no history entry that
//      browser Back could restore an authenticated page from.
//
// Everything is best-effort and idempotent: a cleanup failure must never
// strand a student inside an account they asked to leave. The one exception is
// the sign-out itself — if it genuinely fails, the caller is told, so we never
// pretend somebody is logged out when they are not.

/** Where a signed-out student lands: the public We Glue landing page. */
export const PUBLIC_LANDING_PATH = "/";

export interface TeardownResult {
  signedOut: boolean;
}

/**
 * Tears down every trace of the authenticated session in this browser.
 *
 * Does NOT navigate — the caller decides where to go, so a failed sign-out can
 * keep the user where they are with an error instead of a false success.
 */
export async function tearDownAuthenticatedSession(
  queryClient: QueryClient
): Promise<TeardownResult> {
  const supabase = getSupabaseBrowser();

  // 1. Stop realtime before anything else.
  try {
    await supabase.realtime.setAuth(null);
    await supabase.removeAllChannels();
  } catch {
    // Channels are local objects; failing to remove them cannot block logout.
  }

  // 2. The actual sign-out. `local` scope: end THIS session/browser only —
  //    never the account's other devices (see the file header).
  let signedOut = true;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) signedOut = false;
  } catch {
    signedOut = false;
  }

  // 3. Every cached query is account-scoped — drop the lot.
  try {
    await queryClient.cancelQueries();
    queryClient.clear();
  } catch {
    /* non-fatal */
  }

  return { signedOut };
}

/**
 * Leaves the authenticated app for the public landing page in a way browser
 * Back cannot undo. `location.replace` (not `router.replace`) is deliberate:
 * only a real document load guarantees no authenticated React tree, no React
 * Query cache and no history entry survive.
 */
export function redirectToPublicLanding(path: string = PUBLIC_LANDING_PATH): void {
  window.location.replace(path);
}
