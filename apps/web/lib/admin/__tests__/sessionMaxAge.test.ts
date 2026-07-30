// ============================================================================
// Day 8 — server-enforced ABSOLUTE administrator session maximum age
// ============================================================================
//
// Covers the whole contract:
//   • env parsing (missing / malformed / out-of-range → safe default or clamp)
//   • the amr anchor (earliest authentication event, survives refresh + step-up)
//   • enforcement at requireSecureAdmin for READS and WRITES alike
//   • enforcement at requireRecentMfa (sensitive reveal / message search)
//   • the non-throwing context used by the /admin layout
//   • the ordering guarantees: portal → auth → allowlist → AGE → aal2 → writes
//   • client-clock independence
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
const getAAL = vi.fn();
vi.mock("../../supabase/server", () => ({
  createClient: () => ({
    auth: { getUser, mfa: { getAuthenticatorAssuranceLevel: getAAL } },
  }),
}));

import {
  requireSecureAdmin,
  requireRecentMfa,
  getSecureAdminContext,
} from "../secureAdmin";
import {
  adminSessionMaxAgeMinutes,
  adminSessionMaxAgeSeconds,
  adminSessionRemainingMs,
  isAdminSessionExpired,
  sessionStartSeconds,
  ADMIN_SESSION_MAX_AGE_DEFAULT_MINUTES,
  ADMIN_SESSION_MAX_AGE_MAX_MINUTES,
} from "../adminEnv";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const NOW = Math.floor(Date.now() / 1000);

function portalOn() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
}
function setUser(user: unknown) {
  getUser.mockResolvedValue({ data: { user } });
}
function setAal(level: "aal1" | "aal2", methods: unknown[]) {
  getAAL.mockResolvedValue({
    data: { currentLevel: level, nextLevel: "aal2", currentAuthenticationMethods: methods },
  });
}
/** A founder session that signed in `ageSeconds` ago and did TOTP right after. */
function sessionAged(ageSeconds: number) {
  return [
    { method: "password", timestamp: NOW - ageSeconds },
    { method: "totp", timestamp: NOW - ageSeconds + 5 },
  ];
}

beforeEach(() => {
  getUser.mockReset();
  getAAL.mockReset();
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_WRITES_ENABLED;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
  delete process.env.ADMIN_FOUNDER_EMAILS;
  delete process.env.ADMIN_SESSION_MAX_AGE_MINUTES;
});

// ── Configuration ────────────────────────────────────────────────────────────

describe("ADMIN_SESSION_MAX_AGE_MINUTES — safe parsing", () => {
  it("defaults to 15 minutes when unset", () => {
    expect(adminSessionMaxAgeMinutes()).toBe(ADMIN_SESSION_MAX_AGE_DEFAULT_MINUTES);
    expect(adminSessionMaxAgeSeconds()).toBe(900);
  });

  it("accepts a valid production value", () => {
    process.env.ADMIN_SESSION_MAX_AGE_MINUTES = "15";
    expect(adminSessionMaxAgeMinutes()).toBe(15);
  });

  it.each(["", "   ", "abc", "15m", "NaN", "Infinity", "1e3x", "12.5", "0", "-5", "-0"])(
    "falls back to the safe default for %o",
    (raw) => {
      process.env.ADMIN_SESSION_MAX_AGE_MINUTES = raw;
      expect(adminSessionMaxAgeMinutes()).toBe(ADMIN_SESSION_MAX_AGE_DEFAULT_MINUTES);
    }
  );

  it("clamps an absurd value DOWN to the ceiling (clamping can only shorten)", () => {
    process.env.ADMIN_SESSION_MAX_AGE_MINUTES = "100000";
    expect(adminSessionMaxAgeMinutes()).toBe(ADMIN_SESSION_MAX_AGE_MAX_MINUTES);
  });
});

// ── The anchor ───────────────────────────────────────────────────────────────

