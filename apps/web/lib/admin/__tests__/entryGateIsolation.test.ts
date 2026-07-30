// ============================================================================
// The entry gateway is CONCEALMENT ONLY — it must never grant authorization
// ============================================================================
//
// The single most important property of this hardening layer: passing the private
// gateway changes nothing about who is an administrator. These tests hold the
// gateway "open" (a valid ticket issued, every entry env var configured) and then
// re-assert the ENTIRE pre-existing security chain, proving each gate still fails
// exactly as it did before the gateway existed.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";

const getUser = vi.fn();
const getAAL = vi.fn();
vi.mock("../../supabase/server", () => ({
  createClient: () => ({
    auth: { getUser, mfa: { getAuthenticatorAssuranceLevel: getAAL } },
  }),
}));

import { requireSecureAdmin, getSecureAdminContext } from "../secureAdmin";
import { isAllowlistedAdmin } from "../adminEnv";
import { issueEntryTicket, verifyEntryTicket } from "../entryGate";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const IMPOSTOR = { id: "99999999-9999-9999-9999-999999999999", email: "attacker@example.com" };
const ENTRY_SECRET = "e".repeat(48);

/** Configure the entry gateway as fully open — the strongest possible attacker. */
function gatewayPassed() {
  process.env.ADMIN_ENTRY_PATH = "/q7-lantern-mesa-04";
  process.env.ADMIN_ENTRY_SECRET_HASH =
    "scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2E=$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYQ==";
  process.env.ADMIN_ENTRY_COOKIE_SECRET = ENTRY_SECRET;
}
function portalOn() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
}
function setUser(user: unknown) {
  getUser.mockResolvedValue({ data: { user } });
}
function setAal(level: "aal1" | "aal2", methods: unknown[] = [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }]) {
  getAAL.mockResolvedValue({
    data: { currentLevel: level, nextLevel: "aal2", currentAuthenticationMethods: methods },
  });
}

beforeEach(() => {
  getUser.mockReset();
  getAAL.mockReset();
  for (const k of [
    "ADMIN_PORTAL_ENABLED",
    "ADMIN_WRITES_ENABLED",
    "ADMIN_FOUNDER_USER_IDS",
    "ADMIN_FOUNDER_EMAILS",
    "ADMIN_ENTRY_PATH",
    "ADMIN_ENTRY_SECRET_HASH",
    "ADMIN_ENTRY_COOKIE_SECRET",
  ]) {
    delete process.env[k];
  }
  gatewayPassed(); // every test below runs with the gateway already satisfied
});

describe("a valid entry ticket grants NO administrator data", () => {
  it("holds a genuinely valid ticket (the premise of these tests)", async () => {
    const { value } = await issueEntryTicket(ENTRY_SECRET, 10, 1_000);
    expect(await verifyEntryTicket(ENTRY_SECRET, value, 1_000)).not.toBeNull();
  });

  it("still denies a non-founder UUID", async () => {
    portalOn();
    setUser(IMPOSTOR);
    setAal("aal2");
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "denied" });
  });

  it("still denies the founder EMAIL paired with a wrong UUID", async () => {
    portalOn();
    setUser({ id: IMPOSTOR.id, email: FOUNDER.email });
    setAal("aal2");
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "denied" });
  });

  it("still denies the founder UUID paired with a wrong email", async () => {
    portalOn();
    setUser({ id: FOUNDER.id, email: "someone.else@example.com" });
    setAal("aal2");
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "denied" });
  });

  it("still denies an unauthenticated caller", async () => {
    portalOn();
    setUser(null);
    setAal("aal1");
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("still requires MFA — aal1 is denied even for the founder", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal1");
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "mfa_required" });
  });

  it("still fails closed when the portal kill switch is off", async () => {
    setUser(FOUNDER);
    setAal("aal2");
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "portal_disabled" });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("still fails closed when no founder allowlist is configured", async () => {
    process.env.ADMIN_PORTAL_ENABLED = "true";
    setUser(FOUNDER);
    setAal("aal2");
    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "denied" });
  });

  it("still rejects EVERY mutation while writes are disabled", async () => {
    portalOn();
    delete process.env.ADMIN_WRITES_ENABLED;
    setUser(FOUNDER);
    setAal("aal2");
    // Reads pass for the real founder…
    await expect(requireSecureAdmin()).resolves.toMatchObject({ id: FOUNDER.id });
    // …but any write is refused.
    await expect(requireSecureAdmin({ write: true })).rejects.toMatchObject({
      reason: "writes_disabled",
    });
    for (const value of ["false", "FALSE", "0", "", "yes"]) {
      process.env.ADMIN_WRITES_ENABLED = value;
      await expect(requireSecureAdmin({ write: true })).rejects.toMatchObject({
        reason: "writes_disabled",
      });
    }
  });

  it("lets the real aal2 founder through, exactly as before", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2");
    await expect(requireSecureAdmin()).resolves.toMatchObject({ id: FOUNDER.id });
    await expect(getSecureAdminContext()).resolves.toMatchObject({ status: "authorized" });
  });
});

describe("the authorization layer does not read entry-gate configuration", () => {
  it("isAllowlistedAdmin ignores the gateway entirely", () => {
    portalOn();
    expect(isAllowlistedAdmin(FOUNDER)).toBe(true);
    expect(isAllowlistedAdmin(IMPOSTOR)).toBe(false);

    // Removing every entry-gate variable must not change any verdict: the
    // gateway is not an input to authorization.
    delete process.env.ADMIN_ENTRY_PATH;
    delete process.env.ADMIN_ENTRY_SECRET_HASH;
    delete process.env.ADMIN_ENTRY_COOKIE_SECRET;
    expect(isAllowlistedAdmin(FOUNDER)).toBe(true);
    expect(isAllowlistedAdmin(IMPOSTOR)).toBe(false);
  });

  it("cannot be spoofed by presenting the entry cookie as an identity", () => {
    portalOn();
    // A ticket is not a user; anything shaped like one is still not on the list.
    expect(isAllowlistedAdmin({ id: "wg_x1", email: "wg_x1" })).toBe(false);
    expect(isAllowlistedAdmin({ id: ENTRY_SECRET, email: FOUNDER.email })).toBe(false);
  });
});
