const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;

type Bucket = { startedAt: number; count: number };
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Small abuse guard for public, low-volume forms. The authoritative account
 * writes remain protected by Supabase RLS; this only limits request flooding.
 * The map is intentionally process-local and bounded by expiry cleanup. A
 * platform-level rate limit can be layered on later without changing callers.
 */
export function checkPublicRateLimit(key: string, now = Date.now()): RateLimitResult {
  for (const [storedKey, bucket] of buckets) {
    if (now - bucket.startedAt >= WINDOW_MS) buckets.delete(storedKey);
  }

  const current = buckets.get(key);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    buckets.set(key, { startedAt: now, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= MAX_REQUESTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + WINDOW_MS - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetPublicRateLimitForTests(): void {
  buckets.clear();
}
