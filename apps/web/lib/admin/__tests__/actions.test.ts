import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted mock state.
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
    auth: {
      getUser: h.getUser,
      signOut: h.signOut,
      mfa: { getAuthenticatorAssuranceLevel: h.getAAL },
    },
  }),
}));
vi.mock("../../supabase/admin", () => ({ createAdminClient: h.createAdminClient }));

import {
  addMembership,
  removeMembership,
  setMembershipRole,
  addOfficer,
  editOfficerTitle,
  removeGluemate,
  addUniversity,
  editUniversity,
  setUniversityActive,
} from "../actions";
import { SecureAdminError } from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const U = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
const C = (n: number) => `00000000-0000-0000-0000-0000000000c${n}`;
const UNI = (n: number) => `00000000-0000-0000-0000-0000000000e${n}`;

function aal2() {
  h.getAAL.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] } });
}
function asFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  aal2();
}
function asNonFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  h.getUser.mockResolvedValue({ data: { user: { id: "student", email: "s@my.edu" } } });
  aal2();
}
function asAnonymous() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  h.getUser.mockResolvedValue({ data: { user: null } });
}

// ── Minimal in-memory PostgREST-style fake ───────────────────────────────────
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") { depth++; cur += ch; }
    else if (ch === ")") { depth--; cur += ch; }
    else if (ch === "," && depth === 0) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function matchCond(row: any, c: string): boolean {
  const parts = c.split(".");
  const col = parts[0];
  const op = parts[1];
  const val = parts.slice(2).join(".");
  if (!col || op !== "eq") return false;
  return String(row[col]) === val;
}
function matchOr(row: any, expr: string): boolean {
  return splitTop(expr).some((tok) => {
    tok = tok.trim();
    if (tok.startsWith("and(")) return splitTop(tok.slice(4, -1)).every((c) => matchCond(row, c));
    return matchCond(row, tok);
  });
}
function matchAll(row: any, filters: any[]): boolean {
  return filters.every((f) => {
    if (f.type === "eq") return row[f.col] === f.val;
    if (f.type === "in") return f.vals.includes(row[f.col]);
    if (f.type === "or") return matchOr(row, f.expr);
    return true;
  });
}

function makeDb(initial: Record<string, any[]>) {
  const tables: Record<string, any[]> = {};
  for (const k of Object.keys(initial)) tables[k] = (initial[k] ?? []).map((r) => ({ ...r }));
  let idc = 5000;

  function from(table: string) {
    const st: any = { table, op: "select", filters: [], update: null, insert: null, count: false, head: false, selAfter: false };
    const b: any = {
      select(_c: string, opts?: any) {
        if (opts?.count) st.count = true;
        if (opts?.head) st.head = true;
        if (st.op !== "select") st.selAfter = true;
        return b;
      },
      insert(v: any) { st.op = "insert"; st.insert = Array.isArray(v) ? v : [v]; return b; },
      update(v: any) { st.op = "update"; st.update = v; return b; },
      delete() { st.op = "delete"; return b; },
      eq(col: string, val: any) { st.filters.push({ type: "eq", col, val }); return b; },
      in(col: string, vals: any[]) { st.filters.push({ type: "in", col, vals }); return b; },
      or(expr: string) { st.filters.push({ type: "or", expr }); return b; },
      order() { return b; },
      range() { return b; },
      limit() { return b; },
      maybeSingle() { return Promise.resolve(exec(true)); },
      single() { return Promise.resolve(exec(true)); },
      then(res: any, rej: any) { return Promise.resolve(exec(false)).then(res, rej); },
    };
    function exec(single: boolean) {
      const arr = tables[table] || (tables[table] = []);
      if (st.op === "insert") {
        const rows = st.insert.map((r: any) => ({ id: r.id ?? `gen-${idc++}`, ...r }));
        arr.push(...rows);
        return { data: st.selAfter || single ? (single ? rows[0] : rows) : null, error: null, count: null };
      }
      const matched = arr.filter((r) => matchAll(r, st.filters));
      if (st.op === "update") {
        matched.forEach((r) => Object.assign(r, st.update));
        return { data: st.selAfter || single ? (single ? matched[0] ?? null : matched) : null, error: null };
      }
      if (st.op === "delete") {
        tables[table] = arr.filter((r) => !matchAll(r, st.filters));
        return { data: null, error: null };
      }
      if (st.head && st.count) return { data: null, count: matched.length, error: null };
      if (single) return { data: matched[0] ?? null, error: null };
      return { data: matched, count: st.count ? matched.length : null, error: null };
    }
    return b;
  }
  return { from, tables };
}

