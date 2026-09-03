// ============================================================================
// Admin Dashboard — App Releases data loader  (SERVER-ONLY)
// ============================================================================
//
// Read-only. `app_releases` (migrations 090/116) has no client write policy at
// all — only publish_app_release() (SECURITY DEFINER) or a service-role/
// superuser session can write — so this loader never needs write access; the
// service-role client here is used purely to read past RLS's is_public=true
// filter, exactly the way every other admin data loader in this file family
// reads rows an ordinary client policy would not expose.
// ============================================================================

if (typeof window !== "undefined") {
  throw new Error("lib/admin/appReleasesData.ts is server-only and must not be imported in the browser.");
}

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";

export type Platform = "ios" | "android";

export interface AppReleaseRow {
  id: string;
  platform: Platform;
  version: string;
  isPublic: boolean;
  releasedAt: string | null;
  createdAt: string;
  source: "manual" | "store";
  storeUrl: string | null;
}

export interface AppReleaseStoreCheck {
  platform: Platform;
  checkedAt: string;
  detectedVersion: string | null;
  ok: boolean;
  error: string | null;
}

export interface AppReleasesOverview {
  releases: AppReleaseRow[];
  /** The current publicly-downloadable version per platform, or null if none yet. */
  currentByPlatform: Record<Platform, string | null>;
  lastCheckByPlatform: Record<Platform, AppReleaseStoreCheck | null>;
}

export async function getAppReleasesOverview(): Promise<AppReleasesOverview> {
  await requireSecureAdmin();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("app_releases")
    .select("id, platform, version, is_public, released_at, created_at, source, store_url")
    .order("platform", { ascending: true })
    .order("released_at", { ascending: false, nullsFirst: false });

  const rows = (error || !data ? [] : data) as {
    id: string;
    platform: Platform;
    version: string;
    is_public: boolean;
    released_at: string | null;
    created_at: string;
    source: "manual" | "store";
    store_url: string | null;
  }[];

  const releases: AppReleaseRow[] = rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    version: r.version,
    isPublic: r.is_public,
    releasedAt: r.released_at,
    createdAt: r.created_at,
    source: r.source,
    storeUrl: r.store_url,
  }));

  const { data: checkData } = await admin
    .from("app_release_store_checks")
    .select("platform, checked_at, detected_version, ok, error")
    .order("checked_at", { ascending: false })
    .limit(100);

  const lastCheckByPlatform: Record<Platform, AppReleaseStoreCheck | null> = { ios: null, android: null };
  for (const row of (checkData ?? []) as {
    platform: Platform;
    checked_at: string;
    detected_version: string | null;
    ok: boolean;
    error: string | null;
  }[]) {
    if (lastCheckByPlatform[row.platform] === null) {
      lastCheckByPlatform[row.platform] = {
        platform: row.platform,
        checkedAt: row.checked_at,
        detectedVersion: row.detected_version,
        ok: row.ok,
        error: row.error,
      };
    }
  }

  const currentByPlatform: Record<Platform, string | null> = { ios: null, android: null };
  for (const r of releases) {
    if (r.isPublic && currentByPlatform[r.platform] === null) {
      // First match per platform wins: rows are already ordered by
      // released_at DESC, so this is the most recent public release.
      currentByPlatform[r.platform] = r.version;
    }
  }

  return { releases, currentByPlatform, lastCheckByPlatform };
}
