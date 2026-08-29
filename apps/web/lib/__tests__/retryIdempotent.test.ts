import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  retryIdempotent,
  isTransientError,
  getRetryAfterMs,
} from "@weglue/shared";

// ============================================================================
// retryIdempotent — bounded retry for READ / idempotent requests only
// ============================================================================
//
// The one property that must never regress: a NON-transient error (a 4xx, a
// unique violation, an auth error) is thrown immediately with NO retry, so this
// helper can never be the thing that duplicates a write or a token.
// ============================================================================

describe("isTransientError", () => {
  it("is true for 429 and 5xx", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isTransientError({ status })).toBe(true);
    }
  });

  it("is true for fetch-layer failures on either platform", () => {
    expect(isTransientError({ name: "TypeError", message: "Failed to fetch" })).toBe(true);
    expect(isTransientError(new Error("Network request failed"))).toBe(true);
    expect(isTransientError({ message: "fetch failed" })).toBe(true);
    expect(isTransientError({ name: "AbortError" })).toBe(true);
  });

  it("is true for momentary PostgREST/PgBouncer unavailability", () => {
    expect(isTransientError({ code: "PGRST002" })).toBe(true);
    expect(isTransientError({ code: "57P03" })).toBe(true);
  });

  it("is FALSE for client errors, unique violations, and auth errors", () => {
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
    expect(isTransientError({ status: 404 })).toBe(false);
    expect(isTransientError({ status: 422 })).toBe(false);
    expect(isTransientError({ code: "23505" })).toBe(false); // unique_violation
    expect(isTransientError({ code: "over_email_send_rate_limit" })).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError("boom")).toBe(false);
  });
});

describe("getRetryAfterMs", () => {
  it("parses a numeric seconds value from a Headers-like object", () => {
    const headers = new Headers({ "retry-after": "3" });
    expect(getRetryAfterMs({ headers })).toBe(3000);
  });
  it("parses a plain-object header", () => {
    expect(getRetryAfterMs({ headers: { "retry-after": "1" } })).toBe(1000);
  });
  it("parses an HTTP-date", () => {
    const when = new Date(Date.now() + 5000).toUTCString();
    const ms = getRetryAfterMs({ headers: { "retry-after": when } });
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThanOrEqual(6000);
  });
  it("returns null when absent", () => {
    expect(getRetryAfterMs({})).toBeNull();
    expect(getRetryAfterMs({ headers: {} })).toBeNull();
  });
});

describe("retryIdempotent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the first result without waiting when the call succeeds", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(retryIdempotent(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue("recovered");
    const p = retryIdempotent(fn, { baseDelayMs: 100, jitter: 0 });
    await vi.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-transient error — throws immediately", async () => {
    const fn = vi.fn().mockRejectedValue({ code: "23505", message: "duplicate key" });
    await expect(retryIdempotent(fn)).rejects.toMatchObject({ code: "23505" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after `retries` transient failures and throws the last error", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 500, message: "still down" });
    const p = retryIdempotent(fn, { retries: 2, baseDelayMs: 50, jitter: 0 });
    const assertion = expect(p).rejects.toMatchObject({ status: 500 });
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3); // first + 2 retries
  });

  it("caps total wait at maxTotalDelayMs", async () => {
    const fn = vi.fn().mockRejectedValue({ status: 503 });
    const waits: number[] = [];
    const p = retryIdempotent(fn, {
      retries: 5,
      baseDelayMs: 3000,
      maxDelayMs: 10000,
      maxTotalDelayMs: 4000,
      jitter: 0,
      onRetry: (_e, _a, w) => waits.push(w),
    });
    const assertion = expect(p).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(60000);
    await assertion;
    const total = waits.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(4000);
  });

  it("honors Retry-After over the computed backoff", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, headers: { "retry-after": "2" } })
      .mockResolvedValue("done");
    const seen: number[] = [];
    const p = retryIdempotent(fn, { baseDelayMs: 100, jitter: 0, onRetry: (_e, _a, w) => seen.push(w) });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toBe("done");
    expect(seen[0]).toBe(2000);
  });
});
