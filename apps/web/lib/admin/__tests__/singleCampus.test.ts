import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const holder = { db: null as any };
  return {
    getUser: vi.fn(),
    getAAL: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
    holder,
    createAdminClient: vi.fn(() => holder.db),
  };
});
vi.mock("../../supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: h.getUser, signOut: h.signOut, mfa: { getAuthenticatorAssuranceLevel: h.getAAL } },
  }),
}));
vi.mock("../../supabase/admin", () => ({ createAdminClient: h.createAdminClient }));

import { addUniversity, editUniversity, setUniversityActive } from "../actions";
import { getCampusMode } from "../data2";
import { SecureAdminError } from "../secureAdmin";
import { makeDb } from "./fakeAdmin";

const FOUNDER = { id: "94387196-0000-4000-8000-000000000001", email: "founder@weglue.app" };
const LONE_STAR = "174a1779-0281-4d20-9b0d-a075c17fc01f";

function asFounderWithWrites() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  h.getAAL.mockResolvedValue({
    data: {
      currentLevel: "aal2",
      nextLevel: "aal2",
      currentAuthenticationMethods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
    },
  });
}

function db(singleCampus: boolean) {
  return makeDb({
    app_config: [{ id: 1, single_campus_mode: singleCampus, launch_university_id: LONE_STAR }],
    universities: [{ id: LONE_STAR, name: "Lone Star College", slug: "lone-star-college", is_active: true, created_at: "2026-01-01T00:00:00Z" }],
  });
}

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  asFounderWithWrites();
});

describe("getCampusMode", () => {
  it("reports single-campus mode and the launch university", async () => {
    h.holder.db = db(true);
    const mode = await getCampusMode();
    expect(mode.singleCampusMode).toBe(true);
    expect(mode.launchUniversityId).toBe(LONE_STAR);
    expect(mode.launchUniversityName).toBe("Lone Star College");
  });

  it("reports multi-campus when the flag is off", async () => {
    h.holder.db = db(false);
    expect((await getCampusMode()).singleCampusMode).toBe(false);
  });

  it("FAILS CLOSED to single-campus when app_config cannot be read", async () => {
    h.holder.db = {
      ...makeDb({}),
      from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }),
    };
    expect((await getCampusMode()).singleCampusMode).toBe(true);
  });

  it("denies a non-founder", async () => {
    h.holder.db = db(true);
    h.getUser.mockResolvedValue({ data: { user: { id: "s", email: "s@my.edu" } } });
    await expect(getCampusMode()).rejects.toBeInstanceOf(SecureAdminError);
  });
});

describe("addUniversity is gated by single-campus mode", () => {
  it("REFUSES while single_campus_mode is true, even for the founder with writes on", async () => {
    h.holder.db = db(true);
    const res = await addUniversity("Some Other College", "some-other-college");

    expect(res.ok).toBe(false);
    expect((res as any).error).toMatch(/single-campus mode/i);
  });

  it("creates NO university row when it refuses", async () => {
    h.holder.db = db(true);
    await addUniversity("Some Other College", "some-other-college");
    expect(h.holder.db.tables.universities).toHaveLength(1);
    expect(h.holder.db.tables.universities[0].id).toBe(LONE_STAR);
  });

  it("records the refusal as a durable FAILURE audit event", async () => {
    h.holder.db = db(true);
    await addUniversity("Some Other College", "some-other-college");

    const call = h.holder.db.rpcCalls.find((c: any) => c.fn === "admin_audit_log");
    expect(call).toBeTruthy();
    expect(call.args.p_action).toBe("university.add");
    expect(call.args.p_success).toBe(false);
    expect(call.args.p_error_code).toMatch(/single-campus mode/i);
  });

  it("refuses BEFORE validating input, so the gate cannot be probed with a valid name", async () => {
    h.holder.db = db(true);
    const bad = await addUniversity("x", "!!!");
    expect((bad as any).error).toMatch(/single-campus mode/i);
  });

  it("is a GATE, not a removal — it works again when single-campus mode is off", async () => {
    h.holder.db = db(false);
    const res = await addUniversity("Second Campus", "second-campus");
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.universities).toHaveLength(2);
  });

  it("still denies a non-founder regardless of campus mode", async () => {
    h.holder.db = db(false);
    h.getUser.mockResolvedValue({ data: { user: { id: "s", email: "s@my.edu" } } });
    await expect(addUniversity("Nope", "nope")).rejects.toBeInstanceOf(SecureAdminError);
  });

  it("still denies when the write kill switch is off", async () => {
    h.holder.db = db(false);
    process.env.ADMIN_WRITES_ENABLED = "false";
    await expect(addUniversity("Nope", "nope")).rejects.toBeInstanceOf(SecureAdminError);
    process.env.ADMIN_WRITES_ENABLED = "true";
  });
});

describe("the rest of university administration is untouched", () => {
  it("still allows editing the existing university", async () => {
    h.holder.db = db(true);
    const res = await editUniversity(LONE_STAR, { name: "Lone Star College " });
    expect(res.ok).toBe(true);
  });

  it("still allows activate/deactivate", async () => {
    h.holder.db = db(true);
    const res = await setUniversityActive(LONE_STAR, true);
    expect(res.ok).toBe(true);
  });

  it("never changes launch_university_id", async () => {
    h.holder.db = db(true);
    await addUniversity("Some Other College", "some-other-college");
    await editUniversity(LONE_STAR, { name: "Lone Star College" });
    expect(h.holder.db.tables.app_config[0].launch_university_id).toBe(LONE_STAR);
    expect(h.holder.db.tables.app_config[0].single_campus_mode).toBe(true);
  });
});
