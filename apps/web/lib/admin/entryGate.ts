// ============================================================================
// Admin entry gateway — pure primitives  (EDGE-SAFE; NO NODE APIs)
// ============================================================================
//
// A private, pre-authentication gateway that sits IN FRONT of the Admin
// Dashboard. Its only job is concealment + a shared-secret speed bump:
//
//   • Nothing under /admin exists to the outside world without a valid entry
//     ticket cookie — every such request becomes an ordinary 404.
//   • The gateway itself lives at a path configured ONLY through the
//     ADMIN_ENTRY_PATH environment variable. The path appears nowhere in source,
//     navigation, robots.txt, sitemap, metadata or client JavaScript.
//
// ── THIS IS DEFENSE IN DEPTH, NOT AUTHORIZATION ─────────────────────────────
//
// Passing the gateway grants EXACTLY ONE thing: permission for /admin routes to
// stop returning 404 and start rendering their own login/MFA flow. It is not an
// identity, not a session, not a role, and it is never consulted by any
// authorization decision. Every existing gate still runs, unchanged and in the
// same order:
//
//   ADMIN_PORTAL_ENABLED → validated Supabase session → immutable founder UUID
//   allowlist → optional exact founder email match → TOTP aal2 → recent MFA for
//   sensitive reads → ADMIN_WRITES_ENABLED for every mutation.
//
// A correct entry phrase with the wrong Supabase identity therefore receives no
// administration data whatsoever. Nothing in this file is read by
// `adminEnv.ts`, `secureAdmin.ts`, or any loader/action/route.
//
// ── WHY THIS MODULE IS EDGE-SAFE ────────────────────────────────────────────
//
// It is imported by `middleware.ts`, which runs on the Edge runtime, so it uses
// Web Crypto (`crypto.subtle`) only — no `node:crypto`, no `next/headers`, no
// Supabase client. The password-hash verification (scrypt) and the rate limiter
// are deliberately NOT here; they live in `entryGateServer.ts`, which only the
// Node-runtime gateway Route Handler imports.
// ============================================================================

/**
 * Cookie name. Deliberately opaque: it must not hint at an administration area
 * to anyone inspecting a response, and it is never set on a student response.
 */
export const ADMIN_ENTRY_COOKIE_NAME = "wg_x1";

/**
 * Fixed INTERNAL route the private external path rewrites to. This is an
 * implementation detail, not a secret — direct requests to it are 404'd by
 * middleware exactly like any other concealed path, so knowing it grants
 * nothing without the configured ADMIN_ENTRY_PATH and the phrase.
 */
export const ADMIN_ENTRY_INTERNAL_ROUTE = "/wgx-entry";

/**
 * Rewrite target used to conceal an admin path.
 *
 * DELIBERATELY NOT A REAL ROUTE — do not create `app/wgx-404/`. Rewriting to a
 * path with no matching route makes Next render its OWN not-found response, so a
 * concealed /admin request is byte-identical to any mistyped URL. An earlier
 * revision pointed this at a real page calling `notFound()`, which produced a
 * *different* body length than a genuine 404 (4885 vs 7512 bytes locally) and so
 * was itself a tell that /admin was special.
 */
export const ADMIN_NOT_FOUND_ROUTE = "/wgx-404";

/** Cookie lifetime bounds, in minutes. ~10 minutes is the intended default. */
export const ADMIN_ENTRY_TTL_DEFAULT_MINUTES = 10;
const TTL_MIN_MINUTES = 1;
const TTL_MAX_MINUTES = 60;

/** Path the ticket cookie is scoped to — it is useless anywhere else. */
export const ADMIN_ENTRY_COOKIE_PATH = "/admin";

// ── Environment ──────────────────────────────────────────────────────────────

/**
 * Reserved path namespaces the private path may never occupy. Allowing any of
 * these would either shadow a real surface or be short-circuited by the framework
 * before middleware's gate logic runs.
 *
 * Matched as an exact path OR a `/`-delimited prefix, so `/administrators` is
 * still a legal private path while `/admin/x` is not.
 */
const RESERVED_SEGMENTS = ["/_next", "/api", "/admin", "/auth"];

/**
 * Reserved as a RAW string prefix, not a path segment: every internal route this
 * gateway owns lives under `/wgx-…`. A configured path anywhere in that namespace
 * would collide with the internal gateway/404 routes, so reject the whole prefix
 * (this is why `/wgx-entry` is refused, not just `/wgx-/…`).
 *
 * NOTE: these internal routes must NOT begin with an underscore — Next.js App
 * Router treats `_`-prefixed folders as private and excludes them from routing
 * entirely, which silently leaves the gateway and the 404 target unbuilt.
 */
