"use server";

// ============================================================================
// Admin Dashboard — App Releases actions  (SERVER-ONLY)
// ============================================================================
//
// One action: publish a version. This does NOT go through runAtomicMutation
// (the migration-056 admin_tx_* convention) or the formal admin_audit_events
// trail — both require registering a new entry in the admin_audit_actions
// database catalog (auditSanitize.ts's own comment: it "MUST stay in
// lockstep with the admin_audit_actions catalog seeded by migration 055"),
// which is a schema/migration change out of scope here. publish_app_release()
// (migration 090) already carries its own real, independent authorization
// check (is_platform_admin_auth on auth.uid()) — this action adds the
// dashboard's own step-up gate on top, matching the bar this codebase uses
// for other consequential, hard-to-undo mutations (it fans out a real push
// to every user with an active token on the target platform).
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/appReleasesActions.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireRecentMfaWrite } from "./secureAdmin";
import type { ActionResult } from "./actions";
import type { Platform } from "./appReleasesData";

const VALID_PLATFORMS: Platform[] = ["ios", "android"];
// Loose dotted-numeric shape (e.g. "1.0.4") — the exact same shape
// apps/mobile/hooks/useAppUpdateStatus.ts already expects and compares.
const VERSION_RE = /^\d+(\.\d+){0,3}$/;

export async function publishAppRelease(platform: string, version: string): Promise<ActionResult<{ platform: Platform; version: string }>> {
  const actor = await requireRecentMfaWrite();

  const cleanVersion = (version ?? "").trim();
  if (!VALID_PLATFORMS.includes(platform as Platform)) {
    return { ok: false, error: "Invalid platform." };
  }
  if (!VERSION_RE.test(cleanVersion)) {
    return { ok: false, error: "Version must be a dotted number, e.g. 1.0.4." };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("publish_app_release", {
    p_platform: platform,
    p_version: cleanVersion,
  });

  // Operational-only trace (see file header for why this is not the formal
  // audit trail): who published what, when. Never a secret, never PII beyond
  // the administrator's own already-known id.
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      tag: "admin_app_release_publish",
      ts: new Date().toISOString(),
      actorId: actor.id,
      platform,
      version: cleanVersion,
      ok: !error,
      error: error?.message,
    })
  );

  if (error) {
    return { ok: false, error: "Could not publish this release. It may already be published." };
  }

  return { ok: true, data: { platform: platform as Platform, version: cleanVersion } };
}

export interface StoreSyncResult {
  checks: Array<{
    platform: Platform;
    checkedAt: string;
    detectedVersion: string | null;
    ok: boolean;
    error: string | null;
    changed: boolean;
  }>;
}

/** Run the protected store poller on demand; the Edge Function remains the
 * only place that can turn a verified store result into a public row.
 *
 * Server-to-server only: this "use server" action calls the function with the
 * dedicated store-sync Secret API key in the `apikey` header. STORE_SYNC_API_KEY
 * is a server-only env var (no NEXT_PUBLIC_ prefix) — it is never bundled to,
 * or reachable from, the browser, and is the SAME key pg_cron presents from
 * Vault. The legacy service_role key is not used for this hop. */
export async function checkStoreVersions(): Promise<ActionResult<StoreSyncResult>> {
  const actor = await requireRecentMfaWrite();

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const apiKey = process.env.STORE_SYNC_API_KEY;
  if (!baseUrl || !apiKey) {
    return { ok: false, error: "Store sync is not configured." };
  }

  let data: unknown;
  try {
    const response = await fetch(`${baseUrl}/functions/v1/sync-store-versions`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ tag: "admin_app_release_store_check", ts: new Date().toISOString(), actorId: actor.id, ok: false, http: response.status }));
      return { ok: false, error: "Store sync did not complete." };
    }
    data = await response.json();
  } catch {
    return { ok: false, error: "Could not reach the store sync function." };
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as { checks?: unknown }).checks)) {
    // Operational trace contains only the actor id and outcome; no credential
    // or function error payload is logged or returned to the browser.
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ tag: "admin_app_release_store_check", ts: new Date().toISOString(), actorId: actor.id, ok: false }));
    return { ok: false, error: "Store sync did not complete." };
  }

  const checks = (data as { checks: unknown[] }).checks.filter((item): item is StoreSyncResult["checks"][number] => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (value.platform === "ios" || value.platform === "android")
      && typeof value.checkedAt === "string"
      && (value.detectedVersion === null || typeof value.detectedVersion === "string")
      && typeof value.ok === "boolean"
      && (value.error === null || typeof value.error === "string")
      && typeof value.changed === "boolean";
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ tag: "admin_app_release_store_check", ts: new Date().toISOString(), actorId: actor.id, ok: true, changed: checks.filter((check) => check.changed).length }));
  return { ok: true, data: { checks } };
}
