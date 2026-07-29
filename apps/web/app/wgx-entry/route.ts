// ============================================================================
// Private administrator entry gateway — fixed INTERNAL implementation
// ============================================================================
//
// Reached ONLY through an internal middleware rewrite from the path configured in
// ADMIN_ENTRY_PATH. A direct request to this route is 404'd by middleware, so
// this file's location is not a way in.
//
// Deliberate properties:
//   • ZERO client JavaScript. The page is a hand-rendered HTML string with a
//     plain <form method="POST">, so nothing about the gateway — least of all the
//     configured path — can leak through a client bundle, hydration payload, or
//     Next.js metadata.
//   • The phrase travels in the POST body, never in a URL or query parameter.
//   • The response never names We Glue, "admin", "administrator", or any
//     environment/identity detail. Someone who guesses the path learns nothing.
//   • Node runtime, because scrypt verification needs `node:crypto`.
//
// Passing this gateway is NOT authorization. It only lifts the 404 concealment
// so the existing chain (portal switch → Supabase session → founder UUID →
// founder email → aal2 TOTP → recent MFA → write switch) can run as before.
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_ENTRY_COOKIE_NAME,
  ADMIN_ENTRY_COOKIE_PATH,
  adminEntryCookieSecret,
  adminEntrySecretHash,
  adminEntryTtlMinutes,
  isEntryGateConfigured,
  issueEntryTicket,
  shouldUseSecureCookie,
} from "../../lib/admin/entryGate";
import {
  attemptDelay,
  clientKey,
  isLockedOut,
  logEntrySecurityEvent,
  recordAttempt,
  verifyEntryPhrase,
} from "../../lib/admin/entryGateServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Field name in the POST body. Intentionally uninformative. */
const FIELD = "p";

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  "Referrer-Policy": "no-referrer",
  // No inline script/style is used, so the strictest policy applies cleanly.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

/**
 * The site's ordinary 404, used when the gateway is not configured. Identical in
 * shape to what middleware serves for any concealed path.
 */
function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Minimal, unbranded page. `error` is the SAME generic string for a wrong
 * phrase, a lockout, and a malformed submission — the caller cannot tell which.
 */
function page(error?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<title>Restricted</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f6f7f8; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         color:#111; padding:24px; }
  form { width:100%; max-width:340px; background:#fff; border:1px solid #e5e7eb; border-radius:14px;
         padding:28px; box-shadow:0 1px 2px rgba(0,0,0,.05); }
  h1 { margin:0 0 18px; font-size:15px; font-weight:600; letter-spacing:.01em; }
  label { display:block; font-size:13px; margin-bottom:6px; color:#4b5563; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; font-size:15px;
          border:1px solid #d1d5db; border-radius:8px; background:#fff; color:#111; }
  input:focus { outline:2px solid #0FA6A6; outline-offset:1px; border-color:#0FA6A6; }
  button { width:100%; margin-top:16px; padding:10px 12px; font-size:14px; font-weight:600;
           color:#fff; background:#111827; border:0; border-radius:8px; cursor:pointer; }
  button:hover { background:#1f2937; }
  p.err { margin:14px 0 0; font-size:13px; color:#b91c1c; }
  @media (prefers-color-scheme: dark) {
    body { background:#0b0d10; color:#e5e7eb; }
    form { background:#14171a; border-color:#2a2f36; }
    label { color:#9aa4b2; }
    input { background:#0b0d10; border-color:#2a2f36; color:#e5e7eb; }
    button { background:#e5e7eb; color:#111827; }
    button:hover { background:#f3f4f6; }
  }
</style>
</head>
<body>
<form method="POST" action="" autocomplete="off">
  <h1>Restricted</h1>
  <label for="${FIELD}">Access phrase</label>
  <input id="${FIELD}" name="${FIELD}" type="password" autocomplete="off"
         autocapitalize="off" autocorrect="off" spellcheck="false" required autofocus>
  <button type="submit">Continue</button>
  ${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
</form>
</body>
</html>`;
}

/** One generic denial for every failure mode. */
const GENERIC_DENIAL = "That phrase was not accepted.";

export async function GET(): Promise<NextResponse> {
  if (!isEntryGateConfigured()) return notFound();
  return new NextResponse(page(), { status: 200, headers: SECURITY_HEADERS });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isEntryGateConfigured()) {
    // Nothing to verify against — stay concealed and make the gap visible to
    // operators (no secret material is involved in this event).
    logEntrySecurityEvent("admin_entry.unconfigured", {
      clientKey: clientKey(request.headers, null),
    });
    return notFound();
  }

  const cookieSecret = adminEntryCookieSecret()!;
  const key = clientKey(request.headers, cookieSecret);

  // Uniform cost on every submission, before any branch that depends on input.
  await attemptDelay();

  if (isLockedOut(key)) {
    logEntrySecurityEvent("admin_entry.lockout", { clientKey: key, locked: true });
    // Same status and body as a wrong phrase: a prober cannot detect the lockout.
    return new NextResponse(page(GENERIC_DENIAL), { status: 401, headers: SECURITY_HEADERS });
  }

  let phrase = "";
  try {
    const form = await request.formData();
    const raw = form.get(FIELD);
    phrase = typeof raw === "string" ? raw : "";
  } catch {
    phrase = "";
  }

  const ok = phrase.length > 0 && verifyEntryPhrase(phrase, adminEntrySecretHash());
  // Drop the reference immediately; it is never logged, stored or returned.
  phrase = "";

  const state = recordAttempt(key, ok);

  if (!ok) {
    logEntrySecurityEvent(state.locked ? "admin_entry.lockout" : "admin_entry.failure", {
      clientKey: key,
      failures: state.failures,
      locked: state.locked,
    });
    return new NextResponse(page(GENERIC_DENIAL), { status: 401, headers: SECURITY_HEADERS });
  }

  const { value, maxAgeSeconds } = await issueEntryTicket(cookieSecret, adminEntryTtlMinutes());
  logEntrySecurityEvent("admin_entry.success", { clientKey: key });

  // 303 so the browser re-issues a GET. The dashboard's OWN login/MFA flow takes
  // over from here — this ticket is not a session and grants no authorization.
  const response = NextResponse.redirect(new URL("/admin", request.url), 303);
  response.cookies.set({
    name: ADMIN_ENTRY_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: "strict",
    path: ADMIN_ENTRY_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  });
  for (const [k, v] of Object.entries({
    "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    "Referrer-Policy": "no-referrer",
  })) {
    response.headers.set(k, v);
  }
  return response;
}
