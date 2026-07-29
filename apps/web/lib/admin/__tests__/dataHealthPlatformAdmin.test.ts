import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeDb } from "./fakeAdmin";

// ============================================================================
// Data Health × platform-admin identities
// ============================================================================
// The founder's admin identity intentionally has no public.profiles row. The
// "Auth users without a profile" check is `critical: true`, so counting it
// there would leave the dashboard permanently red for a correct state — the
// fastest way to train an operator to ignore a check that will one day be
// reporting a REAL partial-signup drift.
//
// These tests prove both halves: the intentional case is excluded, and the
// diagnostic is not weakened for anybody else.

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

import { runDataHealth } from "../dataHealth";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };

const PLATFORM_ADMIN_META = {
  provider: "email",
  providers: ["email"],
  account_type: "platform_admin",
};

function asFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  h.getAAL.mockResolvedValue({
    data: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [] },
  });
}

const check = (report: any, key: string) =>
  report.checks.find((c: any) => c.key === key);

beforeEach(() => {
  vi.clearAllMocks();
  asFounder();
});

describe("platform-admin identities are excluded from the missing-profile check", () => {
  beforeEach(() => {
    h.holder.db = makeDb(
      {
        // Only the student has a profile. The admin deliberately has none.
        profiles: [{ id: "student-1", username: "studentone" }],
        universities: [],
      },
      [
        { id: "student-1", email: "student@my.edu", app_metadata: { provider: "email" } },
        { id: "admin-1", email: "founder@gmail.com", app_metadata: PLATFORM_ADMIN_META },
      ]
    );
  });

  it("reports OK — the profile-less admin is not counted as drift", async () => {
    const report = await runDataHealth();
    const c = check(report, "auth_users_without_profiles");
    expect(c.affected).toBe(0);
    expect(c.severity).toBe("ok");
    expect(c.examples).toHaveLength(0);
  });

  it("lists the admin separately, and as healthy", async () => {
    const report = await runDataHealth();
    const c = check(report, "platform_admin_identities");
    expect(c).toBeDefined();
    expect(c.scanned).toBe(1); // one platform admin sampled
    expect(c.affected).toBe(0); // it has no profile row → correct
    expect(c.severity).toBe("ok");
  });

  it("does not count the admin toward the report's critical total", async () => {
    const report = await runDataHealth();
    expect(report.totals.critical).toBe(0);
  });
});

describe("the diagnostic is NOT weakened for ordinary users", () => {
  beforeEach(() => {
    h.holder.db = makeDb(
      { profiles: [{ id: "student-1", username: "studentone" }], universities: [] },
      [
        { id: "student-1", email: "ok@my.edu", app_metadata: { provider: "email" } },
        // A genuine partial-signup drift: student auth user, no profile row.
        { id: "student-2", email: "broken@my.edu", app_metadata: { provider: "email" } },
        // A Microsoft student, also missing a profile.
        { id: "student-3", email: "broken2@my.edu", app_metadata: { provider: "azure" } },
        // …alongside a healthy platform admin, which must not mask them.
        { id: "admin-1", email: "founder@gmail.com", app_metadata: PLATFORM_ADMIN_META },
      ]
    );
  });

  it("still flags ordinary auth users with no profile as critical", async () => {
    const report = await runDataHealth();
    const c = check(report, "auth_users_without_profiles");
    expect(c.affected).toBe(2);
    expect(c.severity).toBe("critical");
    expect(c.examples.map((e: any) => e.id).sort()).toEqual(["student-2", "student-3"]);
  });

  it("counts only the non-admin users as scanned by that check", async () => {
    const report = await runDataHealth();
    expect(check(report, "auth_users_without_profiles").scanned).toBe(3);
  });
});

describe("a platform admin that drifted back into having a profile is flagged", () => {
  beforeEach(() => {
    h.holder.db = makeDb(
      {
        // The failure mode this check exists for: migration 053's guard
        // regressed, or someone restored the row by hand.
        profiles: [{ id: "admin-1", username: "user_admin1" }],
        universities: [],
      },
      [{ id: "admin-1", email: "founder@gmail.com", app_metadata: PLATFORM_ADMIN_META }]
    );
  });

  it("reports it as critical", async () => {
    const report = await runDataHealth();
    const c = check(report, "platform_admin_identities");
    expect(c.affected).toBe(1);
    expect(c.severity).toBe("critical");
    expect(c.examples[0].id).toBe("admin-1");
  });
});

describe("the exclusion keys off server-controlled metadata only", () => {
  it("a user_metadata claim does not exempt anyone from the check", async () => {
    h.holder.db = makeDb({ profiles: [], universities: [] }, [
      {
        id: "spoofer",
        email: "sneaky@my.edu",
        // app_metadata is service-role-only; a student can only reach
        // user_metadata. The fake carries no account_type in app_metadata.
        app_metadata: { provider: "email" },
      } as any,
    ]);
    const report = await runDataHealth();
    const c = check(report, "auth_users_without_profiles");
    expect(c.affected).toBe(1);
    expect(c.severity).toBe("critical");
  });
});
