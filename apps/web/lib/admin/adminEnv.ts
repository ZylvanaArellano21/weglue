// ============================================================================
// Admin Dashboard — pure gate primitives  (SAFE ON SERVER *AND* MIDDLEWARE)
// ============================================================================
//
// This module contains ONLY pure, environment-reading helpers. It deliberately
// imports nothing from `next/headers`, `../supabase/server`, or the service-role
// client, so it is safe to import from Edge middleware as well as Server
// Components / Server Actions. All session-aware logic (validated user, MFA
// assurance level) lives in `secureAdmin.ts`, which builds on top of these.
//
// SECURITY MODEL (Day-3 hardening)
// --------------------------------
//   • The authoritative administrator allowlist is the IMMUTABLE Supabase Auth
//     user id (`ADMIN_FOUNDER_USER_IDS`). Email ALONE never grants access.
//   • `ADMIN_FOUNDER_EMAILS`, when configured, is an ADDITIONAL consistency
//     check (AND), never an alternative grant path.
//   • Everything fails CLOSED: an absent/empty id allowlist authorizes no one.
//   • The portal + write kill switches gate every page, loader, action, route.
// ============================================================================

/** Split a comma-separated env allowlist into a normalized, deduped array. */
export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function founderUserIds(): string[] {
  return parseList(process.env.ADMIN_FOUNDER_USER_IDS);
}

export function founderEmails(): string[] {
  return parseList(process.env.ADMIN_FOUNDER_EMAILS);
}

/** Kill switch #1 — the entire portal is offline unless this is exactly "true". */
export function isPortalEnabled(): boolean {
  return process.env.ADMIN_PORTAL_ENABLED === "true";
}

/** Kill switch #2 — every privileged write fails closed unless this is "true". */
export function isWritesEnabled(): boolean {
  return process.env.ADMIN_WRITES_ENABLED === "true";
}

/**
 * True iff the given *server-validated* auth user is an authorized administrator.
 *
 * Only ever call this with a `user` obtained from `supabase.auth.getUser()`
 * (a validated JWT) — never a client-supplied id/email/role.
 *
 * Rules (in order):
 *   1. If the user-id allowlist is empty → deny (fail closed).
 *   2. The user's immutable id MUST be on the allowlist (authoritative).
 *   3. If an email allowlist is configured, the user's email MUST also match
 *      (an extra AND consistency check — never an OR grant).
 */
export function isAllowlistedAdmin(
  user: { id?: string | null; email?: string | null } | null
): boolean {
  if (!user) return false;
  const ids = founderUserIds();
  if (ids.length === 0) return false; // fail closed — no allowlist, no admin

  const id = user.id?.trim().toLowerCase();
  if (!id || !ids.includes(id)) return false; // id is authoritative

  const emails = founderEmails();
  if (emails.length > 0) {
    // Configured → must be consistent. Never grants on its own.
    const email = user.email?.trim().toLowerCase();
    if (!email || !emails.includes(email)) return false;
  }
  return true;
}

// ── MFA assurance + step-up freshness ────────────────────────────────────────

export type AssuranceLevel = "aal1" | "aal2";

/** Administration requires an authenticator-assurance-level-2 (MFA) session. */
export function meetsAdminAssurance(level: string | null | undefined): boolean {
  return level === "aal2";
}

/** One authentication method as reported by GoTrue's AAL response (amr claim). */
export interface AuthMethodEntry {
  method: string;
  /** Unix seconds at which this method was last satisfied. */
  timestamp?: number;
}

/**
 * True iff an MFA (TOTP) verification happened within `maxAgeSeconds`. This is
 * the freshness check behind the dangerous-operation step-up guard: aal2 alone
 * is not enough for destructive actions — the second factor must have been
 * re-verified recently.
 */
export function hasRecentMfa(
  methods: AuthMethodEntry[] | null | undefined,
  nowSeconds: number,
  maxAgeSeconds: number
): boolean {
  if (!methods || methods.length === 0) return false;
  return methods.some(
    (m) =>
      (m.method === "totp" || m.method === "mfa/totp") &&
      typeof m.timestamp === "number" &&
      nowSeconds - m.timestamp <= maxAgeSeconds &&
      nowSeconds - m.timestamp >= 0
  );
}

// ── Inactivity lock timing ───────────────────────────────────────────────────

/** Idle window before the portal auto-locks (logout + MFA re-challenge). */
export const ADMIN_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/** Max age (seconds) of an MFA verification for a dangerous step-up action. */
export const ADMIN_STEP_UP_MAX_AGE_SECONDS = 5 * 60; // 5 minutes

/** Pure predicate: has the session been idle past the lock threshold? */
export function shouldLockForInactivity(
  lastActivityMs: number,
  nowMs: number,
  timeoutMs: number = ADMIN_INACTIVITY_TIMEOUT_MS
): boolean {
  return nowMs - lastActivityMs >= timeoutMs;
}

/**
 * Sanitize a post-MFA redirect target so an attacker can't bounce the founder
 * to an external origin. Only same-origin `/admin…` paths are allowed.
 */
export function safeAdminNext(next: string | null | undefined): string {
  if (!next) return "/admin";
  // Must be a root-relative admin path — never a protocol-relative or absolute URL.
  if (!next.startsWith("/admin")) return "/admin";
  if (next.startsWith("//")) return "/admin";
  return next;
}
