import { describe, it, expect, beforeEach, vi } from "vitest";

// Same harness shape as actions.test.ts: mock the SSR client (getUser + MFA aal)
// and inject an in-memory PostgREST-style fake for the service-role client.
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
  editPostCaption,
  removePostFromClub,
  editCommentContent,
  editEvent,
  upsertRsvp,
  removeRsvp,
} from "../contentActions";
import * as contentActions from "../contentActions";
import { SecureAdminError } from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const P = (n: number) => `0000000a-0000-0000-0000-00000000000${n}`;
const C = (n: number) => `0000000c-0000-0000-0000-00000000000${n}`;
const CM = (n: number) => `0000000e-0000-0000-0000-00000000000${n}`;
const EV = (n: number) => `0000000d-0000-0000-0000-00000000000${n}`;
const US = (n: number) => `0000000f-0000-0000-0000-00000000000${n}`;

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
function asNonFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  h.getUser.mockResolvedValue({ data: { user: { id: "student", email: "s@my.edu" } } });
  aal2();
}

// ── Minimal in-memory PostgREST-style fake (subset used by contentActions) ────
function makeDb(initial: Record<string, any[]>) {
  const tables: Record<string, any[]> = {};
  for (const k of Object.keys(initial)) tables[k] = (initial[k] ?? []).map((r) => ({ ...r }));

  function from(table: string) {
    const st: any = { table, op: "select", filters: [], update: null, insert: null, selAfter: false };
    const b: any = {
      select(_c: string, opts?: any) {
        if (st.op !== "select") st.selAfter = true;
        st.head = !!opts?.head;
        st.count = !!opts?.count;
        return b;
      },
      insert(v: any) { st.op = "insert"; st.insert = Array.isArray(v) ? v : [v]; return b; },
      update(v: any) { st.op = "update"; st.update = v; return b; },
      delete() { st.op = "delete"; return b; },
      eq(col: string, val: any) { st.filters.push({ type: "eq", col, val }); return b; },
      in(col: string, vals: any[]) { st.filters.push({ type: "in", col, vals }); return b; },
      not(col: string, _op: string, val: any) { st.filters.push({ type: "not", col, val }); return b; },
      order() { return b; },
      range() { return b; },
      limit() { return b; },
      maybeSingle() { return Promise.resolve(exec(true)); },
      single() { return Promise.resolve(exec(true)); },
      then(res: any, rej: any) { return Promise.resolve(exec(false)).then(res, rej); },
    };
    function match(row: any): boolean {
      return st.filters.every((f: any) => {
        if (f.type === "eq") return row[f.col] === f.val;
        if (f.type === "in") return f.vals.includes(row[f.col]);
        if (f.type === "not") return f.val === null ? row[f.col] !== null : row[f.col] !== f.val;
        return true;
      });
    }
    function exec(single: boolean) {
      const arr = tables[table] || (tables[table] = []);
      if (st.op === "insert") {
        const rows = st.insert.map((r: any) => ({ id: r.id ?? `gen-${Math.random()}`, ...r }));
        arr.push(...rows);
        return { data: single ? rows[0] : rows, error: null };
      }
      const matched = arr.filter(match);
      if (st.op === "update") {
        matched.forEach((r) => Object.assign(r, st.update));
        return { data: single ? matched[0] ?? null : matched, error: null };
      }
      if (st.op === "delete") {
        tables[table] = arr.filter((r) => !match(r));
        return { data: null, error: null };
      }
      if (st.head && st.count) return { data: null, count: matched.length, error: null };
      if (single) return { data: matched[0] ?? null, error: null };
      return { data: matched, count: matched.length, error: null };
    }
    return b;
  }
  return { from, tables };
}

function seed() {
  return makeDb({
    posts: [
      { id: P(1), author_id: "a1", club_id: C(1), post_type: "picture", image_url: "img", caption: "hello world" },
      { id: P(2), author_id: "a2", club_id: null, post_type: "picture", image_url: "img2", caption: "personal" },
    ],
    post_club_tags: [{ id: "t1", post_id: P(1), club_id: C(2) }],
    club_photos: [{ id: "ph1", post_id: P(1), club_id: C(1) }],
    post_comments: [
      { id: CM(1), post_id: P(1), user_id: "a1", content: "nice" },
      { id: CM(2), post_id: P(2), user_id: "a2", content: "second" },
    ],
    events: [
      {
        id: EV(1),
        club_id: C(1),
        created_by: US(1),
        title: "Kickoff",
        description: "desc",
        event_date: "2026-08-01",
        start_time: "10:00:00",
        end_time: "11:00:00",
        location: "Hall",
        building: "A",
        room: "101",
        visibility: "everyone",
        emoji: "🎉",
      },
      {
        id: EV(2),
        club_id: C(2),
        created_by: US(2),
        title: "Second",
        description: null,
        event_date: "2026-08-05",
        start_time: "09:00:00",
        end_time: "10:00:00",
        location: null,
        building: null,
        room: null,
        visibility: "members",
        emoji: null,
      },
    ],
    profiles: [
      { id: US(1), full_name: "User One", username: "u1" },
      { id: US(2), full_name: "User Two", username: "u2" },
    ],
    event_rsvps: [{ id: "r1", event_id: EV(1), user_id: US(1), status: "going" }],
  });
}

