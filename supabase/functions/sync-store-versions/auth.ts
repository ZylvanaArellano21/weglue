// Caller authentication for the store-version poller, extracted so it can be
// unit-tested without the Deno runtime.
//
// The function runs with verify_jwt = false (supabase/config.toml), so this is
// the ONLY gate. The trusted invokers — pg_cron (Vault secret) and the Admin
// Dashboard server action (server-only env var) — present the dedicated
// store-sync Secret API key in the `apikey` header. It is never a client
// credential and never the project's legacy service_role JWT.

/** Constant-time string comparison (no early return on first mismatch). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The key a request presents: `apikey` header, or a `Bearer` fallback. */
export function presentedKey(headers: Headers): string {
  return (
    headers.get("apikey") ??
    headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  );
}

/**
 * True only when the request carries the expected store-sync Secret API key.
 * `expected` is `STORE_SYNC_API_KEY` from the function's secrets; an unset
 * value is a hard fail (the endpoint stays closed until it is configured).
 */
export function authorizedServiceCaller(headers: Headers, expected: string | undefined): boolean {
  if (!expected) return false;
  const presented = presentedKey(headers);
  return presented.length > 0 && timingSafeEqual(presented, expected);
}