const RESERVED_RAW_PREFIX = "/wgx-";

/**
 * Validate and normalize the configured private path.
 *
 * Returns `null` (→ FAIL CLOSED: the gateway is unreachable and every /admin
 * path stays 404) when the value is absent or does not look like a safe,
 * single-segment-or-deeper absolute path.
 */
export function normalizeEntryPath(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length < 2 || value.length > 128) return null;
  if (!value.startsWith("/")) return null;
  if (value.includes("//") || value.includes("..") || value.includes("?") || value.includes("#")) {
    return null;
  }
  // Conservative charset: path segments of unreserved URL characters only.
  if (!/^\/[A-Za-z0-9\-._~/]+$/.test(value)) return null;
  // No trailing slash (so the comparison in middleware is exact and total).
  const normalized = value.endsWith("/") ? value.slice(0, -1) : value;
  if (normalized.length < 2) return null;
  const lower = normalized.toLowerCase();
  if (lower.startsWith(RESERVED_RAW_PREFIX)) return null;
  if (RESERVED_SEGMENTS.some((p) => lower === p || lower.startsWith(`${p}/`))) return null;
  return normalized;
}

export function adminEntryPath(): string | null {
  return normalizeEntryPath(process.env.ADMIN_ENTRY_PATH);
}

/** The stored scrypt hash of the phrase. Never the phrase itself. */
export function adminEntrySecretHash(): string | null {
  const v = process.env.ADMIN_ENTRY_SECRET_HASH?.trim();
  return v && v.length > 0 ? v : null;
}

/** HMAC key protecting the ticket cookie against modification. */
export function adminEntryCookieSecret(): string | null {
  const v = process.env.ADMIN_ENTRY_COOKIE_SECRET?.trim();
  // A short key would make forging the ticket cheap — treat it as unconfigured.
  return v && v.length >= 32 ? v : null;
}

/** Ticket lifetime in minutes: default ~10, clamped to a sane range. */
export function adminEntryTtlMinutes(): number {
  const raw = process.env.ADMIN_ENTRY_COOKIE_TTL_MINUTES?.trim();
  if (!raw) return ADMIN_ENTRY_TTL_DEFAULT_MINUTES;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return ADMIN_ENTRY_TTL_DEFAULT_MINUTES;
  return Math.min(TTL_MAX_MINUTES, Math.max(TTL_MIN_MINUTES, n));
}

/**
 * True only when every REQUIRED value is present and valid. When false the
 * gateway refuses all submissions and /admin stays concealed — the deliberate
 * fail-closed posture for an unconfigured or half-configured environment.
 */
export function isEntryGateConfigured(): boolean {
  return (
    adminEntryPath() !== null &&
    adminEntrySecretHash() !== null &&
    adminEntryCookieSecret() !== null
  );
}

/** Secure cookie flag: on for Vercel Preview/Production, off for local http. */
export function shouldUseSecureCookie(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  return vercelEnv === "production" || vercelEnv === "preview" || process.env.VERCEL === "1";
}

// ── base64url ────────────────────────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Returns an explicitly ArrayBuffer-backed view: `crypto.subtle` requires a
// `BufferSource` and a bare `Uint8Array` is typed as possibly SharedArrayBuffer-backed.
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const out = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// ── Ticket signing / verification (HMAC-SHA256 over the payload) ─────────────

