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

import { listEditHistory, getAuditStatus } from "../historyData";
import { SecureAdminError } from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };

function asFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  h.getAAL.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] } });
}

function seed() {
  return makeDb(
    {
      events: [
        { id: "ev-edited", title: "Edited Event", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-10T00:00:00Z" },
        { id: "ev-untouched", title: "Fresh Event", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
      ],
      clubs: [],
      profiles: [],
      messages: [
        { id: "m-edited", sender_id: "u1", conversation_id: "c1", message_type: "text", content: "PRIVATE", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-05T00:00:00Z", deleted_at: null },
        { id: "m-deleted", sender_id: "u1", conversation_id: "c1", message_type: "text", content: "PRIVATE2", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-05T00:00:00Z", deleted_at: "2026-07-06T00:00:00Z" },
      ],
    },
    []
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.holder.db = seed();
});

describe("listEditHistory — canonical, honest", () => {
  it("surfaces only entities whose updated_at advanced past creation", async () => {
    asFounder();
    const res = await listEditHistory({ type: "event" });
    expect(res.rows.map((r) => r.id)).toContain("ev-edited");
    expect(res.rows.map((r) => r.id)).not.toContain("ev-untouched");
  });

  it("never fabricates editor or before/after values", async () => {
    asFounder();
    const res = await listEditHistory({ type: "event" });
    for (const r of res.rows) {
      expect(r.editor_known).toBe(false);
      expect(r.before_after_recorded).toBe(false);
    }
  });

  it("excludes deleted messages and never leaks message content", async () => {
    asFounder();
    const res = await listEditHistory({ type: "message" });
    expect(res.rows.map((r) => r.id)).toContain("m-edited");
    expect(res.rows.map((r) => r.id)).not.toContain("m-deleted");
    expect(JSON.stringify(res)).not.toContain("PRIVATE");
  });

  it("denies a non-founder", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: "x", email: "x@my.edu" } } });
    await expect(listEditHistory()).rejects.toBeInstanceOf(SecureAdminError);
  });
});

describe("getAuditStatus — honest unavailable state", () => {
  it("reports no canonical table but active structured logging", async () => {
    asFounder();
    const s = await getAuditStatus();
    expect(s.hasCanonicalTable).toBe(false);
    expect(s.structuredLoggingActive).toBe(true);
    expect(s.persistedQueriesAvailable).toBe(false);
    expect(s.logTag).toBe("admin_audit");
    expect(s.coverage.length).toBeGreaterThan(0);
    expect(s.coverage.some((c) => c.namespace === "report.setStatus")).toBe(true);
  });

  it("denies a non-founder", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: "x", email: "x@my.edu" } } });
    await expect(getAuditStatus()).rejects.toBeInstanceOf(SecureAdminError);
  });
});
