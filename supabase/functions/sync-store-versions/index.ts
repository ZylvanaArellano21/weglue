// Poll public App Store and Google Play metadata and project only verified
// public releases into app_releases. Google Play is read through the official
// Android Publisher API: the function creates an edit, reads production, and
// always abandons the edit without committing it.
//
// Auth (verify_jwt = false in supabase/config.toml — this check is the sole
// gate): the caller must present the dedicated store-sync Secret API key in
// the `apikey` header. pg_cron reads it from Vault (store_version_sync_api_key);
// the Admin Dashboard's server action reads it from a server-only env var
// (STORE_SYNC_API_KEY). It is never a client credential and never the legacy
// service_role JWT. This endpoint is never called by a browser or a device.
//
// Env (Supabase function secrets):
//   STORE_SYNC_API_KEY        — the shared Secret API key checked above (required)
//   PLAY_ANDROID_PUBLISHER_KEY — Google service-account JSON (optional; Android
//                                detection is skipped, not failed, without it)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-injected; the function's own
//                                DB identity for the app_releases writes

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { authorizedServiceCaller } from "./auth.ts";

const IOS_BUNDLE_LOOKUP = "https://itunes.apple.com/lookup?bundleId=com.weglue.app";
const IOS_ID_LOOKUP = "https://itunes.apple.com/lookup?id=6786491344";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const GOOGLE_API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const ANDROID_STORE_URL = "https://play.google.com/store/apps/details?id=com.weglue.app";
const ANDROID_NOT_CONFIGURED = "android_play_api_not_configured";
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

type ItunesResult = { version?: unknown; trackViewUrl?: unknown };
type ServiceAccount = { client_email: string; private_key: string };
type AndroidPlayRelease = { status?: unknown; versionCodes?: unknown; name?: unknown };

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

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToBytes(pem: string): Uint8Array {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  return base64UrlDecode(base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""));
}

function parseServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get("PLAY_ANDROID_PUBLISHER_KEY");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof value.client_email !== "string" || typeof value.private_key !== "string") return null;
    return value as ServiceAccount;
  } catch {
    return null;
  }
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
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
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

type PublicRelease = { version: string | null; buildNumber: number | null };

