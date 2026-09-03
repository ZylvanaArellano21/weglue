// Poll public store metadata and project only verified public releases into
// app_releases. Android intentionally remains manual-only: the Play Developer
// API is authenticated and track-oriented, while scraping public listing HTML
// is not a stable enough source for an update badge.
//
// The bearer must be a valid service-role JWT in the deployed project because
// this task is not allowed to add a supabase/config.toml verify_jwt=false entry.
// It is compared to SYNC_STORE_VERSIONS_SECRET and never logged or returned.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const IOS_BUNDLE_LOOKUP = "https://itunes.apple.com/lookup?bundleId=com.weglue.app";
const IOS_ID_LOOKUP = "https://itunes.apple.com/lookup?id=6786491344";
const ANDROID_MANUAL_ONLY = "android_store_detection_manual_only";
const CHECK_TIMEOUT_MS = 12_000;

type Platform = "ios" | "android";

type StoreCheckResult = {
  platform: Platform;
  checkedAt: string;
  detectedVersion: string | null;
  ok: boolean;
  error: string | null;
  changed: boolean;
};

type ItunesResult = {
  version?: unknown;
  trackViewUrl?: unknown;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function safeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return message
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .slice(0, 240);
}

function parseSemver(value: string): { major: number; minor: number; patch: number; prerelease: string[] } {
  const match = value.trim().replace(/^v/i, "").match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) throw new Error("invalid_semver");
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const av = a.prerelease[i];
    const bv = b.prerelease[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av === bv) continue;
    const an = /^\d+$/.test(av);
    const bn = /^\d+$/.test(bv);
    if (an && bn) return Number(av) > Number(bv) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

async function fetchJson(url: string): Promise<{ results?: ItunesResult[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`itunes_http_${response.status}`);
    const payload = await response.json() as { results?: ItunesResult[] };
    if (!Array.isArray(payload.results)) throw new Error("itunes_invalid_response");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupIos(): Promise<{ version: string; storeUrl: string }> {
  let payload: { results?: ItunesResult[] };
  try {
    const bundlePayload = await fetchJson(IOS_BUNDLE_LOOKUP);
    payload = bundlePayload.results?.length ? bundlePayload : await fetchJson(IOS_ID_LOOKUP);
  } catch {
    payload = await fetchJson(IOS_ID_LOOKUP);
  }
  const result = payload.results?.[0];
  const version = typeof result?.version === "string" ? result.version.trim() : "";
  const storeUrl = typeof result?.trackViewUrl === "string" ? result.trackViewUrl.trim() : "";
  if (!version || !storeUrl) throw new Error("itunes_missing_public_release_fields");
  parseSemver(version);
  return { version, storeUrl };
}

async function latestPublicRelease(admin: SupabaseClient, platform: Platform): Promise<string | null> {
  const { data, error } = await admin
    .from("app_releases")
    .select("version")
    .eq("platform", platform)
    .eq("is_public", true)
    .order("released_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("database_latest_release_failed");
  return typeof data?.version === "string" ? data.version : null;
}

async function recordCheck(
  admin: SupabaseClient,
  result: Omit<StoreCheckResult, "checkedAt" | "changed">,
): Promise<string> {
  const checkedAt = new Date().toISOString();
  const { error } = await admin.from("app_release_store_checks").insert({
    platform: result.platform,
    checked_at: checkedAt,
    detected_version: result.detectedVersion,
    ok: result.ok,
    error: result.error,
  });
  if (error) throw new Error("database_check_record_failed");
  return checkedAt;
}

async function checkIos(admin: SupabaseClient): Promise<StoreCheckResult> {
  let detectedVersion: string | null = null;
  let error: string | null = null;
  let changed = false;
  try {
    const store = await lookupIos();
    detectedVersion = store.version;
    const current = await latestPublicRelease(admin, "ios");
    if (current !== null && compareSemver(store.version, current) <= 0) {
      // The public store is current or older than the manually published row.
    } else {
      const { error: syncError } = await admin.rpc("sync_store_app_release", {
        p_platform: "ios",
        p_version: store.version,
        p_store_url: store.storeUrl,
      });
      if (syncError) throw new Error("database_store_release_sync_failed");
      changed = true;
    }
  } catch (caught) {
    error = safeError(caught, "ios_store_check_failed");
  }
  const checkedAt = await recordCheck(admin, {
    platform: "ios",
    detectedVersion,
    ok: error === null,
    error,
  });
  return { platform: "ios", checkedAt, detectedVersion, ok: error === null, error, changed };
}

async function checkAndroidManualOnly(admin: SupabaseClient): Promise<StoreCheckResult> {
  const checkedAt = await recordCheck(admin, {
    platform: "android",
    detectedVersion: null,
    ok: false,
    error: ANDROID_MANUAL_ONLY,
  });
  return {
    platform: "android",
    checkedAt,
    detectedVersion: null,
    ok: false,
    error: ANDROID_MANUAL_ONLY,
    changed: false,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("SYNC_STORE_VERSIONS_SECRET");
  const authorization = req.headers.get("Authorization") ?? "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expectedSecret || !bearer || bearer !== expectedSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return json({ error: "Function is not configured" }, 503);
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const checks: StoreCheckResult[] = [];
  try {
    checks.push(await checkIos(admin));
    checks.push(await checkAndroidManualOnly(admin));
  } catch (error) {
    // A failed check-row write is operationally distinct from a store failure;
    // return a generic status and keep credentials/database errors out of logs.
    console.error(JSON.stringify({
      tag: "sync_store_versions",
      ok: false,
      error: safeError(error, "store_sync_failed"),
    }));
    return json({ error: "Store sync failed" }, 500);
  }

  return json({
    ok: checks.every((check) => check.ok || check.error === ANDROID_MANUAL_ONLY),
    checks: checks.map(({ platform, checkedAt, detectedVersion, ok, error, changed }) => ({
      platform,
      checkedAt,
      detectedVersion,
      ok,
      error,
      changed,
    })),
  });
});
