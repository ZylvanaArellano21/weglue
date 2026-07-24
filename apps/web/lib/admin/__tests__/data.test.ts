import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted mock state (vi.mock factories run before top-level consts init).
const h = vi.hoisted(() => {
  const adminHolder = { impl: null as any };
  return {
    getUser: vi.fn(),
    adminHolder,
    // Spy on the SERVICE-ROLE client so we can prove it is never constructed for
    // a non-founder (service-role isolation) and inject a fake DB for founders.
    createAdminClient: vi.fn(() => adminHolder.impl),
  };
});

vi.mock("../../supabase/server", () => ({
  createClient: () => ({ auth: { getUser: h.getUser } }),
}));
vi.mock("../../supabase/admin", () => ({ createAdminClient: h.createAdminClient }));

const getUser = h.getUser;
const createAdminClient = h.createAdminClient;

import { searchEntities, listUsers } from "../data";
import { FounderAuthError } from "../founder";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };

function asFounder() {
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  getUser.mockResolvedValue({ data: { user: FOUNDER } });
}
function asNonFounder() {
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  getUser.mockResolvedValue({ data: { user: { id: "student", email: "student@my.lonestar.edu" } } });
}
function asAnonymous() {
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  getUser.mockResolvedValue({ data: { user: null } });
}

/**
 * A minimal chainable Supabase stub. Every builder method returns the builder;
 * awaiting it resolves to the preset rows for that table. Covers any query-chain
 * order used by the data layer.
 */
function makeFakeAdmin(tables: Record<string, any[]>, emails: Record<string, string> = {}) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const result = { data: rows, count: rows.length, error: null };
      const builder: any = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
            return () => builder;
          },
        }
      );
      return builder;
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: emails[id] ?? null } }, error: null }),
        listUsers: async () => ({ data: { users: [] }, error: null }),
      },
    },
  };
}

beforeEach(() => {
  getUser.mockReset();
  createAdminClient.mockClear();
  h.adminHolder.impl = null;
  delete process.env.ADMIN_FOUNDER_EMAILS;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
});

describe("authorization gate precedes data access", () => {
  it("searchEntities denies a non-founder and never constructs the service-role client", async () => {
    asNonFounder();
    await expect(searchEntities("robotics")).rejects.toBeInstanceOf(FounderAuthError);
    expect(createAdminClient).not.toHaveBeenCalled(); // service-role isolation
  });

  it("listUsers denies an unauthenticated caller and never touches the service-role client", async () => {
    asAnonymous();
    await expect(listUsers({})).rejects.toMatchObject({ status: "unauthenticated" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("searchEntities denies a non-founder for club/user queries alike", async () => {
    asNonFounder();
    await expect(searchEntities("chess club")).rejects.toBeInstanceOf(FounderAuthError);
  });
});

describe("founder query shaping", () => {
  it("short-circuits queries under 2 chars to empty results", async () => {
    asFounder();
    h.adminHolder.impl = makeFakeAdmin({});
    await expect(searchEntities("a")).resolves.toEqual({ users: [], clubs: [], universities: [], officers: [] });
  });

  it("returns human-readable, correctly-shaped user and club hits for the founder", async () => {
    asFounder();
    h.adminHolder.impl = makeFakeAdmin(
      {
        profiles: [{ id: "u1", full_name: "Marcus Rivera", username: "marcus", avatar_url: null }],
        clubs: [{ id: "c1", name: "Robotics Club", handle: "robotics", avatar_url: null, university_id: "uni1" }],
        universities: [{ id: "uni1", name: "Lone Star" }],
      },
      { u1: "marcus.rivera@my.lonestar.edu" }
    );

    const res = await searchEntities("rob");
    expect(createAdminClient).toHaveBeenCalled();
    expect(res.users).toEqual([
      { id: "u1", full_name: "Marcus Rivera", username: "marcus", avatar_url: null, email: "marcus.rivera@my.lonestar.edu" },
    ]);
    expect(res.clubs).toEqual([
      { id: "c1", name: "Robotics Club", handle: "robotics", avatar_url: null, university: "Lone Star" },
    ]);
  });

  it("paginates a users list with live counts and joined university names", async () => {
    asFounder();
    h.adminHolder.impl = makeFakeAdmin(
      {
        profiles: [
          {
            id: "u1",
            username: "marcus",
            full_name: "Marcus Rivera",
            avatar_url: null,
            university_id: "uni1",
            onboarding_completed: true,
            created_at: "2026-07-01T00:00:00Z",
          },
        ],
        universities: [{ id: "uni1", name: "Lone Star" }],
        club_members: [
          { user_id: "u1", role: "officer" },
          { user_id: "u1", role: "member" },
        ],
        reports: [],
      },
      { u1: "marcus.rivera@my.lonestar.edu" }
    );

    const res = await listUsers({ page: 1 });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({
      id: "u1",
      email: "marcus.rivera@my.lonestar.edu",
      university: "Lone Star",
      club_count: 2,
      officer_count: 1,
      onboarding_completed: true,
    });
    expect(res.pageSize).toBe(25);
  });
});
