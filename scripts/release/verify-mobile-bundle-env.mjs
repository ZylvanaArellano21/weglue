#!/usr/bin/env node
// Fail-closed verifier for production mobile OTA bundles.
//
// Guarantees that an exported Expo bundle is wired to the PRODUCTION Supabase
// project and nothing else, before `eas update` is allowed to publish it.
// Used by scripts/release/ota-production.sh; see docs/release/mobile-ota-production.md.
//
// Commands (all exit non-zero on any violation):
//   env                                     validate the injected EXPO_PUBLIC_* values
//   bundle   --dist <dir> --manifest <file> validate env + every uploaded file, then
//                                           write a sha256 manifest of <dir>
//   check-manifest --dist <dir> --manifest <file>
//                                           re-hash <dir>; fail if anything changed
//
// Never prints the anon/publishable key — only its kind and a short sha256 prefix.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Public identifiers only. The production Supabase URL ships inside every app
// bundle, so the project ref is not a secret.
export const PRODUCTION_SUPABASE_REF = "yoozrnosmqtaiksgcixc";
export const PRODUCTION_SUPABASE_URL = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;

export const URL_VAR = "EXPO_PUBLIC_SUPABASE_URL";
export const KEY_VAR = "EXPO_PUBLIC_SUPABASE_ANON_KEY";

// Exact, founder-approved harmless matches for the local-host rule. Each entry
// is the exact matched text plus its surrounding context as reported by this
// script. Empty on purpose: nothing may be added without founder approval.
export const LOCAL_HOST_ALLOWLIST = [];

// ─── Pattern definitions ──────────────────────────────────────────────────────

const LOCAL_HOST_RULES = [
  { name: "localhost", re: /localhost/gi },
  { name: "127.x loopback", re: /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g },
  { name: "10.0.2.2 Android emulator host", re: /\b10\.0\.2\.2\b/g },
  { name: "host.docker.internal", re: /host\.docker\.internal/gi },
  { name: "RFC1918 10.x", re: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g },
  { name: "RFC1918 192.168.x", re: /\b192\.168\.\d{1,3}\.\d{1,3}\b/g },
  { name: "RFC1918 172.16-31.x", re: /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g },
  { name: "local Supabase port :54321", re: /:54321\b/g },
];

