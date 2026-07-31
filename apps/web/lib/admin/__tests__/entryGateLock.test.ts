// ============================================================================
// Lock Portal / Sign Out must revoke the entry-gate ticket
// ============================================================================
//
// `lockAdminPortal` is the dashboard's single combined Lock-portal / Sign-out
// action (the explicit button and the inactivity auto-lock both call it). After it
// runs, /admin must return an ordinary 404 again and the private gateway must be
// passed afresh — so the concealment can never outlive an explicit lock.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  cookieSet: vi.fn(),
  cookieGet: vi.fn(() => undefined),
}));

vi.mock("../../supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: h.getUser, signOut: h.signOut, mfa: { getAuthenticatorAssuranceLevel: vi.fn() } },
  }),
}));
// lockAdminPortal now records an attempt→outcome pair through the audit RPC.
vi.mock("../../supabase/admin", () => ({
  createAdminClient: () => ({ rpc: async () => ({ data: "audit-1", error: null }) }),
}));
vi.mock("next/headers", () => ({
  cookies: () => ({ set: h.cookieSet, get: h.cookieGet }),
}));

import { lockAdminPortal } from "../actions";
import { ADMIN_ENTRY_COOKIE_NAME, ADMIN_ENTRY_COOKIE_PATH } from "../entryGate";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };

beforeEach(() => {
  h.getUser.mockReset();
  h.signOut.mockClear();
  h.cookieSet.mockReset();
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
});

describe("lockAdminPortal revokes the entry ticket", () => {
  it("signs out AND deletes the entry-gate cookie", async () => {
    await expect(lockAdminPortal()).resolves.toMatchObject({ ok: true });

    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.cookieSet).toHaveBeenCalledTimes(1);

    const arg = h.cookieSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.name).toBe(ADMIN_ENTRY_COOKIE_NAME);
    expect(arg.value).toBe("");
    expect(arg.maxAge).toBe(0);
    expect(arg.path).toBe(ADMIN_ENTRY_COOKIE_PATH);
    expect(arg.httpOnly).toBe(true);
    expect(arg.sameSite).toBe("strict");
    expect((arg.expires as Date).getTime()).toBe(0);
  });

  it("still deletes the cookie when the Supabase sign-out fails", async () => {
    h.signOut.mockRejectedValueOnce(new Error("network"));
    await expect(lockAdminPortal()).resolves.toMatchObject({ ok: true });
    // Concealment must not survive a partial failure.
    expect(h.cookieSet).toHaveBeenCalledTimes(1);
    expect(h.cookieSet.mock.calls[0]?.[0]).toMatchObject({
      name: ADMIN_ENTRY_COOKIE_NAME,
      maxAge: 0,
    });
  });

  it("still deletes the cookie when there is no signed-in user", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } });
    await expect(lockAdminPortal()).resolves.toMatchObject({ ok: true });
    expect(h.cookieSet).toHaveBeenCalledTimes(1);
  });

  it("never writes the phrase or a ticket value into the cleared cookie", async () => {
    await lockAdminPortal();
    const arg = h.cookieSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(arg.value)).toHaveLength(0);
    expect(JSON.stringify(arg)).not.toMatch(/scrypt\$|phrase|password/i);
  });
});
