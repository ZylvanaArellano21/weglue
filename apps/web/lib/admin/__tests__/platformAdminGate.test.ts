import { describe, it, expect, beforeEach, vi } from "vitest";

// ============================================================================
// Admin Dashboard × platform-admin identities
// ============================================================================
// The dashboard must authenticate the founder with NO public.profiles row, and
// `app_metadata.account_type` must never grant access on its own. These two
// facts are the whole point of the identity-isolation work, so they get direct
// tests rather than being inferred from the gate's structure.

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAAL: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../../supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: h.getUser, mfa: { getAuthenticatorAssuranceLevel: h.getAAL } },
    from: h.from,
  }),
}));

import {
  requireSecureAdmin,
  getSecureAdminContext,
  SecureAdminError,
} from "../secureAdmin";
import { isAllowlistedAdmin } from "../adminEnv";

const FOUNDER_ID = "94387196-e84c-4a66-acf9-6f3d754bc27f";
const FOUNDER_EMAIL = "founder-admin@example.com";

/** The founder's real shape after the operation: platform admin, no profile. */
const FOUNDER_USER = {
  id: FOUNDER_ID,
  email: FOUNDER_EMAIL,
  app_metadata: {
    provider: "email",
    providers: ["email"],
    account_type: "platform_admin",
  },
};

function env({
  ids = FOUNDER_ID,
  emails = FOUNDER_EMAIL,
  portal = "true",
  writes = "false",
}: Partial<Record<"ids" | "emails" | "portal" | "writes", string>> = {}) {
  process.env.ADMIN_PORTAL_ENABLED = portal;
  process.env.ADMIN_WRITES_ENABLED = writes;
  process.env.ADMIN_FOUNDER_USER_IDS = ids;
  process.env.ADMIN_FOUNDER_EMAILS = emails;
}

function aal(level: "aal1" | "aal2") {
  h.getAAL.mockResolvedValue({
    data: { currentLevel: level, nextLevel: "aal2", currentAuthenticationMethods: [] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_WRITES_ENABLED;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
  delete process.env.ADMIN_FOUNDER_EMAILS;
  // Any attempt to read a table during authorization is a bug — the gate must
  // never depend on public.profiles.
  h.from.mockImplementation((table: string) => {
    throw new Error(`admin gate must not query "${table}" during authorization`);
  });
});

describe("the dashboard authenticates WITHOUT a public.profiles row", () => {
  it("authorizes the founder on UUID + email + aal2 with no profile lookup", async () => {
    env();
    h.getUser.mockResolvedValue({ data: { user: FOUNDER_USER } });
    aal("aal2");

    const user = await requireSecureAdmin();
    expect(user.id).toBe(FOUNDER_ID);
    // The whole point: zero table reads happened to decide authorization.
    expect(h.from).not.toHaveBeenCalled();
  });

  it("reports 'authorized' from the non-throwing context too", async () => {
    env();
    h.getUser.mockResolvedValue({ data: { user: FOUNDER_USER } });
    aal("aal2");

    const ctx = await getSecureAdminContext();
    expect(ctx.status).toBe("authorized");
    expect(h.from).not.toHaveBeenCalled();
  });

  it("keeps the immutable UUID as the identity it authorizes", async () => {
    env();
    h.getUser.mockResolvedValue({ data: { user: FOUNDER_USER } });
    aal("aal2");
    const user = await requireSecureAdmin();
    // Same UUID that exists in auth.users — never a profile id, never an email.
    expect(user.id).toBe("94387196-e84c-4a66-acf9-6f3d754bc27f");
  });
});

describe("account_type NEVER grants dashboard access", () => {
  it("denies a platform-admin identity whose UUID is not allowlisted", async () => {
    env({ ids: "00000000-0000-0000-0000-000000000000" });
    h.getUser.mockResolvedValue({ data: { user: FOUNDER_USER } });
    aal("aal2");

    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "denied" });
  });

  it("denies a platform-admin identity when the allowlist is empty (fail closed)", async () => {
    env({ ids: "" });
    h.getUser.mockResolvedValue({ data: { user: FOUNDER_USER } });
    aal("aal2");

    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "denied" });
  });

  it("denies a matching EMAIL paired with a non-allowlisted UUID", async () => {
    env({ ids: "11111111-1111-1111-1111-111111111111" });
    h.getUser.mockResolvedValue({
      data: { user: { ...FOUNDER_USER, id: "impostor-id" } },
    });
    aal("aal2");

    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "denied" });
  });

  it("the allowlist primitive ignores account_type entirely", () => {
    process.env.ADMIN_FOUNDER_USER_IDS = "some-other-id";
    // Even a perfectly-formed platform-admin marker grants nothing.
    expect(isAllowlistedAdmin(FOUNDER_USER as any)).toBe(false);
  });
});

describe("MFA and the kill switches still bind the founder", () => {
  it("denies an aal1 session even with the correct UUID and marker", async () => {
    env();
    h.getUser.mockResolvedValue({ data: { user: FOUNDER_USER } });
    aal("aal1");

    await expect(requireSecureAdmin()).rejects.toMatchObject({ reason: "mfa_required" });
  });

  it("blocks writes while ADMIN_WRITES_ENABLED is not 'true'", async () => {
    env({ writes: "false" });
    h.getUser.mockResolvedValue({ data: { user: FOUNDER_USER } });
    aal("aal2");

    // Reads are fine…
    await expect(requireSecureAdmin()).resolves.toBeTruthy();
    // …writes are not.
    await expect(requireSecureAdmin({ write: true })).rejects.toMatchObject({
      reason: "writes_disabled",
    });
  });

  it("blocks everything while the portal kill switch is off", async () => {
    env({ portal: "false" });
    h.getUser.mockResolvedValue({ data: { user: FOUNDER_USER } });
    aal("aal2");

    await expect(requireSecureAdmin()).rejects.toMatchObject({
      reason: "portal_disabled",
    });
    // Fail-closed: the session was never even read.
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated request", async () => {
    env();
    h.getUser.mockResolvedValue({ data: { user: null } });

    await expect(requireSecureAdmin()).rejects.toBeInstanceOf(SecureAdminError);
  });
});
