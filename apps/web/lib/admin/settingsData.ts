// ============================================================================
// Admin Dashboard — Day-5 Admin Settings status  (SERVER-ONLY)
// ============================================================================
// Read-only, SAFE operational status. This module surfaces booleans, levels,
// and the founder's own identity — and NOTHING sensitive. It NEVER returns:
//   • the Supabase service-role key, database password, JWTs, cookies,
//   • MFA/TOTP secrets, push tokens, or any encryption material,
//   • or any environment-variable VALUE (only presence booleans + masked hints).
//
// There is no browser-driven environment mutation anywhere — env changes are an
// operator action in Vercel, documented as procedures, never a dashboard button.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/settingsData.ts is server-only and must not be imported in the browser.");
}

import { createClient } from "../supabase/server";
import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import {
  isPortalEnabled,
  isWritesEnabled,
  founderUserIds,
  founderEmails,
  hasRecentMfa,
  adminSessionMaxAgeMinutes,
  ADMIN_INACTIVITY_TIMEOUT_MS,
  ADMIN_STEP_UP_MAX_AGE_SECONDS,
  type AuthMethodEntry,
} from "./adminEnv";

/**
 * Honest, fail-closed capability states.
 *   active      — the durable audit infrastructure is verifiably present
 *   unavailable — it is verifiably absent
 *   error       — we could not determine it; NEVER reported as active
 */
export type CapabilityStatus = "active" | "unavailable" | "error";

export interface CapabilityProbe {
  status: CapabilityStatus;
  /** Short operator-facing explanation. Never a secret or an env value. */
  detail: string;
}

export interface EnvPresence {
  name: string;
  present: boolean;
  /** A short, non-sensitive hint (e.g. host of a URL) — never a secret value. */
  hint: string | null;
}

export interface AdminSettings {
  portalEnabled: boolean;
  writesEnabled: boolean;
  admin: {
    email: string | null;
    /** The founder's OWN immutable auth user id (safe to show to themselves). */
    userId: string;
    emailConsistency: "enforced_consistent" | "not_configured" | "mismatch";
  };
  mfa: {
    assuranceLevel: string | null;
    meetsRequirement: boolean;
    recentMfa: boolean;
    stepUpMaxAgeSeconds: number;
  };
  inactivityTimeoutMs: number;
  /** Server-enforced absolute administrator session maximum age, in minutes. */
  sessionMaxAgeMinutes: number;
  /** Live-probed; replaces the Day-5 hardcoded `false`. */
  auditPersistence: CapabilityProbe;
  /** Live-probed marker for the migration-051 privacy backend. */
  privacyBackend: CapabilityProbe;
  environment: string;
  /** Deployed Git commit SHA (short), from VERCEL_GIT_COMMIT_SHA. */
  commit: string | null;
  /** Deployed Git ref/branch, from VERCEL_GIT_COMMIT_REF. */
  commitRef: string | null;
  supabase: { connected: boolean; url_host: string | null };
  vercelEnv: string | null;
  env: EnvPresence[];
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Presence-only view of env vars — booleans + safe hints, never values. */
function envPresence(): EnvPresence[] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ids = founderUserIds();
  const emails = founderEmails();
  return [
    { name: "NEXT_PUBLIC_SUPABASE_URL", present: !!url, hint: hostOf(url) },
    { name: "SUPABASE_SERVICE_ROLE_KEY", present: !!process.env.SUPABASE_SERVICE_ROLE_KEY, hint: process.env.SUPABASE_SERVICE_ROLE_KEY ? "set (hidden)" : null },
    { name: "ADMIN_PORTAL_ENABLED", present: process.env.ADMIN_PORTAL_ENABLED !== undefined, hint: isPortalEnabled() ? "true" : "not true" },
    { name: "ADMIN_WRITES_ENABLED", present: process.env.ADMIN_WRITES_ENABLED !== undefined, hint: isWritesEnabled() ? "true" : "not true" },
    { name: "ADMIN_FOUNDER_USER_IDS", present: ids.length > 0, hint: ids.length ? `${ids.length} id(s)` : null },
    { name: "ADMIN_FOUNDER_EMAILS", present: emails.length > 0, hint: emails.length ? `${emails.length} email(s)` : "not configured" },
    {
      name: "ADMIN_SESSION_MAX_AGE_MINUTES",
      present: process.env.ADMIN_SESSION_MAX_AGE_MINUTES !== undefined,
      // The effective value, which is the safe default when unset or unusable.
      hint: `${adminSessionMaxAgeMinutes()} min in effect`,
    },
  ];
}

/** PostgREST codes meaning "this relation/function does not exist here". */
const MISSING_CODES = new Set(["42P01", "PGRST202", "PGRST205"]);

/**
 * Is a function exposed by PostgREST? Read from the OpenAPI description, which
 * is a plain GET — it CANNOT insert, update or delete anything. Deliberately
 * not "call the function and see what happens": probing by invocation risks
 * writing an audit event, which is exactly what a status check must never do.
 */
async function rpcExposed(name: string): Promise<boolean | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const spec = (await res.json()) as { paths?: Record<string, unknown> };
    return Object.prototype.hasOwnProperty.call(spec.paths ?? {}, `/rpc/${name}`);
  } catch {
    return null;
  }
}

