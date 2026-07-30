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
  auditPersistenceAvailable: boolean;
  privacyBackendDeployed: boolean;
  environment: string;
  commit: string | null;
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

  // Bounded, read-only Supabase connectivity probe (no data returned).
  let connected = false;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("universities").select("id", { head: true, count: "exact" }).limit(1);
    connected = !error;
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
    auditPersistenceAvailable: false, // no canonical admin_audit table yet (Audit History)
    privacyBackendDeployed: false, // migration 051 not deployed
    environment: process.env.NODE_ENV ?? "unknown",
    commit: process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8) : null,
    supabase: { connected, url_host: hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL) },
    vercelEnv: process.env.VERCEL_ENV ?? null,
    env: envPresence(),
  };
}
