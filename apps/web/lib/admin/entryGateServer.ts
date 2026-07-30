// ============================================================================
// Admin entry gateway — Node-runtime half  (NEVER import from middleware)
// ============================================================================
//
// Password-hash verification, brute-force protection and security-event logging
// for the private administrator entry gateway. This module uses `node:crypto`
// (scrypt) and therefore CANNOT run on the Edge runtime — only the gateway Route
// Handler imports it, and that handler pins `runtime = "nodejs"`.
//
// The pure, Edge-safe parts (env reading, ticket signing, routing decision) live
// in `entryGate.ts`.
//
// ── WHAT IS AND IS NOT STORED ───────────────────────────────────────────────
//
// The plaintext access phrase is NEVER stored, logged, cached, put in a cookie,
// put in a URL, or written to disk. The only persisted artifact is
// ADMIN_ENTRY_SECRET_HASH: a salted scrypt digest from which the phrase cannot
// be recovered. Verification re-derives the digest from the submitted phrase and
// compares with `timingSafeEqual`.
// ============================================================================

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// ── Hash format ──────────────────────────────────────────────────────────────
//
//   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
//
// scrypt is memory-hard, ships with Node (no new dependency in a security
// commit), and at these parameters costs ~64 MiB and tens of milliseconds per
// attempt — which is itself the strongest brute-force control here.

export const SCRYPT_N = 16384; // CPU/memory cost
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 32;
/** scrypt needs a memory budget above the default 32 MiB for N=16384, r=8. */
const SCRYPT_MAXMEM = 96 * 1024 * 1024;

/** Reject absurd inputs before spending scrypt work on them. */
const MAX_PHRASE_BYTES = 512;
const MIN_PHRASE_LENGTH = 1;

