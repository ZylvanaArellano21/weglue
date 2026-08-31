import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Auth deep-link handling — client contract (iOS + Android, one code path)
// ============================================================================
//
// Rollout task 4 hardening. These pin the properties that decide whether a
// verification link logs a user out:
//
//   1. A SIGNUP confirmation link is IGNORED when a real session is already
//      active — nothing is consumed, so `confirmed.tsx` must not sign the user
//      out (see the `authLinkRecentlyConsumed` handshake).
//   2. An EMAIL-CHANGE confirmation is the opposite: it runs even with a live
//      session, because it is meant to be applied to the signed-in user.
//   3. A first-time signup verification (no session) still runs normally.
//   4. Malformed / expired / already-consumed links route to the resend screen
//      and never throw or mutate the current session.
// ============================================================================

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  setSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}));
const routerReplace = vi.hoisted(() => vi.fn());

vi.mock("../../lib/supabase", () => ({ supabase: { auth } }));
vi.mock("expo-router", () => ({ router: { replace: (...a: unknown[]) => routerReplace(...a) } }));
vi.mock("expo-linking", () => ({ getInitialURL: vi.fn(), addEventListener: vi.fn() }));
vi.mock("@weglue/shared", () => ({ useAuthStore: vi.fn() }));
vi.mock("../../lib/platformAdmin", () => ({ shouldHandleDeepLinkNavigation: () => true }));

import {
  handleUrl,
  authLinkRecentlyConsumed,
  markAuthLinkConsumed,
  __resetAuthLinkConsumed,
} from "../useAuthDeepLink";

const CONFIRM = "https://weglue.app/auth/confirm";
const okResult = { data: {}, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  __resetAuthLinkConsumed();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.setSession.mockResolvedValue(okResult);
  auth.exchangeCodeForSession.mockResolvedValue(okResult);
  auth.verifyOtp.mockResolvedValue(okResult);
  // reset the module-level consumed timestamp to "long ago"
  // (markAuthLinkConsumed stamps Date.now(); we push it out of the window)
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

describe("stale signup link while signed in", () => {
  it("does NOT consume a PKCE code when a real session is already active", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    await handleUrl(`${CONFIRM}?code=abc123`);

    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(authLinkRecentlyConsumed()).toBe(false);
  });

  it("does NOT consume implicit-flow tokens when a real session is already active", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    await handleUrl(`${CONFIRM}#access_token=AAA&refresh_token=BBB`);

    expect(auth.setSession).not.toHaveBeenCalled();
    expect(authLinkRecentlyConsumed()).toBe(false);
  });
});

describe("email-change confirmation is still applied over a live session", () => {
  it("consumes the code even when a session is active (flow=email_change)", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });

    await handleUrl(`${CONFIRM}?flow=email_change&code=abc123`);

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(authLinkRecentlyConsumed()).toBe(true);
  });
});

describe("first-time signup verification (no session)", () => {
  it("consumes a PKCE code and marks the link consumed", async () => {
    await handleUrl(`${CONFIRM}?code=fresh`);

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("fresh");
    expect(authLinkRecentlyConsumed()).toBe(true);
  });

  it("consumes implicit-flow tokens", async () => {
    await handleUrl(`${CONFIRM}#access_token=AAA&refresh_token=BBB`);

    expect(auth.setSession).toHaveBeenCalledWith({ access_token: "AAA", refresh_token: "BBB" });
    expect(authLinkRecentlyConsumed()).toBe(true);
  });

  it("passes token_hash + type through verifyOtp", async () => {
    await handleUrl(`${CONFIRM}?token_hash=th&type=signup`);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "th", type: "signup" });
  });
});

describe("bad links never throw or mutate the session", () => {
  it("routes an explicitly expired link to the resend screen without touching auth", async () => {
    await handleUrl(`${CONFIRM}#error=access_denied&error_code=otp_expired`);

    expect(routerReplace).toHaveBeenCalledWith({
      pathname: "/auth/verify-email",
      params: { expired: "1" },
    });
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("routes to resend when the exchange returns an error, session untouched", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: { message: "code used" } });

    await handleUrl(`${CONFIRM}?code=consumed`);

    expect(routerReplace).toHaveBeenCalledWith({
      pathname: "/auth/verify-email",
      params: { expired: "1" },
    });
    expect(authLinkRecentlyConsumed()).toBe(false);
  });

  it("ignores a non-auth URL entirely", async () => {
    await handleUrl("https://weglue.app/event/123");
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("ignores a malformed payload", async () => {
    // @ts-expect-error deliberately wrong type from the native bridge
    await handleUrl(null);
    // @ts-expect-error
    await handleUrl(123);
    expect(routerReplace).not.toHaveBeenCalled();
  });
});

describe("authLinkRecentlyConsumed window", () => {
  it("is true right after a consume and false again after the window", () => {
    markAuthLinkConsumed();
    expect(authLinkRecentlyConsumed(20_000)).toBe(true);
    vi.advanceTimersByTime(20_001);
    expect(authLinkRecentlyConsumed(20_000)).toBe(false);
  });
});
