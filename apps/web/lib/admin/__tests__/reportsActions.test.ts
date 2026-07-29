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

import { setReportStatus } from "../reportsActions";
import { SecureAdminError } from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const R = (n: number) => `0000000b-0000-0000-0000-00000000000${n}`;

function aal2() {
  h.getAAL.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [] } });
}
function asFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  aal2();
}

function seed() {
  return makeDb({
    reports: [
      { id: R(1), status: "pending", entity_type: "post", entity_id: "p1", content_snapshot: null, attachment_snapshot: null },
      { id: R(2), status: "reviewing", entity_type: "message", entity_id: "m1", content_snapshot: "SECRET BODY", attachment_snapshot: { url: "x" } },
      { id: R(3), status: "resolved", entity_type: "club", entity_id: "c1", content_snapshot: null },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.holder.db = seed();
  asFounder();
});

describe("setReportStatus — canonical transitions", () => {
  it("moves pending → reviewing", async () => {
    const res = await setReportStatus(R(1), "reviewing");
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.reports.find((r: any) => r.id === R(1)).status).toBe("reviewing");
  });

  it("moves pending → resolved and reviewing → dismissed", async () => {
    expect((await setReportStatus(R(1), "resolved")).ok).toBe(true);
    expect((await setReportStatus(R(2), "dismissed")).ok).toBe(true);
  });

  it("reopens resolved → pending", async () => {
    const res = await setReportStatus(R(3), "pending");
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.reports.find((r: any) => r.id === R(3)).status).toBe("pending");
  });

  it("rejects an invalid transition (resolved → reviewing)", async () => {
    const res = await setReportStatus(R(3), "reviewing");
    expect(res.ok).toBe(false);
    expect(h.holder.db.tables.reports.find((r: any) => r.id === R(3)).status).toBe("resolved");
  });

  it("rejects a no-op transition (pending → pending)", async () => {
    const res = await setReportStatus(R(1), "pending");
    expect(res.ok).toBe(false);
  });

  it("rejects an unsupported status value", async () => {
    const res = await setReportStatus(R(1), "banned");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Unsupported/);
  });

  it("rejects an invalid report id", async () => {
    const res = await setReportStatus("not-a-uuid", "resolved");
    expect(res.ok).toBe(false);
  });

  it("fails when the report does not exist", async () => {
    const res = await setReportStatus(R(9), "resolved");
    expect(res.ok).toBe(false);
  });
});

describe("setReportStatus — authorization", () => {
  it("denies a non-founder", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: "student", email: "s@my.edu" } } });
    await expect(setReportStatus(R(1), "resolved")).rejects.toBeInstanceOf(SecureAdminError);
  });

  it("denies when writes are disabled", async () => {
    process.env.ADMIN_WRITES_ENABLED = "false";
    await expect(setReportStatus(R(1), "resolved")).rejects.toBeInstanceOf(SecureAdminError);
  });

  it("denies an aal1 session", async () => {
    h.getAAL.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2", currentAuthenticationMethods: [] } });
    await expect(setReportStatus(R(1), "resolved")).rejects.toBeInstanceOf(SecureAdminError);
  });
});

describe("setReportStatus — evidence safety", () => {
  it("never writes to evidence columns during a transition", async () => {
    await setReportStatus(R(2), "resolved");
    const row = h.holder.db.tables.reports.find((r: any) => r.id === R(2));
    // Only status changed; retained snapshot columns are untouched (and never
    // read into a reporter-visible surface).
    expect(row.status).toBe("resolved");
    expect(row.content_snapshot).toBe("SECRET BODY");
    expect(row.attachment_snapshot).toEqual({ url: "x" });
  });
});
