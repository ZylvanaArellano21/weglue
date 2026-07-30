// ============================================================================
// Day 8 — action-layer contract for the migration-054 officer RPCs
// ============================================================================
//
// The atomicity and concurrency guarantees are proven against real Postgres in
// `supabase/scripts/test_054_last_officer.sql` (advisory lock, re-count,
// cascade exemptions, 2-way and 4-way races). THIS suite covers the other half:
// that the Server Actions route officer changes through the RPCs at all, map
// every status to safe founder-facing wording, and never fall back to the old
// check-then-write path.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const holder = { db: null as any };
  return {
    getUser: vi.fn(),
    getAAL: vi.fn(),
    rpc: vi.fn(),
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

import { setMembershipRole, addOfficer, removeMembership } from "../actions";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const CLUB = "00000000-0000-0000-0000-0000000000c1";
const USER = "00000000-0000-0000-0000-000000000002";

/** A DB stub whose only real behaviour is the RPC; reads return fixed rows. */
function stubDb(rows: Record<string, any>) {
  const table = (name: string) => ({
    select: () => table(name),
    eq: () => table(name),
    maybeSingle: async () => ({ data: rows[name] ?? null, error: null }),
    single: async () => ({ data: rows[name] ?? null, error: null }),
  });
  return { from: (name: string) => table(name), rpc: h.rpc };
}

function asFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  h.getAAL.mockResolvedValue({
    data: {
      currentLevel: "aal2",
      nextLevel: "aal2",
      currentAuthenticationMethods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
    },
  });
}

beforeEach(() => {
  h.getUser.mockReset();
  h.getAAL.mockReset();
  h.rpc.mockReset();
  h.createAdminClient.mockClear();
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_WRITES_ENABLED;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
  delete process.env.ADMIN_FOUNDER_EMAILS;
});

describe("officer changes go through the migration-054 RPCs", () => {
  it("demote calls admin_set_club_member_role rather than writing the table", async () => {
    asFounder();
    h.holder.db = stubDb({ club_members: { id: "m1", role: "officer" } });
    h.rpc.mockResolvedValue({ data: "ok", error: null });

    const res = await setMembershipRole(CLUB, USER, "member");
    expect(res.ok).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("admin_set_club_member_role", {
      p_club_id: CLUB,
      p_user_id: USER,
      p_role: "member",
      p_role_title: "Officer",
    });
  });

  it("add-officer asks the RPC to create the membership atomically", async () => {
    asFounder();
    h.holder.db = stubDb({ club_members: { id: "m9", role: "officer" } });
    h.rpc.mockResolvedValue({ data: "ok", error: null });

    const res = await addOfficer(CLUB, USER, "President");
    expect(res.ok).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("admin_set_club_member_role", {
      p_club_id: CLUB,
      p_user_id: USER,
      p_role: "officer",
      p_role_title: "President",
      p_add_if_missing: true,
    });
  });

  it("member removal goes through admin_remove_club_member", async () => {
    asFounder();
    h.holder.db = { ...stubDb({ club_members: { id: "m2", role: "member" } }) };
    // First read finds the member; the post-write read must find nothing.
    let reads = 0;
    h.holder.db.from = () => {
      const t: any = {
        select: () => t,
        eq: () => t,
        maybeSingle: async () => ({ data: reads++ === 0 ? { id: "m2", role: "member" } : null, error: null }),
      };
      return t;
    };
    h.rpc.mockResolvedValue({ data: "ok", error: null });

    const res = await removeMembership(CLUB, USER);
    expect(res.ok).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("admin_remove_club_member", {
      p_club_id: CLUB,
      p_user_id: USER,
    });
  });
});

describe("RPC statuses map to safe founder-facing wording", () => {
  const cases: Array<[string, RegExp]> = [
    ["last_officer", /without any officer/i],
    ["not_member", /not a member/i],
    ["not_officer", /not an officer/i],
    ["invalid_role_title", /2–40 characters/],
    ["different_university", /different university/i],
    ["club_not_found", /club not found/i],
    ["user_not_found", /user not found/i],
  ];

  it.each(cases)("status %s produces a clear message", async (status, expected) => {
    asFounder();
    h.holder.db = stubDb({ club_members: { id: "m1", role: "officer" } });
    h.rpc.mockResolvedValue({ data: status, error: null });

    const res = await setMembershipRole(CLUB, USER, "member");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(expected);
  });

  it("an UNKNOWN status still fails closed with a generic message", async () => {
    asFounder();
    h.holder.db = stubDb({ club_members: { id: "m1", role: "officer" } });
    h.rpc.mockResolvedValue({ data: "something_new", error: null });

    const res = await setMembershipRole(CLUB, USER, "member");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Could not complete this change.");
  });

  it("never leaks SQLSTATE, function names or DB detail to the founder", async () => {
    asFounder();
    h.holder.db = stubDb({ club_members: { id: "m1", role: "officer" } });
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: 'club_last_officer', code: "23514", details: "admin_set_club_member_role" },
    });

    const res = await setMembershipRole(CLUB, USER, "member");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("Could not demote officer.");
      expect(res.error).not.toMatch(/23514|admin_set_club_member_role|club_last_officer/);
    }
  });
});

describe("the gate still comes first", () => {
  it("no RPC is attempted while writes are disabled", async () => {
    asFounder();
    delete process.env.ADMIN_WRITES_ENABLED; // production posture during Day 8
    h.holder.db = stubDb({});

    await expect(setMembershipRole(CLUB, USER, "member")).rejects.toMatchObject({
      reason: "writes_disabled",
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("no RPC is attempted on an expired administrator session", async () => {
    asFounder();
    h.getAAL.mockResolvedValue({
      data: {
        currentLevel: "aal2",
        nextLevel: "aal2",
        currentAuthenticationMethods: [
          { method: "password", timestamp: Math.floor(Date.now() / 1000) - 3600 },
        ],
      },
    });
    h.holder.db = stubDb({});

    await expect(setMembershipRole(CLUB, USER, "member")).rejects.toMatchObject({
      reason: "session_expired",
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});
