// ============================================================================
// Admin Dashboard — central secure authorization gate  (SERVER-ONLY)
// ============================================================================
//
// `requireSecureAdmin()` is THE authorization contract for every admin page,
// data loader, global search, Server Action and Route Handler. It verifies, in
// order (fail-closed at each step):
//
//   1. ADMIN_PORTAL_ENABLED === "true"      (portal kill switch)
//   2. a valid Supabase-authenticated user  (validated JWT, never client input)
//   3. the immutable user id is allowlisted  (email alone never grants)
//   4. optional email consistency check      (AND, configured via env)
//   5. the session is within ADMIN_SESSION_MAX_AGE_MINUTES  (absolute age,
//      measured server-side from the signed amr claim — see adminEnv.ts)
//   6. the session assurance level is aal2   (MFA enforced server-side)
//   7. for writes, ADMIN_WRITES_ENABLED === "true"  (write kill switch)
//
// Only AFTER all checks pass may a caller construct the service-role client.
// Because every loader/action calls this itself BEFORE createAdminClient(), a
// non-founder / aal1 / portal-off request can never cause the service-role key
// to be used. The layout gate and middleware routing are defense-in-DEPTH, not
// the sole barrier.
//
// This module must NEVER be imported from a Client Component or from Edge
// middleware (it pulls next/headers via the SSR client). Middleware uses the
// pure primitives in `adminEnv.ts` instead.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error(
    "lib/admin/secureAdmin.ts is server-only and must not be imported in the browser."
  );
}

import { createClient } from "../supabase/server";
import type { User } from "@supabase/supabase-js";
import {
  isPortalEnabled,
  isWritesEnabled,
  isAllowlistedAdmin,
  meetsAdminAssurance,
  hasRecentMfa,
  isAdminSessionExpired,
  adminSessionMaxAgeSeconds,
  adminSessionMaxAgeMs,
  adminSessionRemainingMs,
  ADMIN_STEP_UP_MAX_AGE_SECONDS,
  type AuthMethodEntry,
} from "./adminEnv";

export type SecureAdminReason =
  | "portal_disabled"
  | "unauthenticated"
  | "denied"
  | "session_expired"
  | "mfa_required"
  | "writes_disabled"
  | "stepup_required";

const REASON_MESSAGE: Record<SecureAdminReason, string> = {
  portal_disabled: "The admin portal is currently unavailable.",
  unauthenticated: "Not authenticated.",
  denied: "Not authorized for admin access.",
  // Deliberately says nothing about when the session started, how long the
  // window is, or how much of it remains — an expired administrator is an
  // unauthorized caller and gets no internal security detail.
  session_expired: "Your administrator session has expired. Sign in again.",
  mfa_required: "Multi-factor authentication (aal2) is required for admin access.",
  writes_disabled: "Admin write operations are currently disabled.",
  stepup_required: "This action requires a recent multi-factor verification.",
};

/** Thrown by the secure gate when a request is not permitted. */
export class SecureAdminError extends Error {
  constructor(public readonly reason: SecureAdminReason) {
    super(REASON_MESSAGE[reason]);
    this.name = "SecureAdminError";
  }
  /** HTTP status a Route Handler should return for this reason. */
  get httpStatus(): number {
    return this.reason === "unauthenticated" ? 401 : 403;
  }
}

// ── Session assurance resolution ──────────────────────────────────────────────

interface Assurance {
  user: User | null;
  currentLevel: string | null;
  nextLevel: string | null;
  methods: AuthMethodEntry[];
}

/**
 * Resolve the validated user AND the session's MFA assurance level. Identity
 * always comes from `getUser()` (validates the JWT against the auth server);
 * the assurance level + amr come from the same session token.
 */
async function resolveAssurance(
  supabase: ReturnType<typeof createClient>
): Promise<Assurance> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, currentLevel: null, nextLevel: null, methods: [] };

  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return {
    user,
    currentLevel: data?.currentLevel ?? null,
    nextLevel: data?.nextLevel ?? null,
    methods: (data?.currentAuthenticationMethods ?? []) as AuthMethodEntry[],
  };
}

// ── Non-throwing context (for the layout + MFA page shells) ───────────────────

export type SecureAdminStatus =
  | "portal_disabled"
  | "unauthenticated"
  | "denied"
  | "session_expired"
  | "mfa_required"
  | "authorized";