function seed() {
  return makeDb({
    clubs: [
      { id: C(1), name: "Chess Club", university_id: UNI(1) },
      { id: C(2), name: "Robotics", university_id: UNI(2) },
    ],
    profiles: [
      { id: U(1), full_name: "Ann One", username: "ann", avatar_url: null, university_id: UNI(1) },
      { id: U(2), full_name: "Bob Two", username: "bob", avatar_url: null, university_id: UNI(1) },
      { id: U(3), full_name: "Cy Three", username: "cy", avatar_url: null, university_id: UNI(2) },
      { id: U(4), full_name: "Dee Four", username: "dee", avatar_url: null, university_id: UNI(1) },
    ],
    club_members: [
      { id: "m1", club_id: C(1), user_id: U(1), role: "officer" },
      { id: "m2", club_id: C(1), user_id: U(2), role: "member" },
    ],
    club_officers: [{ id: "o1", club_id: C(1), user_id: U(1), role_title: "President" }],
    universities: [{ id: UNI(1), name: "Lone Star", slug: "lone-star", is_active: true }],
    follows: [
      { id: "f1", follower_id: U(1), following_id: U(2), status: "accepted" },
      { id: "f2", follower_id: U(2), following_id: U(1), status: "accepted" },
      { id: "f3", follower_id: U(1), following_id: U(3), status: "accepted" },
    ],
  });
}

beforeEach(() => {
  h.getUser.mockReset();
  h.getAAL.mockReset();
  h.createAdminClient.mockClear();
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_WRITES_ENABLED;
  delete process.env.ADMIN_FOUNDER_EMAILS;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
  h.holder.db = seed();
});

