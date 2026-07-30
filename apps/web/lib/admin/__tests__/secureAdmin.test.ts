import { describe, it, expect, beforeEach, vi } from "vitest";

// Control the SSR client's getUser + MFA assurance per test.
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
  SecureAdminError,
} from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };

function portalOn() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
}
function setUser(user: any) {
  getUser.mockResolvedValue({ data: { user } });
}
function setAal(level: "aal1" | "aal2", methods: any[] = [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }]) {
  getAAL.mockResolvedValue({
    data: { currentLevel: level, nextLevel: "aal2", currentAuthenticationMethods: methods },
  });
}

beforeEach(() => {
  getUser.mockReset();
  getAAL.mockReset();
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_WRITES_ENABLED;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
  delete process.env.ADMIN_FOUNDER_EMAILS;
});

describe("requireSecureAdmin — full gate order", () => {
  it("rejects when the portal kill switch is off (before any session lookup)", async () => {
    setUser(FOUNDER);
    setAal("aal2");
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "portal_disabled" });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    portalOn();
    setUser(null);
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("denies a correct email paired with a WRONG user id", async () => {
    portalOn();
    setUser({ id: "not-the-founder", email: FOUNDER.email });
    setAal("aal2");
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "denied" });
    // Never reached MFA — id check fails first.
    expect(getAAL).not.toHaveBeenCalled();
  });

  it("denies the correct user id while only at aal1 (MFA not satisfied)", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal1");
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "mfa_required" });
  });

  it("allows the correct user id at aal2", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2");
    await expect(requireSecureAdmin()).resolves.toMatchObject({ id: FOUNDER.id });
  });

  it("fails closed when the user-id allowlist is missing", async () => {
    process.env.ADMIN_PORTAL_ENABLED = "true"; // portal on, but NO allowlist
    setUser(FOUNDER);
    setAal("aal2");
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "denied" });
  });

  it("rejects writes when the write kill switch is off, allows when on", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2");
    await expect(requireSecureAdmin({ write: true })).rejects.toMatchObject({ reason: "writes_disabled" });
    process.env.ADMIN_WRITES_ENABLED = "true";
    await expect(requireSecureAdmin({ write: true })).resolves.toMatchObject({ id: FOUNDER.id });
  });

  it("exposes an HTTP status for route handlers", () => {
    expect(new SecureAdminError("unauthenticated").httpStatus).toBe(401);
    expect(new SecureAdminError("denied").httpStatus).toBe(403);
    expect(new SecureAdminError("mfa_required").httpStatus).toBe(403);
  });
});

describe("getSecureAdminContext — non-throwing shell status", () => {
  it("reports portal_disabled without a session lookup", async () => {
    expect(await getSecureAdminContext()).toMatchObject({ status: "portal_disabled" });
  });
  it("reports unauthenticated / denied / mfa_required / authorized", async () => {
    portalOn();

    setUser(null);
    expect((await getSecureAdminContext()).status).toBe("unauthenticated");

    setUser({ id: "x", email: "x@y.edu" });
    setAal("aal2");
    expect((await getSecureAdminContext()).status).toBe("denied");

    setUser(FOUNDER);
    setAal("aal1");
    expect((await getSecureAdminContext()).status).toBe("mfa_required");

    setUser(FOUNDER);
    setAal("aal2");
    expect((await getSecureAdminContext()).status).toBe("authorized");
  });
});

describe("requireRecentMfa — dangerous-operation step-up guard", () => {
  const now = Math.floor(Date.now() / 1000);
  it("passes only with a fresh TOTP verification on top of aal2", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2", [{ method: "totp", timestamp: now - 30 }]);
    await expect(requireRecentMfa(300)).resolves.toMatchObject({ id: FOUNDER.id });
  });
  it("rejects a stale (or missing) MFA verification", async () => {
    portalOn();
    setUser(FOUNDER);
    // 400s old: past the 300s step-up window but still INSIDE the 15-minute
    // absolute session max age, so `stepup_required` is what surfaces. (A TOTP
    // older than the session maximum makes the whole session expired instead —
    // asserted in the session-max-age suite.)
    setAal("aal2", [{ method: "totp", timestamp: now - 400 }]);
    await expect(requireRecentMfa(300)).rejects.toMatchObject({ reason: "stepup_required" });
  });
});