export interface SecureAdminContext {
  status: SecureAdminStatus;
  user: User | null;
  /** aal1 while a second factor is enrolled but not yet satisfied this session. */
  currentLevel: string | null;
  /** aal2 when a verified factor exists (so the UI can offer "challenge"). */
  nextLevel: string | null;
  /**
   * Epoch ms at which this session hits its absolute maximum age — supplied ONLY
   * for an authorized founder, so the dashboard can show an honest countdown and
   * lock itself at the true deadline. Null in every unauthorized state, so no
   * session timing is ever disclosed to a caller who is not the founder.
   */
  sessionExpiresAtMs: number | null;
}

/**
 * Resolve the current request's secure-admin status without throwing. Used by
 * the /admin layout and the MFA page to render the correct shell (unavailable /
 * login / access-denied / expired / MFA challenge / dashboard).
 */
export async function getSecureAdminContext(): Promise<SecureAdminContext> {
  const base = { sessionExpiresAtMs: null } as const;
  if (!isPortalEnabled()) {
    return { status: "portal_disabled", user: null, currentLevel: null, nextLevel: null, ...base };
  }
  const supabase = createClient();
  const { user, currentLevel, nextLevel, methods } = await resolveAssurance(supabase);

  if (!user) return { status: "unauthenticated", user: null, currentLevel, nextLevel, ...base };
  if (!isAllowlistedAdmin(user)) return { status: "denied", user, currentLevel, nextLevel, ...base };

  // Absolute session age is checked BEFORE assurance: an aged session must be
  // told to sign in again, not sent around the MFA loop (re-verifying TOTP on
  // the same session cannot reset its age — see adminEnv.ts).
  if (isAdminSessionExpired(methods, Math.floor(Date.now() / 1000), adminSessionMaxAgeSeconds())) {
    return { status: "session_expired", user, currentLevel, nextLevel, ...base };
  }
  if (!meetsAdminAssurance(currentLevel)) {
    return { status: "mfa_required", user, currentLevel, nextLevel, ...base };
  }
  return {
    status: "authorized",
    user,
    currentLevel,
    nextLevel,
    sessionExpiresAtMs: Date.now() + adminSessionRemainingMs(methods, Date.now(), adminSessionMaxAgeMs()),
  };
}

// ── The enforcement contract ──────────────────────────────────────────────────

/**
 * Enforce secure admin access for a data loader, Server Action or Route Handler.
 * Returns the validated administrator `User` or throws `SecureAdminError`.
 *
 * Pass `{ write: true }` for any privileged mutation — it additionally requires
 * the write kill switch (`ADMIN_WRITES_ENABLED`) to be enabled.
 *
 * The service-role client must only be constructed AFTER this resolves.
 */
export async function requireSecureAdmin(opts?: { write?: boolean }): Promise<User> {
  if (!isPortalEnabled()) throw new SecureAdminError("portal_disabled");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new SecureAdminError("unauthenticated");
  if (!isAllowlistedAdmin(user)) throw new SecureAdminError("denied");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const methods = (aal?.currentAuthenticationMethods ?? []) as AuthMethodEntry[];

  // Absolute maximum session age — enforced here, at the single choke point every
  // page, loader, Server Action and Route Handler passes through, so it covers
  // reads and writes alike (including sensitive reveal/search, which layer their
  // own 5-minute step-up freshness bound on top via requireRecentMfa).
  if (isAdminSessionExpired(methods, Math.floor(Date.now() / 1000), adminSessionMaxAgeSeconds())) {
    throw new SecureAdminError("session_expired");
  }

  if (!meetsAdminAssurance(aal?.currentLevel)) throw new SecureAdminError("mfa_required");

  if (opts?.write && !isWritesEnabled()) throw new SecureAdminError("writes_disabled");

  return user;
}

/**
 * Step-up guard for future DANGEROUS operations (user deletion/suspension, bulk
 * actions, club deletion, permanent purge, viewing retained evidence, restoring
 * deleted messages, adding administrators). On top of a full secure-admin check,
 * it requires that a TOTP factor was re-verified within the step-up window.
 *
 * The guard exists now so those actions can adopt it the moment they ship; the
 * actions themselves remain disabled for Day 3.
 */
export async function requireRecentMfa(
  maxAgeSeconds: number = ADMIN_STEP_UP_MAX_AGE_SECONDS
): Promise<User> {
  const user = await requireSecureAdmin();
  const supabase = createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const methods = (aal?.currentAuthenticationMethods ?? []) as AuthMethodEntry[];
  if (!hasRecentMfa(methods, Math.floor(Date.now() / 1000), maxAgeSeconds)) {
    throw new SecureAdminError("stepup_required");
  }
  return user;
}

// Re-export the pure kill-switch readers so callers have a single import site.
export { isPortalEnabled, isWritesEnabled } from "./adminEnv";
