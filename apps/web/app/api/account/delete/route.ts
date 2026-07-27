import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "../../../../lib/supabase/server";

// Permanent account deletion for the authenticated WEB session.
//
// It deliberately does NOT delete anything itself. It resolves the caller from
// their own cookie session and forwards their access token to the ONE deletion
// path the whole product shares — the `delete-account` Supabase Edge Function,
// which runs delete_own_account_atomic() in a single transaction and sweeps the
// user's Storage objects with the service role. Mobile and web therefore delete
// through identical server-side code; there is no second implementation to keep
// in sync and no way for the two platforms to diverge.
//
// The user id is never read from the request body. There is no body. The only
// account this route can delete is the one holding the cookie.
//
// This REPLACES app/api/delete-account/route.ts, which was deleted: that route
// called admin.auth.admin.deleteUser() and nothing else, so it removed the auth
// record while leaving every data row behind — the exact inverse of the ghost
// account, and a service-role deletion endpoint sitting unreferenced in
// production. It had no callers.

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // ── CSRF: a cookie-authenticated destructive POST must be same-origin ─────
  // Browsers always send Origin on cross-site POSTs, so a missing-or-foreign
  // Origin is either a forged request or something we do not need to serve.
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (origin !== expected) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = createClient();

  // getUser() validates the JWT with the auth server rather than trusting the
  // cookie's contents.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token;
  if (!accessToken) {
    return NextResponse.json({ error: "Your session has expired." }, { status: 401 });
  }

  let functionResponse: Response;
  try {
    functionResponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: "{}",
      }
    );
  } catch (e) {
    console.error("[account/delete] edge function unreachable:", e);
    // Nothing happened server-side; the account is intact and retry is safe.
    return NextResponse.json(
      { error: "We couldn't reach the server. Please try again." },
      { status: 503 }
    );
  }

  const result = (await functionResponse.json().catch(() => null)) as
    | { success?: boolean; authDeleted?: boolean; error?: string }
    | null;

  // The account is only gone when the AUTH record is gone. Treating a partial
  // result as success is what once let a half-deleted account sign back in.
  if (!functionResponse.ok || !result?.success || !result.authDeleted) {
    console.error(
      "[account/delete] deletion did not complete:",
      functionResponse.status,
      result?.error
    );
    return NextResponse.json(
      {
        error:
          functionResponse.status === 401
            ? "Your session has expired. Please sign in again."
            : "We couldn't delete your account. Your account is unchanged — please try again.",
      },
      { status: functionResponse.status === 401 ? 401 : 500 }
    );
  }

  // Deletion confirmed. Clear the auth cookies on this browser. `local` scope
  // only: the refresh token is already void because the user no longer exists,
  // and a global sign-out round trip would just fail and slow the response.
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The cookies are cleared by the client redirect regardless; a failure here
    // must not turn a completed deletion into an error.
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
