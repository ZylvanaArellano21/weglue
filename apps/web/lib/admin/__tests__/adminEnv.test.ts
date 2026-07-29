import { describe, it, expect, beforeEach } from "vitest";
import {
  isAllowlistedAdmin,
  isPortalEnabled,
  isWritesEnabled,
  hasRecentMfa,
  shouldLockForInactivity,
  safeAdminNext,
  meetsAdminAssurance,
} from "../adminEnv";

const FOUNDER_ID = "00000001-0000-0000-0000-000000000001";
const FOUNDER_EMAIL = "founder@weglue.app";

beforeEach(() => {
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_WRITES_ENABLED;
  delete process.env.ADMIN_FOUNDER_EMAILS;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
});

describe("isAllowlistedAdmin — immutable user-id is authoritative", () => {
  it("authorizes a user whose id is allowlisted (id-only allowlist)", () => {
    process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER_ID;
    expect(isAllowlistedAdmin({ id: FOUNDER_ID, email: "anything@x.edu" })).toBe(true);
  });

  it("denies a correct EMAIL paired with a wrong user id", () => {
    process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER_ID;
    process.env.ADMIN_FOUNDER_EMAILS = FOUNDER_EMAIL;
    // Right email, wrong id → email must never grant on its own.
    expect(isAllowlistedAdmin({ id: "someone-else", email: FOUNDER_EMAIL })).toBe(false);
  });

  it("requires email consistency when an email allowlist is configured", () => {
    process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER_ID;
    process.env.ADMIN_FOUNDER_EMAILS = FOUNDER_EMAIL;
    // Right id, but email doesn't match the configured consistency list → deny.
    expect(isAllowlistedAdmin({ id: FOUNDER_ID, email: "changed@x.edu" })).toBe(false);
    // Right id + matching email (case-insensitive) → allow.
    expect(isAllowlistedAdmin({ id: FOUNDER_ID, email: "FOUNDER@weglue.app" })).toBe(true);
  });

  it("fails CLOSED when the user-id allowlist is absent or empty", () => {
    expect(isAllowlistedAdmin({ id: FOUNDER_ID, email: FOUNDER_EMAIL })).toBe(false);
    process.env.ADMIN_FOUNDER_USER_IDS = "";
    expect(isAllowlistedAdmin({ id: FOUNDER_ID, email: FOUNDER_EMAIL })).toBe(false);
    process.env.ADMIN_FOUNDER_USER_IDS = "   ,  ";
    expect(isAllowlistedAdmin({ id: FOUNDER_ID, email: FOUNDER_EMAIL })).toBe(false);
  });

  it("never authorizes a null user or a reviewer/tester email", () => {
    process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER_ID;
    expect(isAllowlistedAdmin(null)).toBe(false);
    // appreview account (not on the id allowlist) is denied.
    expect(isAllowlistedAdmin({ id: "review-account", email: "appreview@weglue.app" })).toBe(false);
  });
});

describe("kill switches read as exact 'true'", () => {
  it("portal is off unless exactly 'true'", () => {
    expect(isPortalEnabled()).toBe(false);
    process.env.ADMIN_PORTAL_ENABLED = "1";
    expect(isPortalEnabled()).toBe(false);
    process.env.ADMIN_PORTAL_ENABLED = "true";
    expect(isPortalEnabled()).toBe(true);
  });
  it("writes are off unless exactly 'true'", () => {
    expect(isWritesEnabled()).toBe(false);
    process.env.ADMIN_WRITES_ENABLED = "false";
    expect(isWritesEnabled()).toBe(false);
    process.env.ADMIN_WRITES_ENABLED = "true";
    expect(isWritesEnabled()).toBe(true);
  });
});

describe("assurance + step-up + inactivity", () => {
  it("only aal2 meets admin assurance", () => {
    expect(meetsAdminAssurance("aal2")).toBe(true);
    expect(meetsAdminAssurance("aal1")).toBe(false);
    expect(meetsAdminAssurance(null)).toBe(false);
  });

  it("hasRecentMfa is true only for a fresh TOTP verification", () => {
    const now = 1_000_000;
    expect(hasRecentMfa([{ method: "totp", timestamp: now - 60 }], now, 300)).toBe(true);
    expect(hasRecentMfa([{ method: "totp", timestamp: now - 600 }], now, 300)).toBe(false);
    expect(hasRecentMfa([{ method: "password", timestamp: now }], now, 300)).toBe(false);
    expect(hasRecentMfa([], now, 300)).toBe(false);
  });

  it("shouldLockForInactivity fires once the idle window elapses", () => {
    const now = 5_000_000;
    expect(shouldLockForInactivity(now - 1000, now, 10_000)).toBe(false);
    expect(shouldLockForInactivity(now - 10_000, now, 10_000)).toBe(true);
    expect(shouldLockForInactivity(now - 20_000, now, 10_000)).toBe(true);
  });

  it("safeAdminNext only allows same-origin /admin paths", () => {
    expect(safeAdminNext("/admin/posts")).toBe("/admin/posts");
    expect(safeAdminNext(null)).toBe("/admin");
    expect(safeAdminNext("/home")).toBe("/admin");
    expect(safeAdminNext("//evil.example.com")).toBe("/admin");
    expect(safeAdminNext("https://evil.example.com/admin")).toBe("/admin");
  });
});
