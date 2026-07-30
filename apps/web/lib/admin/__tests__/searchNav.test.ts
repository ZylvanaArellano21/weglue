import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeDb } from "./fakeAdmin";

const h = vi.hoisted(() => {
  const holder = { db: null as any };
  return { getUser: vi.fn(), getAAL: vi.fn(), holder, createAdminClient: vi.fn(() => holder.db) };
});
vi.mock("../../supabase/server", () => ({
  createClient: () => ({ auth: { getUser: h.getUser, mfa: { getAuthenticatorAssuranceLevel: h.getAAL } } }),
}));
vi.mock("../../supabase/admin", () => ({ createAdminClient: h.createAdminClient }));

import { searchEntities } from "../data";
import { SecureAdminError } from "../secureAdmin";
import { ADMIN_NAV, findNavItem } from "../nav";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };

function asFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  h.getAAL.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.holder.db = makeDb({}, []);
  asFounder();
});

describe("searchEntities — Day-5 result surface", () => {
  it("returns the moderation result keys (reports, deletedContent, diagnostics)", async () => {
    const res = await searchEntities("");
    expect(res).toHaveProperty("reports");
    expect(res).toHaveProperty("deletedContent");
    expect(res).toHaveProperty("diagnostics");
    expect(Array.isArray(res.reports)).toBe(true);
  });

  it("returns empty results for a too-short query without scanning", async () => {
    const res = await searchEntities("a");
    expect(res.reports).toEqual([]);
    expect(res.deletedContent).toEqual([]);
    expect(res.diagnostics).toEqual([]);
  });

  it("denies a non-founder", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: "x", email: "x@my.edu" } } });
    await expect(searchEntities("chess")).rejects.toBeInstanceOf(SecureAdminError);
  });
});

describe("nav — Day-5 sections are live", () => {
  it("marks every Day-5 section ready", () => {
    const ready = new Map(ADMIN_NAV.map((i) => [i.href, i.ready]));
    for (const href of [
      "/admin/reports",
      "/admin/deleted-content",
      "/admin/edit-history",
      "/admin/audit-history",
      "/admin/data-health",
      "/admin/settings",
    ]) {
      expect(ready.get(href)).toBe(true);
    }
  });

  it("resolves nested routes to the right section", () => {
    expect(findNavItem("/admin/reports/abc")?.label).toBe("Reports");
    expect(findNavItem("/admin/data-health")?.label).toBe("Data Health");
  });
});
