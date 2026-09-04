import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// authFlow (web) — password-reset cooldown + Supabase error mapping
// ============================================================================
//
// Web mirror of apps/mobile/lib/__tests__/authFlowResetCooldown.test.ts.
// The reset "Link expired" screen and Forgot Password both go through
// sendPasswordResetEmail, and the property that must never rot: a server
// cooldown / rate limit is surfaced as a specific recoverable state, NEVER as
// "Couldn't send the email. Check the address and try again." — a bad address
// returns success from Supabase by design, so "check the address" is wrong.
// ============================================================================

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  resetResult: { error: null as unknown },
  resetPasswordForEmail: vi.fn(() => Promise.resolve(h.resetResult)),
}));

// authFlow.ts reads/writes window.localStorage directly (wrapped in try/catch).
// The web test env is "node", so provide a minimal stub.
beforeEach(() => {
  h.store.clear();
  h.resetResult.error = null;
  h.resetPasswordForEmail.mockClear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => h.store.get(k) ?? null,
    setItem: (k: string, v: string) => void h.store.set(k, v),
    removeItem: (k: string) => void h.store.delete(k),
  };
});

vi.mock("../supabase/client", () => ({
  createClient: () => ({
    auth: { resetPasswordForEmail: h.resetPasswordForEmail },
  }),
}));

import {
  sendPasswordResetEmail,
  getResetCooldownRemaining,
  friendlyEmailSendError,
} from "../authFlow";

describe("sendPasswordResetEmail", () => {
  it("sends once and opens a ~60s cooldown", async () => {
    await expect(sendPasswordResetEmail("Student@school.edu")).resolves.toEqual({
      ok: true,
    });
    expect(h.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    const left = getResetCooldownRemaining("student@school.edu");
    expect(left).toBeGreaterThan(55);
    expect(left).toBeLessThanOrEqual(60);
  });

  it("refuses a second send during the cooldown and returns the remaining seconds", async () => {
    await sendPasswordResetEmail("a@b.edu");
    const second = await sendPasswordResetEmail("a@b.edu");
    expect(second).toMatchObject({ ok: false });
    expect("cooldown" in second && second.cooldown).toBeGreaterThan(0);
    expect(h.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it("cooldown is per-email", async () => {
    await sendPasswordResetEmail("a@b.edu");
    expect(getResetCooldownRemaining("other@b.edu")).toBe(0);
  });

  it("a non-throttle failure releases the cooldown so the user can retry", async () => {
    h.resetResult.error = { message: "network error", code: "unexpected_failure" };
    const r = await sendPasswordResetEmail("a@b.edu");
    expect(r).toMatchObject({ ok: false });
    expect("message" in r && r.message).toBeTruthy();
    expect(getResetCooldownRemaining("a@b.edu")).toBe(0);
  });

  it("a throttle failure KEEPS the cooldown", async () => {
    h.resetResult.error = {
      message: "For security purposes, you can only request this after 42 seconds",
      status: 429,
    };
    await sendPasswordResetEmail("a@b.edu");
    expect(getResetCooldownRemaining("a@b.edu")).toBeGreaterThan(0);
  });

  it("rejects an empty email without touching the network", async () => {
    expect(await sendPasswordResetEmail("   ")).toMatchObject({ ok: false });
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("friendlyEmailSendError — never blames the address", () => {
  it("maps the hourly quota to a server-limit message", () => {
    expect(friendlyEmailSendError({ code: "over_email_send_rate_limit" })).toMatch(
      /rate limited|email limit/i
    );
  });
  it("maps a bare 429 to a server-limit message", () => {
    expect(friendlyEmailSendError({ status: 429 })).toMatch(/rate limited|email limit/i);
  });
  it("maps the per-IP request throttle without telling the user to wait an hour", () => {
    const msg = friendlyEmailSendError({ code: "over_request_rate_limit" });
    expect(msg).toMatch(/network|wait a moment/i);
    expect(msg).not.toMatch(/hour/i);
  });
  // Regression: Supabase's per-EMAIL-ADDRESS resend cooldown (a normal ~60s
  // wait right after a signup or a previous resend) also arrives as a bare
  // HTTP 429, distinguished only by this message. It was previously caught by
  // the generic 429 check above and told the user to wait an HOUR — a real
  // production incident (a user's genuine short cooldown was reported as the
  // project-wide hourly quota).
  it("maps the per-address resend cooldown to a short wait, never the hourly message", () => {
    const msg = friendlyEmailSendError({
      status: 429,
      message: "For security purposes, you can only request this after 43 seconds.",
    });
    expect(msg).toMatch(/seconds/i);
    expect(msg).not.toMatch(/hour/i);
  });
  it("still reports the real hourly quota when the explicit code is present", () => {
    const msg = friendlyEmailSendError({ code: "over_email_send_rate_limit" });
    expect(msg).toMatch(/hour/i);
  });
  it("falls back to a generic retry message, never 'check the address'", () => {
    const msg = friendlyEmailSendError({ message: "boom", code: "unexpected_failure" });
    expect(msg).toMatch(/try again/i);
    expect(msg.toLowerCase()).not.toContain("address");
  });
});
