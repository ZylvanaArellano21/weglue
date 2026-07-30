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

  // ── migration-054 administrator RPCs ───────────────────────────────────────
  // Faithful in-memory stand-ins for admin_set_club_member_role /
  // admin_remove_club_member / admin_transfer_club_officer: same status codes,
  // same order of checks, same officer-floor rule. The REAL atomicity and
  // concurrency behaviour is proven against Postgres in the migration harness
  // (supabase/scripts/test_054_last_officer.sql) — this fake exists so the
  // action layer's mapping of statuses to founder-facing results stays honest.
  function rpc(name: string, args: any) {
    const cm = tables.club_members || (tables.club_members = []);
    const co = tables.club_officers || (tables.club_officers = []);
    const officerCount = (clubId: string) =>
      cm.filter((r) => r.club_id === clubId && r.role === "officer").length;
    const dropRoster = (clubId: string, userId: string) => {
      tables.club_officers = co.filter((r) => !(r.club_id === clubId && r.user_id === userId));
    };
    const upsertRoster = (clubId: string, userId: string, title: string) => {
      const prof = (tables.profiles ?? []).find((p) => p.id === userId);
      const existing = co.find((r) => r.club_id === clubId && r.user_id === userId);
      const display = (prof?.full_name?.trim() || prof?.username || "Officer") as string;
      if (existing) {
        existing.role_title = title;
        existing.display_name = display;
        existing.avatar_url = prof?.avatar_url ?? null;
      } else {
        co.push({
          id: `gen-${idc++}`,
          club_id: clubId,
          user_id: userId,
          role_title: title,
          display_name: display,
          avatar_url: prof?.avatar_url ?? null,
        });
      }
    };

    const done = (status: string) => Promise.resolve({ data: status, error: null });

    if (name === "admin_set_club_member_role") {
      const { p_club_id, p_user_id, p_role, p_role_title, p_add_if_missing } = args;
      if (p_role !== "member" && p_role !== "officer") return done("invalid_role");
      const title = String(p_role_title ?? "Officer").trim();
      let member = cm.find((r) => r.club_id === p_club_id && r.user_id === p_user_id);

      if (!member) {
        if (!p_add_if_missing || p_role !== "officer") return done("not_member");
        if (title.length < 2 || title.length > 40) return done("invalid_role_title");
        const club = (tables.clubs ?? []).find((c) => c.id === p_club_id);
        if (!club) return done("club_not_found");
        const prof = (tables.profiles ?? []).find((p) => p.id === p_user_id);
        if (!prof) return done("user_not_found");
        if (club.university_id && prof.university_id && club.university_id !== prof.university_id) {
          return done("different_university");
        }
        member = { id: `gen-${idc++}`, club_id: p_club_id, user_id: p_user_id, role: "officer" };
        cm.push(member);
      }

      if (p_role === "officer") {
        if (title.length < 2 || title.length > 40) return done("invalid_role_title");
        member.role = "officer";
        upsertRoster(p_club_id, p_user_id, title);
        return done("ok");
      }
      if (member.role !== "officer") return done("not_officer");
      if (officerCount(p_club_id) <= 1) return done("last_officer");
      member.role = "member";
      dropRoster(p_club_id, p_user_id);
      return done("ok");
    }

    if (name === "admin_remove_club_member") {
      const { p_club_id, p_user_id } = args;
      const member = cm.find((r) => r.club_id === p_club_id && r.user_id === p_user_id);
      if (!member) return done("not_member");
      if (member.role === "officer") {
        if (officerCount(p_club_id) <= 1) return done("last_officer");
        dropRoster(p_club_id, p_user_id);
      }
      tables.club_members = cm.filter((r) => !(r.club_id === p_club_id && r.user_id === p_user_id));
      return done("ok");
    }

    if (name === "admin_transfer_club_officer") {
      const { p_club_id, p_from_user_id, p_to_user_id, p_role_title } = args;
      if (p_from_user_id === p_to_user_id) return done("same_user");
      const title = String(p_role_title ?? "Officer").trim();
      if (title.length < 2 || title.length > 40) return done("invalid_role_title");
      const club = (tables.clubs ?? []).find((c) => c.id === p_club_id);
      if (!club) return done("club_not_found");
      const from = cm.find((r) => r.club_id === p_club_id && r.user_id === p_from_user_id);
      if (!from || from.role !== "officer") return done("from_not_officer");
      const prof = (tables.profiles ?? []).find((p) => p.id === p_to_user_id);
      if (!prof) return done("user_not_found");
      if (club.university_id && prof.university_id && club.university_id !== prof.university_id) {
        return done("different_university");
      }
      const to = cm.find((r) => r.club_id === p_club_id && r.user_id === p_to_user_id);
      if (!to) cm.push({ id: `gen-${idc++}`, club_id: p_club_id, user_id: p_to_user_id, role: "officer" });
      else to.role = "officer";
      upsertRoster(p_club_id, p_to_user_id, title);
      from.role = "member";
      dropRoster(p_club_id, p_from_user_id);
      return done("ok");
    }

    return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
  }

  return { from, rpc, tables };
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
    // Wording now comes from the migration-054 `last_officer` status.
    if (!res.ok) expect(res.error).toMatch(/without any officer/i);
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
