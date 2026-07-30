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

import { runDataHealth } from "../dataHealth";
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
  // One valid post + 7 orphaned posts (author missing) to exercise detection +
  // the strict example cap. Events include one impossible chronology.
  const orphanPosts = Array.from({ length: 7 }, (_, i) => ({ id: `bad-post-${i}`, author_id: `ghost-${i}`, club_id: null, image_url: "https://x/i.jpg" }));
  return makeDb(
    {
      profiles: [{ id: "u1", username: "userone", created_at: "2026-07-01T00:00:00Z" }],
      posts: [{ id: "good-post", author_id: "u1", club_id: null, image_url: "https://x/g.jpg" }, ...orphanPosts],
      events: [{ id: "ev-bad", title: "Impossible", event_date: "2026-07-10", start_time: "18:00", end_time: "17:00" }],
      universities: [{ id: "uni", name: "State U" }],
    },
    [{ id: "u1", email: "u1@my.edu" }]
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.holder.db = seed();
  asFounder();
});

describe("runDataHealth — read-only diagnostics", () => {
  it("returns a structured report with a scan timestamp and totals", async () => {
    const report = await runDataHealth();
    expect(typeof report.ranAt).toBe("string");
    expect(report.checks.length).toBeGreaterThanOrEqual(15);
    expect(report.totals).toHaveProperty("critical");
    expect(report.totals).toHaveProperty("affected");
  });

  it("detects orphaned posts and caps examples", async () => {
    const report = await runDataHealth();
    const check = report.checks.find((c) => c.key === "posts_missing_parents");
    expect(check).toBeDefined();
    expect(check!.affected).toBe(7);
    expect(check!.examples.length).toBeLessThanOrEqual(5); // strict EXAMPLE_CAP
    expect(check!.examples[0]!.href).toContain("/admin/posts/");
    expect(check!.severity).toBe("critical");
  });

  it("detects impossible event chronology", async () => {
    const report = await runDataHealth();
    const check = report.checks.find((c) => c.key === "events_invalid_chronology");
    expect(check!.affected).toBe(1);
  });

  it("does not perform any repair (data unchanged)", async () => {
    const before = h.holder.db.tables.posts.length;
    await runDataHealth();
    expect(h.holder.db.tables.posts.length).toBe(before);
  });

  it("never exposes secrets or push tokens in the report", async () => {
    const report = await runDataHealth();
    const json = JSON.stringify(report).toLowerCase();
    expect(json).not.toContain("service_role");
    expect(json).not.toContain("password");
    expect(json).not.toContain("push_token");
  });

  it("denies a non-founder", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: "x", email: "x@my.edu" } } });
    await expect(runDataHealth()).rejects.toBeInstanceOf(SecureAdminError);
  });
});