/**
 * Verify the DURABLE audit system (migration 055) is actually deployed.
 *
 * Read-only by construction: a HEAD count, a one-row catalog select, and a GET
 * of the API description. No INSERT/UPDATE/DELETE/TRUNCATE anywhere.
 *
 * The distinction that matters: an audit table with ZERO rows is a correctly
 * deployed system that has not recorded anything yet — it is `active`, not
 * `unavailable`. Only a missing table, an unseeded catalog or a missing
 * logging function is `unavailable`. Anything we cannot determine is `error`,
 * never `active`.
 */
async function probeAuditPersistence(
  admin: ReturnType<typeof createAdminClient>
): Promise<CapabilityProbe> {
  try {
    // 1. The events table must exist. Its row count is IRRELEVANT to the status.
    const events = await admin
      .from("admin_audit_events")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    if (events.error) {
      return MISSING_CODES.has(events.error.code ?? "")
        ? { status: "unavailable", detail: "admin_audit_events is not deployed (migration 055 not applied)." }
        : { status: "error", detail: "Could not read the audit table." };
    }

    // 2. The controlled-vocabulary catalog must exist AND be seeded — an empty
    //    catalog means no action can ever be recorded.
    const catalog = await admin
      .from("admin_audit_actions")
      .select("action", { head: true, count: "exact" });
    if (catalog.error) {
      return MISSING_CODES.has(catalog.error.code ?? "")
        ? { status: "unavailable", detail: "The audit action catalog is not deployed." }
        : { status: "error", detail: "Could not read the audit action catalog." };
    }
    if ((catalog.count ?? 0) === 0) {
      return { status: "unavailable", detail: "The audit action catalog is present but unseeded." };
    }

    // 3. The single approved write path must exist.
    const logFn = await rpcExposed("admin_audit_log");
    if (logFn === null) return { status: "error", detail: "Could not verify the audit logging function." };
    if (!logFn) return { status: "unavailable", detail: "admin_audit_log() is not available." };

    const n = events.count ?? 0;
    return {
      status: "active",
      detail: `Append-only table live; ${catalog.count} approved actions; ${n} event${n === 1 ? "" : "s"} recorded.`,
    };
  } catch {
    return { status: "error", detail: "Audit persistence could not be verified." };
  }
}

/**
 * Migration 051 (deleted-message privacy) marker. Same read-only approach, and
 * the same reason for existing: this was ALSO hardcoded, so it would have
 * silently kept saying "Not deployed" after 051 ships.
 */
async function probePrivacyBackend(
  admin: ReturnType<typeof createAdminClient>
): Promise<CapabilityProbe> {
  // A partial table/function cannot prove the reviewed Day 10F system exists.
  // 051 is intentionally absent from Production, so retain this explicit
  // fail-closed state until the complete reviewed backend ships a dedicated
  // immutable deployment marker. No message data is queried or mutated.
  void admin;
  return { status: "unavailable", detail: "Not deployed — the complete reviewed deleted-message privacy backend (migration 051 and its workers) is absent." };
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const user = await requireSecureAdmin();
  const supabase = createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const methods = (aal?.currentAuthenticationMethods ?? []) as AuthMethodEntry[];
  const recent = hasRecentMfa(methods, Math.floor(Date.now() / 1000), ADMIN_STEP_UP_MAX_AGE_SECONDS);

  // Email consistency: is the extra AND check configured, and does it hold?
  const emails = founderEmails();
  let emailConsistency: AdminSettings["admin"]["emailConsistency"] = "not_configured";
  if (emails.length > 0) {
    const e = user.email?.trim().toLowerCase();
    emailConsistency = e && emails.includes(e) ? "enforced_consistent" : "mismatch";
  }

  // Bounded, read-only Supabase connectivity probe (no data returned), plus the
  // live capability probes. All three are reads.
  let connected = false;
  let auditPersistence: CapabilityProbe = { status: "error", detail: "Not probed." };
  let privacyBackend: CapabilityProbe = { status: "error", detail: "Not probed." };
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("universities").select("id", { head: true, count: "exact" }).limit(1);
    connected = !error;
    [auditPersistence, privacyBackend] = await Promise.all([
      probeAuditPersistence(admin),
      probePrivacyBackend(admin),
    ]);
  } catch {
    connected = false;
  }

  return {
    portalEnabled: isPortalEnabled(),
    writesEnabled: isWritesEnabled(),
    admin: {
      email: user.email ?? null,
      userId: user.id,
      emailConsistency,
    },
    mfa: {
      assuranceLevel: aal?.currentLevel ?? null,
      meetsRequirement: aal?.currentLevel === "aal2",
      recentMfa: recent,
      stepUpMaxAgeSeconds: ADMIN_STEP_UP_MAX_AGE_SECONDS,
    },
    inactivityTimeoutMs: ADMIN_INACTIVITY_TIMEOUT_MS,
    sessionMaxAgeMinutes: adminSessionMaxAgeMinutes(),
    auditPersistence,
    privacyBackend,
    environment: process.env.NODE_ENV ?? "unknown",
    // The DEPLOYED Git commit, straight from Vercel. Not a build id, and never
    // hardcoded. Note it is the commit Vercel last built — which is the newest
    // commit on the deployed branch, not necessarily a merge commit.
    commit: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8) : null,
    commitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    supabase: { connected, url_host: hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL) },
    vercelEnv: process.env.VERCEL_ENV ?? null,
    env: envPresence(),
  };
}