describe("session anchor — earliest signed amr timestamp", () => {
  it("takes the EARLIEST authentication event, not the most recent", () => {
    expect(sessionStartSeconds(sessionAged(600))).toBe(NOW - 600);
  });

  it("a later TOTP step-up on the same session does NOT reset the age", () => {
    const stepUp = [
      { method: "password", timestamp: NOW - 1200 },
      { method: "totp", timestamp: NOW - 1195 },
      { method: "totp", timestamp: NOW - 2 }, // re-verified just now
    ];
    expect(sessionStartSeconds(stepUp)).toBe(NOW - 1200);
    expect(isAdminSessionExpired(stepUp, NOW, 900)).toBe(true);
  });

  it("fails CLOSED when amr is missing, empty, or carries no usable timestamp", () => {
    expect(sessionStartSeconds(null)).toBeNull();
    expect(sessionStartSeconds([])).toBeNull();
    expect(sessionStartSeconds([{ method: "password" }])).toBeNull();
    expect(isAdminSessionExpired(undefined, NOW, 900)).toBe(true);
    expect(isAdminSessionExpired([], NOW, 900)).toBe(true);
    expect(isAdminSessionExpired([{ method: "password" }], NOW, 900)).toBe(true);
    expect(isAdminSessionExpired([{ method: "password", timestamp: 0 }], NOW, 900)).toBe(true);
  });

  it("is exact at the boundary: <= max passes, > max fails", () => {
    expect(isAdminSessionExpired(sessionAged(899), NOW, 900)).toBe(false);
    expect(isAdminSessionExpired(sessionAged(900), NOW, 900)).toBe(false);
    expect(isAdminSessionExpired(sessionAged(901), NOW, 900)).toBe(true);
  });

  it("tolerates small clock skew (a stamp slightly in the future is not expired)", () => {
    expect(isAdminSessionExpired([{ method: "password", timestamp: NOW + 30 }], NOW, 900)).toBe(false);
  });

  it("reports remaining time, floored at zero once past the deadline", () => {
    expect(adminSessionRemainingMs(sessionAged(300), NOW * 1000, 900_000)).toBe(600_000);
    expect(adminSessionRemainingMs(sessionAged(5000), NOW * 1000, 900_000)).toBe(0);
    expect(adminSessionRemainingMs([], NOW * 1000, 900_000)).toBe(0);
  });
});

// ── Enforcement: reads ───────────────────────────────────────────────────────

describe("requireSecureAdmin — reads", () => {
  it("a FRESH founder aal2 session succeeds", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2", sessionAged(60));
    await expect(requireSecureAdmin()).resolves.toMatchObject({ id: FOUNDER.id });
  });

  it("an EXPIRED founder aal2 session cannot read", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2", sessionAged(16 * 60));
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "session_expired" });
  });

  it("expiry is decided per request — the same session flips as time passes", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2", sessionAged(14 * 60));
    await expect(requireSecureAdmin()).resolves.toMatchObject({ id: FOUNDER.id });
    setAal("aal2", sessionAged(15 * 60 + 1));
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "session_expired" });
  });

  it("honours a shorter configured maximum", async () => {
    portalOn();
    process.env.ADMIN_SESSION_MAX_AGE_MINUTES = "5";
    setUser(FOUNDER);
    setAal("aal2", sessionAged(6 * 60));
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "session_expired" });
  });

  it("a malformed maximum falls back to 15 minutes, never to 'no limit'", async () => {
    portalOn();
    process.env.ADMIN_SESSION_MAX_AGE_MINUTES = "not-a-number";
    setUser(FOUNDER);
    setAal("aal2", sessionAged(20 * 60));
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "session_expired" });
  });
});

// ── Enforcement: writes ──────────────────────────────────────────────────────

describe("requireSecureAdmin — writes", () => {
  it("an EXPIRED session cannot write even with the write switch ON", async () => {
    portalOn();
    process.env.ADMIN_WRITES_ENABLED = "true";
    setUser(FOUNDER);
    setAal("aal2", sessionAged(16 * 60));
    await expect(requireSecureAdmin({ write: true })).rejects.toMatchObject({
      reason: "session_expired",
    });
  });

  it("a fresh session still needs the write switch (Day-8 production posture)", async () => {
    portalOn(); // ADMIN_WRITES_ENABLED intentionally unset
    setUser(FOUNDER);
    setAal("aal2", sessionAged(60));
    await expect(requireSecureAdmin({ write: true })).rejects.toMatchObject({
      reason: "writes_disabled",
    });
  });
});

