import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const holder = { db: null as any };
  return {
    getUser: vi.fn(),
    getAAL: vi.fn(),
    holder,
    createAdminClient: vi.fn(() => holder.db),
  };
});
vi.mock("../../supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: h.getUser, mfa: { getAuthenticatorAssuranceLevel: h.getAAL } },
  }),
}));
vi.mock("../../supabase/admin", () => ({ createAdminClient: h.createAdminClient }));

import {
  isAuditTableAvailable,
  listAuditEvents,
  listAuditActions,
  getAuditEventDetail,
  getAuditSummary,
} from "../auditData";
import { SecureAdminError } from "../secureAdmin";
import { makeDb } from "./fakeAdmin";

const FOUNDER = { id: "94387196-0000-4000-8000-000000000001", email: "founder@weglue.app" };
const E1 = "aaaaaaaa-0000-4000-8000-00000000000a";
const E2 = "bbbbbbbb-0000-4000-8000-00000000000b";
const CORR = "cccccccc-0000-4000-8000-00000000000c";

function aal2() {
  h.getAAL.mockResolvedValue({
    data: {
      currentLevel: "aal2",
      nextLevel: "aal2",
      currentAuthenticationMethods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
    },
  });
}
function asFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  aal2();
}
function asNonFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  h.getUser.mockResolvedValue({ data: { user: { id: "student-1", email: "student@my.edu" } } });
  aal2();
}

const EVENTS = [
  {
    id: E1,
    occurred_at: "2026-07-30T10:00:00.000Z",
    actor_user_id: FOUNDER.id,
    actor_email: FOUNDER.email,
    action: "officer.demote",
    target_type: "club_officer",
    target_id: "11111111-0000-4000-8000-000000000002",
    reason: "Transfer step 1 of 2.",
    success: true,
    error_code: null,
    correlation_id: CORR,
    before_state: { role: "officer" },
    after_state: { role: "member" },
    metadata: { clubId: "33333333-0000-4000-8000-000000000004" },
  },
  {
    id: E2,
    occurred_at: "2026-07-30T10:00:01.000Z",
    actor_user_id: FOUNDER.id,
    actor_email: FOUNDER.email,
    action: "officer.promote",
    target_type: "club_officer",
    target_id: "55555555-0000-4000-8000-000000000006",
    reason: null,
    success: false,
    error_code: "last_officer",
    correlation_id: CORR,
    before_state: null,
    after_state: null,
    metadata: {},
  },
];

const CATALOG = [
  { action: "officer.demote", target_type: "club_officer", sensitivity: "destructive", requires_reason: true, description: "Demote an officer" },
  { action: "officer.promote", target_type: "club_officer", sensitivity: "sensitive", requires_reason: false, description: "Promote a member" },
];

beforeEach(() => {
  h.holder.db = makeDb({ admin_audit_events: EVENTS, admin_audit_actions: CATALOG });
  vi.clearAllMocks();
});

describe("authorization — the audit trail is founder-only, server-side", () => {
  it.each([
    ["isAuditTableAvailable", () => isAuditTableAvailable()],
    ["listAuditEvents", () => listAuditEvents()],
    ["listAuditActions", () => listAuditActions()],
    ["getAuditEventDetail", () => getAuditEventDetail(E1)],
    ["getAuditSummary", () => getAuditSummary()],
  ])("%s denies a non-founder", async (_name, call) => {
    asNonFounder();
    await expect(call()).rejects.toBeInstanceOf(SecureAdminError);
  });

  it("does not construct the service-role client for a denied caller", async () => {
    asNonFounder();
    await expect(listAuditEvents()).rejects.toBeInstanceOf(SecureAdminError);
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("denies when the portal kill switch is off", async () => {
    asFounder();
    process.env.ADMIN_PORTAL_ENABLED = "false";
    await expect(listAuditEvents()).rejects.toBeInstanceOf(SecureAdminError);
    process.env.ADMIN_PORTAL_ENABLED = "true";
  });

  it("denies an aal1 (no-MFA) founder session", async () => {
    asFounder();
    h.getAAL.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2", currentAuthenticationMethods: [] },
    });
    await expect(listAuditEvents()).rejects.toBeInstanceOf(SecureAdminError);
  });
});

