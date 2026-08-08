/**
 * CORS for the Edge Functions the BROWSER calls directly.
 *
 * WHY THIS EXISTS
 * ---------------
 * `supabase.functions.invoke()` from a browser sends a POST carrying
 * `Authorization`, `apikey` and `x-client-info`. Those are not CORS-simple
 * headers, so the browser first issues an `OPTIONS` preflight. `delete-message`
 * and `send-report-email` answered that preflight with `405 Method not allowed`
 * and no `Access-Control-Allow-Origin`, so the preflight failed and the real
 * POST was NEVER SENT.
 *
 * The visible consequence was reported as a broken feature: "Unsend for
 * everyone" and "Report" on the web always failed with "Couldn't update the
 * message", while the identical call from the phone worked — React Native
 * issues no preflight. Verified against production:
 *
 *     OPTIONS https://<ref>.functions.supabase.co/delete-message
 *     → HTTP 405, no Access-Control-Allow-Origin
 *
 * The database side was never at fault: `begin_message_deletion` succeeds for a
 * sender and correctly refuses an unauthorised caller with 42501.
 *
 * SECURITY
 * --------
 * The origin is ECHOED FROM AN ALLOWLIST, never reflected blindly and never
 * `*`. `Access-Control-Allow-Credentials` is deliberately NOT set: these
 * functions authenticate from the `Authorization` header, not from cookies, so
 * granting credentialed cross-origin access would widen the surface for no
 * reason. `Vary: Origin` keeps a CDN from serving one origin's headers to
 * another. CORS is a browser-side control in any case — it decides which web
 * pages may READ a response, and it is not, and is not relied on as, the
 * authorization boundary. Every function still verifies the caller's JWT and
 * every RPC still runs under RLS.
 */

const STATIC_ALLOWED_ORIGINS = [
  "https://weglue.app",
  "https://www.weglue.app",
];

/** Vercel preview deployments for this project, e.g.
 *  `https://we-glue-git-<branch>-<team>.vercel.app`. */
const VERCEL_PREVIEW = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

/** Local development only. */
const LOCALHOST = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

function configuredOrigins(): string[] {
  // Optional deployment-specific additions, comma separated. A custom domain
  // can be added without a code change.
  const raw = Deno.env.get("WEB_ALLOWED_ORIGINS") ?? Deno.env.get("SITE_URL") ?? "";
  return raw
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  const normalized = origin.replace(/\/$/, "");
  if (STATIC_ALLOWED_ORIGINS.includes(normalized)) return true;
  if (configuredOrigins().includes(normalized)) return true;
  if (VERCEL_PREVIEW.test(normalized)) return true;
  if (LOCALHOST.test(normalized)) return true;
  return false;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (!isAllowedOrigin(origin)) return headers;
  headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  // `apikey` and `x-client-info` are sent by supabase-js; omitting either makes
  // the preflight fail exactly as before.
  headers["Access-Control-Allow-Headers"] =
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version";
  headers["Access-Control-Max-Age"] = "86400";
  return headers;
}

/**
 * Answers the preflight. Returns `null` when the request is not a preflight, so
 * a handler can simply do:
 *
 *     const preflight = handlePreflight(request);
 *     if (preflight) return preflight;
 *
 * A disallowed origin still gets 204 WITHOUT the allow headers, which is what
 * makes the browser refuse the request — the correct outcome, and it avoids
 * turning the endpoint into an origin oracle.
 */
export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
}