// ── Enforcement: sensitive reveal / search ───────────────────────────────────

describe("requireRecentMfa — sensitive message reveal + content search", () => {
  it("rejects an expired session before any step-up freshness is considered", async () => {
    portalOn();
    setUser(FOUNDER);
    // TOTP verified 2 seconds ago, but the SESSION began 30 minutes ago.
    setAal("aal2", [
      { method: "password", timestamp: NOW - 1800 },
      { method: "totp", timestamp: NOW - 2 },
    ]);
    await expect(requireRecentMfa()).rejects.toMatchObject({ reason: "session_expired" });
  });

  it("still passes for a fresh session with fresh TOTP", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2", [
      { method: "password", timestamp: NOW - 120 },
      { method: "totp", timestamp: NOW - 10 },
    ]);
    await expect(requireRecentMfa()).resolves.toMatchObject({ id: FOUNDER.id });
  });
});

// ── Gate ordering + non-founder / aal1 / portal-off remain denied ────────────

describe("gate ordering and unchanged denials", () => {
  it("portal-off is refused before the session is even looked at", async () => {
    setUser(FOUNDER);
    setAal("aal2", sessionAged(60));
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "portal_disabled" });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is refused before any age check", async () => {
    portalOn();
    setUser(null);
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "unauthenticated" });
    expect(getAAL).not.toHaveBeenCalled();
  });

  it("a NON-founder is denied even with a perfectly fresh aal2 session", async () => {
    portalOn();
    setUser({ id: "00000009-0000-0000-0000-000000000009", email: "someone@else.edu" });
    setAal("aal2", sessionAged(1));
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "denied" });
    expect(getAAL).not.toHaveBeenCalled();
  });

  it("a fresh aal1 session is still mfa_required (age passes, assurance does not)", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal1", [{ method: "password", timestamp: NOW - 30 }]);
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "mfa_required" });
  });

  it("an EXPIRED aal1 session reports expiry, not MFA (re-login, not re-challenge)", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal1", [{ method: "password", timestamp: NOW - 3600 }]);
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "session_expired" });
  });
});

// ── Client-clock independence ────────────────────────────────────────────────

describe("client clock cannot extend a session", () => {
  it("the decision uses server time + the SIGNED amr stamp, so client time is irrelevant", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2", sessionAged(20 * 60));

    // Simulate a client that has wound its clock back an hour. The only clock the
    // server consults is its own (Date.now inside the gate), and the anchor comes
    // from the signed token — a client cannot supply or move either one.
    const realNow = Date.now;
    try {
      Date.now = () => realNow() - 3600_000;
      // Anchor is fixed; only the SERVER clock moved backwards, so this proves
      // the check reads the server clock rather than any client-supplied value.
      await expect(requireSecureAdmin()).resolves.toMatchObject({ id: FOUNDER.id });
    } finally {
      Date.now = realNow;
    }

    // With the true server clock restored, the same session is expired again.
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "session_expired" });
  });
});

// ── Non-throwing context (the /admin layout shell) ───────────────────────────

describe("getSecureAdminContext — layout shell states", () => {
  it("reports session_expired and discloses NO timing to the caller", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2", sessionAged(16 * 60));
    const ctx = await getSecureAdminContext();
    expect(ctx.status).toBe("session_expired");
    expect(ctx.sessionExpiresAtMs).toBeNull();
  });

  it("an authorized founder gets a deadline for the honest UI countdown", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2", sessionAged(5 * 60));
    const ctx = await getSecureAdminContext();
    expect(ctx.status).toBe("authorized");
    expect(ctx.sessionExpiresAtMs).toBeGreaterThan(Date.now());
    // ~10 minutes of a 15-minute window remain.
    expect(ctx.sessionExpiresAtMs! - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000 + 2000);
  });

  it("never leaks a deadline in unauthorized states", async () => {
    portalOn();
    setUser({ id: "00000009-0000-0000-0000-000000000009", email: "someone@else.edu" });
    setAal("aal2", sessionAged(60));
    expect(await getSecureAdminContext()).toMatchObject({
      status: "denied",
      sessionExpiresAtMs: null,
    });
  });
});
