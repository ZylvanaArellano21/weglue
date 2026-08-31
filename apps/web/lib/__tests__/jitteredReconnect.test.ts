import { describe, it, expect } from "vitest";
import { jitteredReconnectAfterMs } from "@weglue/shared";

// ============================================================================
// jitteredReconnectAfterMs — realtime reconnect backoff ladder with ±50% jitter
// ============================================================================
//
// Passed as `realtime.reconnectAfterMs` on both the mobile and web Supabase
// clients so a shared-network drop doesn't reconnect every client in lock-step.
// The property that matters: each try stays within [base, base*1.5] of the
// fixed ladder, and anything past the ladder holds at the 10s step.
// ============================================================================

describe("jitteredReconnectAfterMs", () => {
  const ladder = [1000, 2000, 5000, 10000];

  it("keeps each ladder step within [base, base*1.5]", () => {
    for (let tries = 1; tries <= ladder.length; tries++) {
      const base = ladder[tries - 1]!;
      for (let i = 0; i < 200; i++) {
        const v = jitteredReconnectAfterMs(tries);
        expect(v).toBeGreaterThanOrEqual(base);
        expect(v).toBeLessThanOrEqual(Math.round(base * 1.5));
      }
    }
  });

  it("holds at the 10s step (jittered) once past the ladder", () => {
    for (const tries of [5, 6, 12, 100]) {
      const v = jitteredReconnectAfterMs(tries);
      expect(v).toBeGreaterThanOrEqual(10000);
      expect(v).toBeLessThanOrEqual(15000);
    }
  });

  it("actually varies between calls (not a constant)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(jitteredReconnectAfterMs(2));
    expect(seen.size).toBeGreaterThan(1);
  });
});
