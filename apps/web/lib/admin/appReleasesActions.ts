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