describe("reads", () => {
  beforeEach(asFounder);

  it("lists events for the founder", async () => {
    const res = await listAuditEvents();
    expect(res.total).toBe(2);
    expect(res.rows.map((r) => r.id).sort()).toEqual([E1, E2].sort());
  });

  it("filters by outcome", async () => {
    expect((await listAuditEvents({ outcome: "failure" })).rows.map((r) => r.id)).toEqual([E2]);
    expect((await listAuditEvents({ outcome: "success" })).rows.map((r) => r.id)).toEqual([E1]);
  });

  it("filters by action and by correlation id", async () => {
    expect((await listAuditEvents({ action: "officer.demote" })).rows.map((r) => r.id)).toEqual([E1]);
    expect((await listAuditEvents({ correlationId: CORR })).total).toBe(2);
  });

  it("ignores an unrecognised target type instead of querying it", async () => {
    // A closed set is enforced server-side; a junk value must not reach the query.
    const res = await listAuditEvents({ targetType: "'; drop table --" });
    expect(res.total).toBe(2);
  });

  it("ignores a non-UUID correlation/actor/target filter", async () => {
    expect((await listAuditEvents({ correlationId: "not-a-uuid" })).total).toBe(2);
    expect((await listAuditEvents({ actorId: "nope" })).total).toBe(2);
  });

  it("returns a detail view with its correlated siblings", async () => {
    const d = await getAuditEventDetail(E1);
    expect(d).toBeTruthy();
    expect(d!.action).toBe("officer.demote");
    expect(d!.before_state).toEqual({ role: "officer" });
    expect(d!.after_state).toEqual({ role: "member" });
    expect(d!.sensitivity).toBe("destructive");
    expect(d!.related.map((r) => r.id)).toEqual([E2]);
  });

  it("returns null for a malformed id without touching the database", async () => {
    expect(await getAuditEventDetail("not-a-uuid")).toBeNull();
  });

  it("summarises the trail", async () => {
    const s = await getAuditSummary();
    expect(s.total).toBe(2);
    expect(s.failures).toBe(1);
    expect(s.distinctActors).toBe(1);
    expect(s.earliest).toBe("2026-07-30T10:00:00.000Z");
  });

  it("reports the table as available when it can be read", async () => {
    expect(await isAuditTableAvailable()).toBe(true);
  });
});

describe("degrades honestly when migration 055 is not applied", () => {
  beforeEach(asFounder);

  it("reports unavailable rather than throwing when the table is missing", async () => {
    h.holder.db = {
      ...makeDb({}),
      from: () => ({
        select: () => ({
          limit: () => Promise.resolve({ data: null, error: { code: "42P01", message: "does not exist" } }),
        }),
      }),
    };
    expect(await isAuditTableAvailable()).toBe(false);
  });

  it("treats PostgREST's schema-cache miss the same way", async () => {
    h.holder.db = {
      ...makeDb({}),
      from: () => ({
        select: () => ({
          limit: () => Promise.resolve({ data: null, error: { code: "PGRST205", message: "not found" } }),
        }),
      }),
    };
    expect(await isAuditTableAvailable()).toBe(false);
  });
});

describe("the read module exposes no mutation", () => {
  it("exports only read functions", async () => {
    const mod = await import("../auditData");
    const exported = Object.keys(mod).filter((k) => typeof (mod as any)[k] === "function");
    expect(exported.sort()).toEqual(
      ["getAuditEventDetail", "getAuditSummary", "isAuditTableAvailable", "listAuditActions", "listAuditEvents"].sort()
    );
  });
});