export interface EntryTicket {
  /** Schema version, so a future format change can be rejected explicitly. */
  v: 1;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
  /** Random id — makes every ticket unique and unguessable. */
  jti: string;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Build a signed ticket: `base64url(payload).base64url(hmac)`.
 *
 * The payload carries NO phrase, NO hash, NO identity and NO session data —
 * only timing and a nonce. Even a fully disclosed ticket reveals nothing about
 * the phrase or the administrator.
 */
export async function signEntryTicket(secret: string, ticket: EntryTicket): Promise<string> {
  const payload = new TextEncoder().encode(JSON.stringify(ticket));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), payload);
  return `${toBase64Url(payload)}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Mint a ticket valid for `ttlMinutes` from `nowSeconds`. */
export async function issueEntryTicket(
  secret: string,
  ttlMinutes: number,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<{ value: string; ticket: EntryTicket; maxAgeSeconds: number }> {
  const maxAgeSeconds = ttlMinutes * 60;
  const jtiBytes = new Uint8Array(16);
  crypto.getRandomValues(jtiBytes);
  const ticket: EntryTicket = {
    v: 1,
    iat: nowSeconds,
    exp: nowSeconds + maxAgeSeconds,
    jti: toBase64Url(jtiBytes),
  };
  return { value: await signEntryTicket(secret, ticket), ticket, maxAgeSeconds };
}

/**
 * Verify a ticket cookie value. Returns the ticket, or `null` for ANY failure:
 * malformed, wrong version, bad signature, or expired.
 *
 * Signature comparison uses `crypto.subtle.verify`, which is constant-time with
 * respect to the MAC, so a forged cookie leaks no byte-by-byte feedback.
 */
export async function verifyEntryTicket(
  secret: string,
  value: string | undefined | null,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<EntryTicket | null> {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  // Exactly one separator — reject anything with extra structure.
  if (value.indexOf(".", dot + 1) !== -1) return null;

  const payloadBytes = fromBase64Url(value.slice(0, dot));
  const sigBytes = fromBase64Url(value.slice(dot + 1));
  if (!payloadBytes || !sigBytes) return null;

  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sigBytes, payloadBytes);
  } catch {
    return null;
  }
  if (!ok) return null;

  let ticket: unknown;
  try {
    ticket = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (
    typeof ticket !== "object" ||
    ticket === null ||
    (ticket as EntryTicket).v !== 1 ||
    typeof (ticket as EntryTicket).exp !== "number" ||
    typeof (ticket as EntryTicket).iat !== "number" ||
    typeof (ticket as EntryTicket).jti !== "string"
  ) {
    return null;
  }
  const t = ticket as EntryTicket;
  if (!Number.isFinite(t.exp) || t.exp <= nowSeconds) return null;
  return t;
}

/** Read one cookie value out of a raw `Cookie:` header. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// ── The pure routing decision ────────────────────────────────────────────────

export type EntryGateAction =
  /** Not an admin/gateway path — middleware continues its ordinary work. */
  | { action: "passthrough" }
  /** Internally rewrite the private external path to the gateway handler. */
  | { action: "gateway" }
  /**
   * Conceal an /admin path. Middleware must pass the request through WITHOUT
   * doing any session work; the /admin layout (and each /admin/api route) then
   * calls `notFound()`, so Next emits its own genuine 404 for the requested URL —
   * no `x-middleware-rewrite` artifact to distinguish it from a mistyped URL.
   */
  | { action: "conceal_admin" }
  /**
   * Conceal an INTERNAL gateway path reached directly. Safe to rewrite here: this
   * path is not the secret, so a rewrite artifact reveals nothing.
   */
  | { action: "conceal_internal" }
  /** A valid ticket exists — hand off to the EXISTING admin security chain. */
  | { action: "admin_allowed" };

export interface EntryGateInput {
  pathname: string;
  /** Result of `verifyEntryTicket` for this request (already awaited). */
  hasValidTicket: boolean;
  /** Normalized private path, or null when unconfigured/invalid. */
  entryPath: string | null;
  /** Whether every required env value is present and valid. */
  configured: boolean;
}

/**
 * Decide what happens to one request, with no I/O — this is the unit-tested
 * heart of the gateway.
 *
 * Order matters:
 *   1. The private path (only when fully configured) → gateway.
 *   2. The internal gateway/404 routes reached DIRECTLY → 404. A rewrite does
 *      not re-enter middleware, so the legitimate rewrite is unaffected; only
 *      someone typing the internal path is concealed.
 *   3. Any /admin path → 404 unless a valid ticket is present.
 *   4. Everything else (the whole student site) → untouched.
 */
export function adminEntryDecision(input: EntryGateInput): EntryGateAction {
  const { pathname, hasValidTicket, entryPath, configured } = input;

  if (configured && entryPath && (pathname === entryPath || pathname === `${entryPath}/`)) {
    return { action: "gateway" };
  }

  if (
    pathname === ADMIN_ENTRY_INTERNAL_ROUTE ||
    pathname.startsWith(`${ADMIN_ENTRY_INTERNAL_ROUTE}/`) ||
    pathname === ADMIN_NOT_FOUND_ROUTE ||
    pathname.startsWith(`${ADMIN_NOT_FOUND_ROUTE}/`)
  ) {
    return { action: "conceal_internal" };
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    // Unconfigured environment → no ticket can ever be valid → stays concealed.
    return hasValidTicket ? { action: "admin_allowed" } : { action: "conceal_admin" };
  }

  return { action: "passthrough" };
}