// ── Authorization ────────────────────────────────────────────────────────────
describe("write authorization", () => {
  it("denies a non-founder and never constructs the service-role client", async () => {
    asNonFounder();
    await expect(addMembership(C(1), U(4))).rejects.toBeInstanceOf(SecureAdminError);
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
  it("denies an unauthenticated caller", async () => {
    asAnonymous();
    await expect(setMembershipRole(C(1), U(2), "officer")).rejects.toMatchObject({ reason: "unauthenticated" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
  it("rejects every mutation when the write kill switch is off", async () => {
    asFounder();
    process.env.ADMIN_WRITES_ENABLED = "false";
    await expect(addMembership(C(1), U(4))).rejects.toMatchObject({ reason: "writes_disabled" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
  it("rejects mutations when the portal kill switch is off", async () => {
    asFounder();
    process.env.ADMIN_PORTAL_ENABLED = "false";
    await expect(addUniversity("X College", "x-college")).rejects.toMatchObject({ reason: "portal_disabled" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
  it("denies an aal1 (MFA-not-satisfied) founder", async () => {
    asFounder();
    h.getAAL.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2", currentAuthenticationMethods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] } });
    await expect(addMembership(C(1), U(4))).rejects.toMatchObject({ reason: "mfa_required" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

// ── Memberships ──────────────────────────────────────────────────────────────
describe("memberships", () => {
  it("adds a valid new member", async () => {
    asFounder();
    const res = await addMembership(C(1), U(4));
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.club_members.some((m: any) => m.user_id === U(4) && m.club_id === C(1))).toBe(true);
  });
  it("rejects a duplicate (club_id, user_id) membership", async () => {
    asFounder();
    const res = await addMembership(C(1), U(2));
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toMatch(/already a member/i);
  });
  it("prevents a cross-university membership", async () => {
    asFounder();
    const res = await addMembership(C(1), U(3)); // U(3) is UNI(2), club is UNI(1)
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toMatch(/different university/i);
  });
  it("removes an ordinary member", async () => {
    asFounder();
    const res = await removeMembership(C(1), U(2));
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.club_members.some((m: any) => m.user_id === U(2))).toBe(false);
  });
  it("refuses to remove an officer (must demote first)", async () => {
    asFounder();
    const res = await removeMembership(C(1), U(1));
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toMatch(/demote/i);
  });
  it("rejects an invalid role value", async () => {
    asFounder();
    // @ts-expect-error intentionally invalid role
    const res = await setMembershipRole(C(1), U(2), "boss");
    expect(res).toMatchObject({ ok: false });
  });
});

// ── Officers ─────────────────────────────────────────────────────────────────
describe("officers", () => {
  it("promotes a member to officer and writes the roster", async () => {
    asFounder();
    const res = await setMembershipRole(C(1), U(2), "officer", "VP");
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.club_members.find((m: any) => m.user_id === U(2)).role).toBe("officer");
    expect(h.holder.db.tables.club_officers.some((o: any) => o.user_id === U(2) && o.role_title === "VP")).toBe(true);
  });
  it("protects the last officer from demotion", async () => {
    asFounder();
    const res = await setMembershipRole(C(1), U(1), "member"); // U(1) is the only officer
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toMatch(/only officer/i);
  });
  it("demotes an officer when another officer remains", async () => {
    asFounder();
    await setMembershipRole(C(1), U(2), "officer", "VP"); // now 2 officers
    const res = await setMembershipRole(C(1), U(1), "member");
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.club_members.find((m: any) => m.user_id === U(1)).role).toBe("member");
    expect(h.holder.db.tables.club_officers.some((o: any) => o.user_id === U(1))).toBe(false);
  });
  it("edits an officer title", async () => {
    asFounder();
    const res = await editOfficerTitle(C(1), U(1), "Chief");
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.club_officers.find((o: any) => o.user_id === U(1)).role_title).toBe("Chief");
  });
  it("rejects an officer title that is too short", async () => {
    asFounder();
    const res = await editOfficerTitle(C(1), U(1), "X");
    expect(res).toMatchObject({ ok: false });
  });
  it("adds an officer to a same-university club", async () => {
    asFounder();
    const res = await addOfficer(C(2), U(3), "Lead"); // both UNI(2)
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.club_members.some((m: any) => m.club_id === C(2) && m.user_id === U(3) && m.role === "officer")).toBe(true);
  });
});

// ── Gluemates ────────────────────────────────────────────────────────────────
describe("gluemates", () => {
  it("removes a mutual relationship by deleting both directions", async () => {
    asFounder();
    const res = await removeGluemate(U(1), U(2));
    expect(res.ok).toBe(true);
    const f = h.holder.db.tables.follows;
    expect(f.some((r: any) => r.follower_id === U(1) && r.following_id === U(2))).toBe(false);
    expect(f.some((r: any) => r.follower_id === U(2) && r.following_id === U(1))).toBe(false);
    // The one-way U(1)->U(3) follow is untouched.
    expect(f.some((r: any) => r.follower_id === U(1) && r.following_id === U(3))).toBe(true);
  });
  it("rejects a self relationship", async () => {
    asFounder();
    const res = await removeGluemate(U(1), U(1));
    expect(res).toMatchObject({ ok: false });
  });
});

// ── Universities ─────────────────────────────────────────────────────────────
describe("universities", () => {
  it("creates a new university", async () => {
    asFounder();
    const res = await addUniversity("New College", "new-college");
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.universities.some((u: any) => u.slug === "new-college")).toBe(true);
  });
  it("rejects a duplicate name", async () => {
    asFounder();
    const res = await addUniversity("Lone Star", "lone-star-2");
    expect(res).toMatchObject({ ok: false });
  });
  it("rejects an invalid slug", async () => {
    asFounder();
    const res = await editUniversity(UNI(1), { slug: "Bad Slug!" });
    expect(res).toMatchObject({ ok: false });
  });
  it("deactivates a university", async () => {
    asFounder();
    const res = await setUniversityActive(UNI(1), false);
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.universities.find((u: any) => u.id === UNI(1)).is_active).toBe(false);
  });
});
