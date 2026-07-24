import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the Supabase SSR server client so founder.ts never pulls in next/headers.
// Each test controls what auth.getUser() returns.
const getUser = vi.fn();
vi.mock("../../supabase/server", () => ({
  createClient: () => ({ auth: { getUser } }),
}));

import { isFounder, getFounderContext, requireFounder, FounderAuthError } from "../founder";

const FOUNDER_ID = "00000001-0000-0000-0000-000000000001";
const FOUNDER_EMAIL = "founder@weglue.app";

function setAllowlist(emails = FOUNDER_EMAIL, ids = FOUNDER_ID) {
  process.env.ADMIN_FOUNDER_EMAILS = emails;
  process.env.ADMIN_FOUNDER_USER_IDS = ids;
}

beforeEach(() => {
  getUser.mockReset();
  delete process.env.ADMIN_FOUNDER_EMAILS;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
});

describe("isFounder", () => {
  it("authorizes a user whose email is on the allowlist (case-insensitive)", () => {
    setAllowlist();
    expect(isFounder({ id: "x", email: "FOUNDER@weglue.app" })).toBe(true);
  });

  it("authorizes a user whose id is on the allowlist", () => {
    setAllowlist("", FOUNDER_ID);
    expect(isFounder({ id: FOUNDER_ID, email: "someone@else.edu" })).toBe(true);
  });

  it("denies a user not on the allowlist", () => {
    setAllowlist();
    expect(isFounder({ id: "other", email: "student@my.lonestar.edu" })).toBe(false);
  });

  it("denies a null user", () => {
    setAllowlist();
    expect(isFounder(null)).toBe(false);
  });

  it("fails CLOSED when no allowlist is configured", () => {
    // No env set → even a plausible account must be denied.
    expect(isFounder({ id: FOUNDER_ID, email: FOUNDER_EMAIL })).toBe(false);
  });

  it("does not authorize on an empty-string email against empty allowlist entry", () => {
    setAllowlist("", "");
    expect(isFounder({ id: "", email: "" })).toBe(false);
  });
});

describe("getFounderContext", () => {
  it("returns unauthenticated when there is no session", async () => {
    setAllowlist();
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getFounderContext()).toEqual({ status: "unauthenticated", user: null });
  });

  it("returns denied for an authenticated non-founder", async () => {
    setAllowlist();
    const user = { id: "nope", email: "student@my.lonestar.edu" };
    getUser.mockResolvedValue({ data: { user } });
    const ctx = await getFounderContext();
    expect(ctx.status).toBe("denied");
    expect(ctx.user).toBe(user);
  });

  it("returns authorized for the founder", async () => {
    setAllowlist();
    const user = { id: FOUNDER_ID, email: FOUNDER_EMAIL };
    getUser.mockResolvedValue({ data: { user } });
    const ctx = await getFounderContext();
    expect(ctx.status).toBe("authorized");
    expect(ctx.user).toBe(user);
  });
});

describe("requireFounder", () => {
  it("throws FounderAuthError(unauthenticated) with no session", async () => {
    setAllowlist();
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireFounder()).rejects.toMatchObject({ name: "FounderAuthError", status: "unauthenticated" });
  });

  it("throws FounderAuthError(denied) for a non-founder — direct server-action protection", async () => {
    setAllowlist();
    getUser.mockResolvedValue({ data: { user: { id: "nope", email: "x@y.edu" } } });
    await expect(requireFounder()).rejects.toBeInstanceOf(FounderAuthError);
    await expect(requireFounder()).rejects.toMatchObject({ status: "denied" });
  });

  it("resolves to the founder user when authorized", async () => {
    setAllowlist();
    const user = { id: FOUNDER_ID, email: FOUNDER_EMAIL };
    getUser.mockResolvedValue({ data: { user } });
    await expect(requireFounder()).resolves.toBe(user);
  });
});
