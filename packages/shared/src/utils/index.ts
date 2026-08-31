export * from "./validateEducationEmail";

// ─── String utilities ─────────────────────────────────────────────────────────

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Date utilities ───────────────────────────────────────────────────────────

export function formatDate(
  date: string | Date,
  locale = "en-US",
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  }
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(date));
}

export function isExpired(expiresAt: string | Date): boolean {
  return new Date(expiresAt) < new Date();
}

// ─── Object utilities ─────────────────────────────────────────────────────────

export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}

export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

// ─── Onboarding utilities ─────────────────────────────────────────────────────

/**
 * A 32-char lowercase hex token naming a not-yet-owned upload in the
 * `pending-avatars` storage bucket (Camera/Photo chosen before the account
 * exists, during onboarding). Not a security credential — just a filename
 * discriminator — so Math.random is fine; the DB trigger that later reads it
 * out of signup metadata validates the same shape via regex.
 */
export function generatePendingAvatarToken(): string {
  const chunk = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return chunk() + chunk() + chunk() + chunk();
}

// ─── Async utilities ──────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Realtime reconnect backoff, with jitter ─────────────────────────────────
//
// @supabase/realtime-js reconnects on the fixed ladder [1s, 2s, 5s, 10s] then
// 10s steady, with NO jitter. If a shared network path (a campus Wi-Fi, a
// flaky tower) drops for every client at once, all of them reconnect in
// lock-step waves — a thundering herd on the realtime service and, per wave,
// an RLS re-evaluation of every subscribed channel. Adding ±50% jitter spreads
// the reconnects out. Pass this as `realtime.reconnectAfterMs` on the client.
export function jitteredReconnectAfterMs(tries: number): number {
  const ladder = [1000, 2000, 5000, 10000];
  const base = ladder[tries - 1] ?? 10000;
  return Math.round(base * (1 + Math.random() * 0.5));
}

// ─── client_tag write idempotency ────────────────────────────────────────────
//
// Direct-write creates (post, event, comment) carry a caller-generated
// `client_tag` UUID that is STABLE across double-taps and lost-response retries
// of one logical compose action. Migration 100 adds a partial unique index per
// table on (owner, client_tag). A retry then raises 23505 from THAT index, and
// the caller resolves the already-created row by the same tag instead of
// inserting a duplicate.
//
// This helper keeps that path precise: a 23505 from a DIFFERENT constraint
// (e.g. a genuine duplicate business key) is still a real error and must not be
// swallowed as success.

/**
 * True only when a Postgres unique-violation is the client_tag idempotency
 * index firing — a safe retry of the same logical write. Pass the exact index
 * name for the table being written; the check also accepts a generic
 * "client_tag" mention so it stays correct if PostgREST phrases the error
 * without the index name.
 */
export function isClientTagConflict(err: unknown, indexName: string): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as { code?: string | number; message?: string; details?: string; hint?: string };
  if (String(e.code) !== "23505") return false;
  const haystack = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`.toLowerCase();
  return haystack.includes(indexName.toLowerCase()) || haystack.includes("client_tag");
}

// ─── Bounded retry for IDEMPOTENT requests only ───────────────────────────────
//
// USE THIS ONLY for reads / GET-shaped RPCs (feed queries, get_unread_summary,
// my_access_state, discovery, …). NEVER for auth.signUp / auth.resend /
// auth.updateUser / resetPasswordForEmail or any INSERT/UPDATE/side-effecting
// RPC — a retry there can create a duplicate account, a duplicate row, or a
// second competing token. Those must surface the error to the user with a
// clear message and a manual retry.
//
// It retries only genuinely transient failures (network drop, 429, 5xx) with
// jittered exponential backoff, honoring Retry-After when present, and caps the
// total added latency so a slow path never hangs the UI.

/** Whether an error is a transient failure worth a bounded automatic retry. */
export function isTransientError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as {
    status?: number;
    code?: string | number;
    name?: string;
    message?: string;
  };
  if (e.status === 429 || e.status === 500 || e.status === 502 || e.status === 503 || e.status === 504) {
    return true;
  }
  // Fetch-layer failures (offline, DNS, TLS, connection reset). RN and browsers
  // phrase these differently.
  const msg = (e.message ?? "").toLowerCase();
  if (
    e.name === "TypeError" ||
    e.name === "AbortError" ||
    msg.includes("failed to fetch") ||
    msg.includes("network request failed") ||
    msg.includes("network error") ||
    msg.includes("load failed") ||
    msg.includes("fetch failed") ||
    msg.includes("timeout")
  ) {
    return true;
  }
  // PostgREST/PgBouncer momentary unavailability.
  if (e.code === "PGRST002" || e.code === "57P03" || e.code === "53300") return true;
  return false;
}

/** Retry-After (seconds or HTTP-date) from an error's headers, in ms, or null. */
export function getRetryAfterMs(err: unknown): number | null {
  const headers = (err as { headers?: unknown } | null)?.headers;
  let raw: string | null = null;
  if (headers && typeof (headers as { get?: unknown }).get === "function") {
    raw = (headers as { get(name: string): string | null }).get("retry-after");
  } else if (headers && typeof headers === "object") {
    const h = headers as Record<string, string>;
    raw = h["retry-after"] ?? h["Retry-After"] ?? null;
  }
  if (!raw) return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) return Math.max(0, asNumber * 1000);
  const asDate = Date.parse(raw);
  return Number.isNaN(asDate) ? null : Math.max(0, asDate - Date.now());
}

export interface RetryOptions {
  /** Max retry attempts after the first try. Default 2. */
  retries?: number;
  /** Base backoff before jitter. Default 400 ms. */
  baseDelayMs?: number;
  /** Cap on a single backoff wait. Default 2500 ms. */
  maxDelayMs?: number;
  /** Cap on TOTAL time spent waiting across all retries. Default 4000 ms. */
  maxTotalDelayMs?: number;
  /** Fraction of random jitter, ±. Default 0.5. */
  jitter?: number;
  /** Override which errors are retryable. Default: {@link isTransientError}. */
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, waitMs: number) => void;
}

export async function retryIdempotent<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    retries = 2,
    baseDelayMs = 400,
    maxDelayMs = 2500,
    maxTotalDelayMs = 4000,
    jitter = 0.5,
    isRetryable = isTransientError,
    onRetry,
  } = opts;

  let spent = 0;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isRetryable(err)) break;

      const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const jittered = backoff * (1 + (Math.random() * 2 - 1) * jitter);
      const wait = Math.max(0, Math.min(getRetryAfterMs(err) ?? jittered, maxTotalDelayMs - spent));
      if (wait <= 0) break;
      spent += wait;
      onRetry?.(err, attempt + 1, wait);
      await sleep(wait);
    }
  }
  throw lastError;
}

/**
 * @deprecated Use {@link retryIdempotent}. Kept so any old import still resolves;
 * now transient-only + jittered instead of retrying every error.
 */
export function withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 400): Promise<T> {
  return retryIdempotent(fn, { retries, baseDelayMs });
}