const SUPABASE_REF_RE = /\b([a-z0-9]{20})\.supabase\.(?:co|in)\b/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const SB_SECRET_RE = /sb_secret_[A-Za-z0-9_-]{8,}/g;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export class VerificationError extends Error {
  constructor(problems) {
    super(`Production OTA verification FAILED:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.problems = problems;
  }
}

export function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

export function shortHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
}

function describeKey(key) {
  if (key.startsWith("sb_publishable_")) return `publishable key (sha256 ${shortHash(key)}…)`;
  const payload = decodeJwtPayload(key);
  const role = payload?.role ?? "unknown";
  return `JWT role=${role} ref=${payload?.ref ?? "none"} (sha256 ${shortHash(key)}…)`;
}

// Replace every JWT / secret-looking token so reported context can never leak a key.
function redact(text, extraSecrets = []) {
  let out = text.replace(JWT_RE, "<jwt-redacted>").replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "<sb-key-redacted>");
  for (const s of extraSecrets) if (s) out = out.split(s).join("<key-redacted>");
  return out;
}

function context(text, index, length) {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  // Keep printable ASCII only so binary (Hermes bytecode) context is readable.
  return text.slice(start, end).replace(/[^\x20-\x7e]/g, "·");
}

function isAllowlisted(match, ctx) {
  return LOCAL_HOST_ALLOWLIST.some((entry) => entry.match === match && ctx.includes(entry.context));
}

// ─── Value rules (shared by env + bundle checks) ──────────────────────────────

/** Local/LAN host problems inside a single string. */
export function findLocalHostProblems(text, label, secrets = []) {
  const problems = [];
  for (const rule of LOCAL_HOST_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const ctx = context(text, m.index, m[0].length);
      if (!isAllowlisted(m[0], ctx)) {
        problems.push(`${label}: ${rule.name} found: "${m[0]}" in context "${redact(ctx, secrets)}"`);
      }
    }
  }
  return problems;
}

/** Wrong-project refs, privileged JWTs and sb_secret_ credentials inside a string. */
export function findCredentialProblems(text, label) {
  const problems = [];

  SUPABASE_REF_RE.lastIndex = 0;
  const foreignRefs = new Set();
  let m;
  while ((m = SUPABASE_REF_RE.exec(text)) !== null) {
    if (m[1] !== PRODUCTION_SUPABASE_REF) foreignRefs.add(m[1]);
  }
  for (const ref of foreignRefs) problems.push(`${label}: non-production Supabase project ref "${ref}" found`);

  JWT_RE.lastIndex = 0;
  while ((m = JWT_RE.exec(text)) !== null) {
    const payload = decodeJwtPayload(m[0]);
    if (!payload) continue;
    if (payload.role === "service_role") {
      problems.push(`${label}: service_role JWT found (sha256 ${shortHash(m[0])}…)`);
    }
    if (payload.ref !== undefined && payload.ref !== PRODUCTION_SUPABASE_REF) {
      problems.push(`${label}: JWT for non-production ref "${payload.ref}" found (sha256 ${shortHash(m[0])}…)`);
    }
  }

  SB_SECRET_RE.lastIndex = 0;
  if (SB_SECRET_RE.test(text)) problems.push(`${label}: sb_secret_ credential found`);

  return problems;
}

// ─── env ──────────────────────────────────────────────────────────────────────

/**
 * Validate the EXPO_PUBLIC_* values that Metro will inline into the bundle.
 * Returns { url, key, summary } on success; throws VerificationError otherwise.
 */
export function validateEnv(env) {
  const problems = [];
  const url = (env[URL_VAR] ?? "").trim();
  const key = (env[KEY_VAR] ?? "").trim();

  if (!url) problems.push(`${URL_VAR} is absent (production Supabase URL not injected)`);
  if (!key) problems.push(`${KEY_VAR} is absent (anon/publishable key not injected)`);

  if (url && url.replace(/\/$/, "") !== PRODUCTION_SUPABASE_URL) {
    let host = "<unparseable>";
    try {
      host = new URL(url).host;
    } catch {}
    problems.push(`${URL_VAR} host "${host}" is not the production project (${PRODUCTION_SUPABASE_REF}.supabase.co)`);
  }

  if (key) {
    if (key.startsWith("sb_secret_")) {
      problems.push(`${KEY_VAR} is an sb_secret_ credential — never ship a secret key`);
    } else if (key.startsWith("sb_publishable_")) {
      // Opaque publishable key: no ref to check; the bundle must still contain it verbatim.
    } else {
      const payload = decodeJwtPayload(key);
      if (!payload) {
        problems.push(`${KEY_VAR} is neither a JWT nor an sb_publishable_ key`);
      } else {
        if (payload.role !== "anon") problems.push(`${KEY_VAR} JWT role is "${payload.role}", expected "anon"`);
        if (payload.ref !== PRODUCTION_SUPABASE_REF) {
          problems.push(`${KEY_VAR} JWT ref "${payload.ref}" does not match production "${PRODUCTION_SUPABASE_REF}"`);
        }
      }
    }
  }

  // Every inlined public value must be free of local hosts and privileged credentials.
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("EXPO_PUBLIC_") || typeof value !== "string" || !value) continue;
    problems.push(...findLocalHostProblems(value, name, [key]));
    problems.push(...findCredentialProblems(value, name));
  }

  if (problems.length) throw new VerificationError(problems);
  return { url, key, summary: `URL host ${new URL(url).host}; key ${describeKey(key)}` };
}

// ─── bundle ───────────────────────────────────────────────────────────────────

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** The files `eas update --skip-bundler` uploads: launch bundles + assets from metadata.json. */
export function readUploadSet(dist) {
  const metadataPath = join(dist, "metadata.json");
  if (!existsSync(metadataPath)) throw new VerificationError([`${metadataPath} not found — export did not run`]);
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const platforms = Object.keys(metadata.fileMetadata ?? {});
  const problems = [];
  for (const required of ["ios", "android"]) {
    if (!platforms.includes(required)) problems.push(`metadata.json has no ${required} bundle`);
  }
  if (problems.length) throw new VerificationError(problems);
  return platforms.map((platform) => ({
    platform,
    bundle: join(dist, metadata.fileMetadata[platform].bundle),
    assets: metadata.fileMetadata[platform].assets.map((a) => join(dist, a.path)),
  }));
}

/**
 * Validate an exported dist directory against the injected env values.
 * Every launch bundle must contain the exact injected URL and key; shipped files
 * are scanned for local hosts, and every file for foreign refs and privileged
 * credentials.
 */
export function verifyBundle(dist, env) {
  const { url, key, summary } = validateEnv(env);
  const problems = [];
  const uploadSet = readUploadSet(dist);

  for (const { platform, bundle } of uploadSet) {
    if (!existsSync(bundle)) {
      problems.push(`${platform}: launch bundle ${bundle} missing`);
      continue;
    }
    const text = readFileSync(bundle).toString("latin1");
    if (!text.includes(url)) problems.push(`${platform}: bundle does not contain the injected production Supabase URL`);
    if (!text.includes(key)) problems.push(`${platform}: bundle does not contain the injected anon/publishable key`);
  }

  // Local-host rules apply to everything that ships to devices (bundles + assets).
  // Credential rules apply to every file in the directory, shipped or not.
  const shipped = new Set(uploadSet.flatMap((u) => [u.bundle, ...u.assets]));
  for (const file of listFiles(dist)) {
    const label = relative(dist, file);
    const text = readFileSync(file).toString("latin1");
    if (shipped.has(file)) problems.push(...findLocalHostProblems(text, label, [key]));
    problems.push(...findCredentialProblems(text, label));
  }

  if (problems.length) throw new VerificationError(problems);
  return { summary, platforms: uploadSet.map((u) => u.platform) };
}

// ─── manifest ─────────────────────────────────────────────────────────────────

export function hashDirectory(dist) {
  const files = {};
  for (const file of listFiles(dist)) {
    files[relative(dist, file).split(sep).join("/")] = createHash("sha256").update(readFileSync(file)).digest("hex");
  }
  const root = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  return { root, files };
}

export function writeManifest(dist, manifestPath, extra = {}) {
  const manifest = { ...extra, ...hashDirectory(dist) };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function checkManifest(dist, manifestPath) {
  if (!existsSync(manifestPath)) throw new VerificationError([`manifest ${manifestPath} not found — bundle was never verified`]);
  const expected = JSON.parse(readFileSync(manifestPath, "utf8"));
  const actual = hashDirectory(dist);
  if (actual.root === expected.root) return actual;
  const problems = [];
  const names = new Set([...Object.keys(expected.files ?? {}), ...Object.keys(actual.files)]);
  for (const name of [...names].sort()) {
    if (expected.files?.[name] !== actual.files[name]) problems.push(`bundle file changed after verification: ${name}`);
  }
  if (!problems.length) problems.push("bundle manifest root hash changed after verification");
  throw new VerificationError(problems);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    opts[flag.slice(2)] = value;
    i++;
  }
  return { command, opts };
}

function requireOpt(opts, name) {
  if (!opts[name]) throw new Error(`--${name} is required`);
  return resolve(opts[name]);
}

export function main(argv, env = process.env) {
  const { command, opts } = parseArgs(argv);
  switch (command) {
    case "env": {
      const { summary } = validateEnv(env);
      console.log(`✓ Production env verified: ${summary}`);
      return;
    }
    case "bundle": {
      const dist = requireOpt(opts, "dist");
      const manifestPath = requireOpt(opts, "manifest");
      const { summary, platforms } = verifyBundle(dist, env);
      const manifest = writeManifest(dist, manifestPath, { verifiedAt: new Date().toISOString(), summary, platforms });
      console.log(`✓ Bundles verified (${platforms.join(", ")}): ${summary}`);
      console.log(`✓ Manifest written: ${Object.keys(manifest.files).length} files, root sha256 ${manifest.root}`);
      return;
    }
    case "check-manifest": {
      const dist = requireOpt(opts, "dist");
      const manifestPath = requireOpt(opts, "manifest");
      const actual = checkManifest(dist, manifestPath);
      console.log(`✓ Bundle unchanged since verification (root sha256 ${actual.root})`);
      return;
    }
    default:
      throw new Error(`Unknown command "${command ?? ""}". Use: env | bundle | check-manifest`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
}