export interface ParsedScryptHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/** Parse the stored hash. Returns null for anything malformed (→ fail closed). */
export function parseScryptHash(stored: string | null | undefined): ParsedScryptHash | null {
  if (!stored) return null;
  const parts = stored.trim().split("$");
  if (parts.length !== 6) return null;
  // Indexed reads with explicit fallbacks: the length check above does not narrow
  // element types under `noUncheckedIndexedAccess`, and an empty string fails
  // every validation below anyway.
  const scheme = parts[0] ?? "";
  const nRaw = parts[1] ?? "";
  const rRaw = parts[2] ?? "";
  const pRaw = parts[3] ?? "";
  const saltRaw = parts[4] ?? "";
  const hashRaw = parts[5] ?? "";
  if (scheme !== "scrypt") return null;

  const n = Number.parseInt(nRaw, 10);
  const r = Number.parseInt(rRaw, 10);
  const p = Number.parseInt(pRaw, 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return null;
  // Refuse weak or hostile parameters (the latter could be a memory-exhaustion
  // vector if the env value were ever tampered with).
  if (n < 1024 || n > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;

  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(saltRaw, "base64");
    hash = Buffer.from(hashRaw, "base64");
  } catch {
    return null;
  }
  if (salt.length < 16 || hash.length < 16) return null;
  return { n, r, p, salt, hash };
}

/** Derive a scrypt digest for `phrase` under the given parameters. */
export function deriveScrypt(phrase: string, params: ParsedScryptHash): Buffer {
  return scryptSync(phrase, params.salt, params.hash.length, {
    N: params.n,
    r: params.r,
    p: params.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

/**
 * Constant-time verification of a submitted phrase against the stored hash.
 *
 * Returns false — never throws and never distinguishes the reason — for an
 * unconfigured hash, a malformed hash, an oversized phrase, or a mismatch.
 */
export function verifyEntryPhrase(phrase: string, storedHash: string | null | undefined): boolean {
  const params = parseScryptHash(storedHash);
  if (!params) return false;
  if (typeof phrase !== "string") return false;
  if (phrase.length < MIN_PHRASE_LENGTH) return false;
  if (Buffer.byteLength(phrase, "utf8") > MAX_PHRASE_BYTES) return false;

  try {
    const derived = deriveScrypt(phrase, params);
    if (derived.length !== params.hash.length) return false;
    return timingSafeEqual(derived, params.hash);
  } catch {
    return false;
  }
}

/**
 * Produce a stored-hash string for a phrase. Used ONLY by the offline generator
 * script so the founder can create ADMIN_ENTRY_SECRET_HASH without the phrase
 * ever reaching this repository, a log, or a chat transcript.
 */
export function createScryptHash(phrase: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(phrase, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

// ── Brute-force protection ───────────────────────────────────────────────────
//
// HONEST LIMITATION — READ BEFORE RELYING ON THIS:
//
// This limiter is PER SERVER INSTANCE, held in memory. This project has no
// durable shared store (Vercel KV is discontinued and no Marketplace Redis is
// provisioned), so a globally consistent counter is not available without adding
// infrastructure. Consequences:
//
//   • Fluid Compute reuses instances across requests, so in practice a single
//     attacker hitting one region is throttled effectively.
//   • An attacker who can spread requests across many cold instances/regions
//     can obtain more than LIMIT attempts per window in aggregate.
//   • Counters reset on redeploy or instance recycle.
//
// The real brute-force control is therefore the scrypt cost (~tens of ms and
// ~64 MiB per guess) plus a high-entropy phrase. This limiter exists to make
// casual and single-source attacks expensive and loud, not to be a hard global
// bound. If a hard bound is ever required, provision a Marketplace Redis (or
// Vercel Firewall rate-limiting rule on the private path) and replace
// `recordAttempt`/`isLockedOut` — the rest of the gateway needs no changes.

export const ENTRY_MAX_ATTEMPTS = 5;
export const ENTRY_WINDOW_MS = 15 * 60 * 1000;
export const ENTRY_LOCKOUT_MS = 15 * 60 * 1000;
/** Bounded so a spray of unique IPs cannot grow this map without limit. */
export const ENTRY_TRACKER_MAX_KEYS = 5000;
/** Uniform delay on EVERY submission: slows guessing and flattens timing. */
export const ENTRY_ATTEMPT_DELAY_MS = 250;

interface AttemptRecord {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

const attempts = new Map<string, AttemptRecord>();

/** Test seam: drop all tracked state. */
export function __resetEntryAttempts(): void {
  attempts.clear();
}

function evictIfNeeded(): void {
  if (attempts.size <= ENTRY_TRACKER_MAX_KEYS) return;
  // Map preserves insertion order — drop the oldest quarter in one pass.
  const dropCount = Math.ceil(ENTRY_TRACKER_MAX_KEYS / 4);
  let dropped = 0;
  for (const key of attempts.keys()) {
    attempts.delete(key);
    if (++dropped >= dropCount) break;
  }
}

/** True while this client is inside a lockout. */
export function isLockedOut(key: string, now: number = Date.now()): boolean {
  const rec = attempts.get(key);
  return !!rec && rec.lockedUntil > now;
}

/**
 * Record one attempt outcome and return the resulting state.
 *
 * A success clears the record entirely. A failure increments within a rolling
 * window and trips a lockout at ENTRY_MAX_ATTEMPTS.
 */
export function recordAttempt(
  key: string,
  ok: boolean,
  now: number = Date.now()
): { locked: boolean; failures: number } {
  if (ok) {
    attempts.delete(key);
    return { locked: false, failures: 0 };
  }

  let rec = attempts.get(key);
  if (!rec || now - rec.windowStart > ENTRY_WINDOW_MS) {
    rec = { failures: 0, windowStart: now, lockedUntil: 0 };
  }
  rec.failures += 1;
  if (rec.failures >= ENTRY_MAX_ATTEMPTS) {
    rec.lockedUntil = now + ENTRY_LOCKOUT_MS;
  }
  // Re-insert last so eviction order tracks recency.
  attempts.delete(key);
  attempts.set(key, rec);
  evictIfNeeded();
  return { locked: rec.lockedUntil > now, failures: rec.failures };
}

/**
 * Derive a stable, non-reversible client key from request headers.
 *
 * The raw IP is HMAC'd (with the cookie secret) and truncated so neither logs
 * nor memory hold a plaintext address — correlatable for defenders, not
 * identifying. Falls back to a single shared bucket when no address is present,
 * which fails SAFE (it throttles harder, never less).
 */
export function clientKey(
  headers: { get(name: string): string | null },
  secret: string | null
): string {
  const forwarded = headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
  if (!secret) return `anon:${ip === "unknown" ? "unknown" : "present"}`;
  return createHmac("sha256", secret).update(ip).digest("base64url").slice(0, 22);
}

// ── Security events ──────────────────────────────────────────────────────────

export type EntrySecurityEvent =
  | "admin_entry.success"
  | "admin_entry.failure"
  | "admin_entry.lockout"
  | "admin_entry.unconfigured";

/**
 * Emit ONE structured security event.
 *
 * By construction the payload can only ever contain the fields below. The
 * phrase, the stored hash, the cookie value, any password, any TOTP code and
 * any message content are never passed in and never logged.
 */
export function logEntrySecurityEvent(
  event: EntrySecurityEvent,
  fields: { clientKey: string; failures?: number; locked?: boolean }
): void {
  const payload = {
    evt: event,
    ts: new Date().toISOString(),
    client: fields.clientKey,
    ...(typeof fields.failures === "number" ? { failures: fields.failures } : {}),
    ...(typeof fields.locked === "boolean" ? { locked: fields.locked } : {}),
  };
  // console.warn → Vercel runtime logs / drains, where it can be alerted on.
  console.warn(`[security] ${JSON.stringify(payload)}`);
}

/** Uniform delay applied to every submission (see ENTRY_ATTEMPT_DELAY_MS). */
export function attemptDelay(ms: number = ENTRY_ATTEMPT_DELAY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