beforeEach(() => {
  h.getUser.mockReset();
  h.getAAL.mockReset();
  h.createAdminClient.mockClear();
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_WRITES_ENABLED;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
  delete process.env.ADMIN_FOUNDER_EMAILS;
  h.holder.db = seed();
});

describe("content write authorization", () => {
  it("denies a non-founder and never constructs the service-role client", async () => {
    asNonFounder();
    await expect(editPostCaption(P(1), "x")).rejects.toBeInstanceOf(SecureAdminError);
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
  it("rejects every mutation when the write kill switch is off", async () => {
    asFounder();
    process.env.ADMIN_WRITES_ENABLED = "false";
    await expect(editPostCaption(P(1), "x")).rejects.toMatchObject({ reason: "writes_disabled" });
    await expect(editCommentContent(CM(1), "x")).rejects.toMatchObject({ reason: "writes_disabled" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("editPostCaption", () => {
  it("edits a caption and reads it back", async () => {
    asFounder();
    const res = await editPostCaption(P(1), "  updated caption  ");
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.posts.find((p: any) => p.id === P(1)).caption).toBe("updated caption");
  });
  it("clears a caption to null when blank", async () => {
    asFounder();
    const res = await editPostCaption(P(1), "   ");
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.posts.find((p: any) => p.id === P(1)).caption).toBeNull();
  });
  it("rejects an over-long caption and leaves the row unchanged", async () => {
    asFounder();
    const res = await editPostCaption(P(1), "z".repeat(2001));
    expect(res).toMatchObject({ ok: false });
    expect(h.holder.db.tables.posts.find((p: any) => p.id === P(1)).caption).toBe("hello world");
  });
  it("rejects an invalid post id", async () => {
    asFounder();
    const res = await editPostCaption("not-a-uuid", "x");
    expect(res).toMatchObject({ ok: false });
  });
  it("does not touch unrelated posts", async () => {
    asFounder();
    await editPostCaption(P(1), "changed");
    expect(h.holder.db.tables.posts.find((p: any) => p.id === P(2)).caption).toBe("personal");
  });
});

describe("removePostFromClub (canonical unglue, not a delete)", () => {
  it("untags the primary club and cleans tags + photos, keeping the post row", async () => {
    asFounder();
    const res = await removePostFromClub(P(1), C(1));
    expect(res.ok).toBe(true);
    const post = h.holder.db.tables.posts.find((p: any) => p.id === P(1));
    expect(post).toBeTruthy(); // NOT deleted
    expect(post.club_id).toBeNull();
    expect(h.holder.db.tables.club_photos.some((ph: any) => ph.post_id === P(1) && ph.club_id === C(1))).toBe(false);
  });
  it("removes an extra (non-primary) club tag", async () => {
    asFounder();
    const res = await removePostFromClub(P(1), C(2)); // C(2) is a post_club_tags entry
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.post_club_tags.some((t: any) => t.post_id === P(1) && t.club_id === C(2))).toBe(false);
    // Primary tag untouched.
    expect(h.holder.db.tables.posts.find((p: any) => p.id === P(1)).club_id).toBe(C(1));
  });
  it("rejects removing a club the post is not tagged to", async () => {
    asFounder();
    const res = await removePostFromClub(P(2), C(1)); // P(2) has no club
    expect(res).toMatchObject({ ok: false });
  });
});

describe("editCommentContent", () => {
  it("edits comment text and reads it back", async () => {
    asFounder();
    const res = await editCommentContent(CM(1), "edited text");
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.post_comments.find((c: any) => c.id === CM(1)).content).toBe("edited text");
  });
  it("rejects an empty comment and leaves the row unchanged", async () => {
    asFounder();
    const res = await editCommentContent(CM(1), "   ");
    expect(res).toMatchObject({ ok: false });
    expect(h.holder.db.tables.post_comments.find((c: any) => c.id === CM(1)).content).toBe("nice");
  });
  it("does not touch unrelated comments", async () => {
    asFounder();
    await editCommentContent(CM(1), "changed");
    expect(h.holder.db.tables.post_comments.find((c: any) => c.id === CM(2)).content).toBe("second");
  });
});

describe("editEvent", () => {
  it("edits supported fields and validates chronology on the merged row", async () => {
    asFounder();
    const res = await editEvent(EV(1), { title: "Renamed", location: "New Hall" });
    expect(res.ok).toBe(true);
    const ev = h.holder.db.tables.events.find((e: any) => e.id === EV(1));
    expect(ev.title).toBe("Renamed");
    expect(ev.location).toBe("New Hall");
  });
  it("rejects an invalid date and leaves the event unchanged", async () => {
    asFounder();
    const res = await editEvent(EV(1), { event_date: "08/01/2026" });
    expect(res).toMatchObject({ ok: false });
    expect(h.holder.db.tables.events.find((e: any) => e.id === EV(1)).event_date).toBe("2026-08-01");
  });
  it("rejects start_time >= end_time (chronology, merged with existing)", async () => {
    asFounder();
    const res = await editEvent(EV(1), { start_time: "12:00" }); // existing end is 11:00
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).toMatch(/before end time/i);
  });
  it("rejects an invalid visibility value", async () => {
    asFounder();
    const res = await editEvent(EV(1), { visibility: "public" });
    expect(res).toMatchObject({ ok: false });
  });
  it("does not touch unrelated events", async () => {
    asFounder();
    await editEvent(EV(1), { title: "Changed" });
    expect(h.holder.db.tables.events.find((e: any) => e.id === EV(2)).title).toBe("Second");
  });
});

describe("RSVPs", () => {
  it("adds a new RSVP", async () => {
    asFounder();
    const res = await upsertRsvp(EV(1), US(2), "going");
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.event_rsvps.some((r: any) => r.event_id === EV(1) && r.user_id === US(2) && r.status === "going")).toBe(true);
  });
  it("updates an existing RSVP in place (no duplicate row)", async () => {
    asFounder();
    const res = await upsertRsvp(EV(1), US(1), "cant"); // US(1) already going
    expect(res.ok).toBe(true);
    const rows = h.holder.db.tables.event_rsvps.filter((r: any) => r.event_id === EV(1) && r.user_id === US(1));
    expect(rows).toHaveLength(1); // unique (event,user) preserved
    expect(rows[0].status).toBe("cant");
  });
  it("rejects an invalid status value", async () => {
    asFounder();
    const res = await upsertRsvp(EV(1), US(2), "maybe");
    expect(res).toMatchObject({ ok: false });
  });
  it("rejects an RSVP for a non-existent event", async () => {
    asFounder();
    const res = await upsertRsvp(EV(9), US(1), "going");
    expect(res).toMatchObject({ ok: false });
  });
  it("removes an existing RSVP", async () => {
    asFounder();
    const res = await removeRsvp(EV(1), US(1));
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.event_rsvps.some((r: any) => r.event_id === EV(1) && r.user_id === US(1))).toBe(false);
  });
  it("rejects removing an RSVP that does not exist", async () => {
    asFounder();
    const res = await removeRsvp(EV(1), US(2));
    expect(res).toMatchObject({ ok: false });
  });
  it("denies RSVP writes when the write kill switch is off", async () => {
    asFounder();
    process.env.ADMIN_WRITES_ENABLED = "false";
    await expect(upsertRsvp(EV(1), US(2), "going")).rejects.toMatchObject({ reason: "writes_disabled" });
    await expect(removeRsvp(EV(1), US(1))).rejects.toMatchObject({ reason: "writes_disabled" });
  });
});

describe("permanent-delete denial", () => {
  it("exposes no destructive delete/hide export for any Day-3 content entity", () => {
    const names = Object.keys(contentActions);
    for (const banned of ["deletePost", "deleteComment", "deleteEvent", "hidePost", "hideComment", "archiveEvent"]) {
      expect(names).not.toContain(banned);
    }
    // Only the safe, canonical operations are exported.
    expect(names.sort()).toEqual([
      "editCommentContent",
      "editEvent",
      "editPostCaption",
      "removePostFromClub",
      "removeRsvp",
      "upsertRsvp",
    ]);
  });
});