async function latestPublicRelease(admin: SupabaseClient, platform: Platform): Promise<PublicRelease | null> {
  const { data, error } = await admin
    .from("app_releases")
    .select("version, build_number")
    .eq("platform", platform)
    .eq("is_public", true)
    .order("released_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("database_latest_release_failed");
  if (!data) return null;
  return {
    version: typeof data.version === "string" ? data.version : null,
    buildNumber: Number.isSafeInteger(data.build_number) ? Number(data.build_number) : null,
  };
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
    if (!current || !current.version || compareSemver(store.version, current.version) > 0) {
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

async function signServiceAccountAssertion(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({
    iss: account.client_email,
    scope: GOOGLE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function androidAccessToken(account: ServiceAccount): Promise<string> {
  const assertion = await signServiceAccountAssertion(account);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`google_oauth_http_${response.status}`);
  const payload = await response.json() as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("google_oauth_missing_access_token");
  }
  return payload.access_token;
}

async function googleJson(url: string, accessToken: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`google_play_http_${response.status}`);
  return await response.json() as Record<string, unknown>;
}

async function readAndroidProduction(account: ServiceAccount): Promise<{ buildNumber: number; version: string | null }> {
  const accessToken = await androidAccessToken(account);
  const appPath = `${GOOGLE_API_BASE}/applications/com.weglue.app`;
  const edit = await googleJson(`${appPath}/edits`, accessToken, { method: "POST", body: "{}" });
  const editId = typeof edit.id === "string" ? edit.id : "";
  if (!editId) throw new Error("google_play_missing_edit_id");

  let result: { buildNumber: number; version: string | null } | null = null;
  let operationError: unknown = null;
  try {
    const track = await googleJson(`${appPath}/edits/${encodeURIComponent(editId)}/tracks/production`, accessToken);
    const releases = Array.isArray(track.releases) ? track.releases as AndroidPlayRelease[] : [];
    const completed = releases.filter((release) => release.status === "completed");
    for (const release of completed) {
      const releaseVersionCodes = (Array.isArray(release.versionCodes) ? release.versionCodes : [])
        .map((value) => typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN)
        .filter((value) => Number.isSafeInteger(value));
      if (!releaseVersionCodes.length) continue;
      const releaseBuildNumber = Math.max(...releaseVersionCodes);
      if (!result || releaseBuildNumber > result.buildNumber) {
        const releaseName = typeof release.name === "string" && /^\d+(\.\d+){1,3}$/.test(release.name)
          ? release.name
          : null;
        result = { buildNumber: releaseBuildNumber, version: releaseName };
      }
    }
    if (!result) throw new Error("google_play_no_completed_production_release");
  } catch (error) {
    operationError = error;
  } finally {
    try {
      const response = await fetch(`${appPath}/edits/${encodeURIComponent(editId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok && operationError === null) operationError = new Error(`google_play_abandon_http_${response.status}`);
    } catch (error) {
      if (operationError === null) operationError = error;
    }
  }
  if (operationError) throw operationError;
  if (!result) throw new Error("google_play_read_failed");
  return result;
}

async function checkAndroid(admin: SupabaseClient): Promise<StoreCheckResult> {
  const account = parseServiceAccount();
  if (!account) {
    const checkedAt = await recordCheck(admin, {
      platform: "android",
      detectedVersion: null,
      ok: false,
      error: ANDROID_NOT_CONFIGURED,
    });
    return { platform: "android", checkedAt, detectedVersion: null, ok: false, error: ANDROID_NOT_CONFIGURED, changed: false };
  }

  let detectedVersion: string | null = null;
  let error: string | null = null;
  let changed = false;
  try {
    const store = await readAndroidProduction(account);
    detectedVersion = store.version;
    const current = await latestPublicRelease(admin, "android");
    let newer = !current;
    if (current?.buildNumber !== null && current?.buildNumber !== undefined) {
      newer = store.buildNumber > current.buildNumber;
    } else if (current?.version) {
      if (!store.version) throw new Error("android_marketing_version_unavailable");
      newer = compareSemver(store.version, current.version) > 0;
    }
    if (newer) {
      const { error: syncError } = await admin.rpc("sync_store_app_release", {
        p_platform: "android",
        p_version: store.version,
        p_store_url: ANDROID_STORE_URL,
        p_build_number: store.buildNumber,
      });
      if (syncError) throw new Error("database_store_release_sync_failed");
      changed = true;
    }
  } catch (caught) {
    const raw = caught instanceof Error ? caught.message : "";
    error = /google_play_http_(401|403)/.test(raw) ? ANDROID_NOT_CONFIGURED : safeError(caught, "android_play_check_failed");
  }
  const checkedAt = await recordCheck(admin, {
    platform: "android",
    detectedVersion,
    ok: error === null,
    error,
  });
  return { platform: "android", checkedAt, detectedVersion, ok: error === null, error, changed };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!authorizedServiceCaller(req.headers, Deno.env.get("STORE_SYNC_API_KEY"))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return json({ error: "Function is not configured" }, 503);
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const checks = await Promise.all([checkIos(admin), checkAndroid(admin)]);
    return json({
      ok: checks.every((check) => check.ok),
      checks: checks.map(({ platform, checkedAt, detectedVersion, ok, error, changed }) => ({
        platform,
        checkedAt,
        detectedVersion,
        ok,
        error,
        changed,
      })),
    });
  } catch (error) {
    console.error(JSON.stringify({
      tag: "sync_store_versions",
      ok: false,
      error: safeError(error, "store_sync_failed"),
    }));
    return json({ error: "Store sync failed" }, 500);
  }
});
