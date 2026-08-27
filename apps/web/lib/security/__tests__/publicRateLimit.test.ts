import { afterEach, describe, expect, it } from "vitest";
import { checkPublicRateLimit, resetPublicRateLimitForTests } from "../publicRateLimit";

describe("public request rate limit", () => {
  afterEach(() => resetPublicRateLimitForTests());

  it("allows five requests and rejects the sixth within the window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(checkPublicRateLimit("client", now + i).allowed).toBe(true);
    }

    const blocked = checkPublicRateLimit("client", now + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets the bucket after fifteen minutes", () => {
    const now = 2_000_000;
    for (let i = 0; i < 5; i += 1) checkPublicRateLimit("client", now);
    expect(checkPublicRateLimit("client", now + 15 * 60 * 1000).allowed).toBe(true);
  });

  it("keeps separate clients independent", () => {
    const now = 3_000_000;
    for (let i = 0; i < 5; i += 1) checkPublicRateLimit("client-a", now);
    expect(checkPublicRateLimit("client-a", now).allowed).toBe(false);
    expect(checkPublicRateLimit("client-b", now).allowed).toBe(true);
  });
});
