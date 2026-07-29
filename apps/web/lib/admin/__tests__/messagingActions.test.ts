import { describe, it, expect, beforeEach, vi } from "vitest";

// Same harness shape as contentActions.test.ts: mock the SSR client (getUser +
// MFA aal) and inject an in-memory PostgREST-style fake for the service-role
// client. Extended with neq / is / ilike so channel + reveal + search paths run.
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
  revealMessageBody,
  searchMessageContent,
  createChannel,
  renameChannel,
  setChannelPermission,
  deleteEmptyChannel,
  setNotificationRead,
} from "../messagingActions";
import * as messagingActions from "../messagingActions";
import { SecureAdminError } from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const CONV = (n: number) => `0000000b-0000-0000-0000-00000000000${n}`;
const CH = (n: number) => `0000000c-0000-0000-0000-00000000000${n}`;
const MSG = (n: number) => `0000000d-0000-0000-0000-00000000000${n}`;
const NOTIF = (n: number) => `0000000e-0000-0000-0000-00000000000${n}`;
const now = Math.floor(Date.now() / 1000);

function aal2(methods: any[] = []) {
  h.getAAL.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: methods } });
}
function asFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  aal2();
}
/** Founder with a FRESH TOTP verification (for the reveal / content-search path). */
function asFounderStepUp() {
  asFounder();
  aal2([{ method: "totp", timestamp: now - 20 }]);
}
function asNonFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  h.getUser.mockResolvedValue({ data: { user: { id: "student", email: "s@my.edu" } } });
  aal2();
}

// ── In-memory PostgREST-style fake (eq/neq/in/is/not/ilike + head count) ──────
function makeDb(initial: Record<string, any[]>) {
  const tables: Record<string, any[]> = {};
  for (const k of Object.keys(initial)) tables[k] = (initial[k] ?? []).map((r) => ({ ...r }));

  function from(table: string) {
    const st: any = { table, op: "select", filters: [], update: null, insert: null };
    const b: any = {
      select(_c: string, opts?: any) {
        st.head = !!opts?.head;
        st.count = !!opts?.count;
        return b;
      },
      insert(v: any) { st.op = "insert"; st.insert = Array.isArray(v) ? v : [v]; return b; },
      update(v: any) { st.op = "update"; st.update = v; return b; },
      delete() { st.op = "delete"; return b; },
      eq(col: string, val: any) { st.filters.push({ type: "eq", col, val }); return b; },
      neq(col: string, val: any) { st.filters.push({ type: "neq", col, val }); return b; },
      in(col: string, vals: any[]) { st.filters.push({ type: "in", col, vals }); return b; },
      is(col: string, val: any) { st.filters.push({ type: "is", col, val }); return b; },
      not(col: string, _op: string, val: any) { st.filters.push({ type: "not", col, val }); return b; },
      ilike(col: string, pat: string) { st.filters.push({ type: "ilike", col, pat }); return b; },
      or() { return b; },
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
        if (f.type === "neq") return row[f.col] !== f.val;
        if (f.type === "in") return f.vals.includes(row[f.col]);
        if (f.type === "is") return f.val === null ? row[f.col] == null : row[f.col] === f.val;
        if (f.type === "not") return f.val === null ? row[f.col] != null : row[f.col] !== f.val;
        if (f.type === "ilike") {
          const needle = String(f.pat).replace(/%/g, "").toLowerCase();
          return String(row[f.col] ?? "").toLowerCase().includes(needle);
        }
        return true;
      });
    }
    function exec(single: boolean) {
      const arr = tables[table] || (tables[table] = []);
      if (st.op === "insert") {
        const rows = st.insert.map((r: any) => ({ id: r.id ?? `gen-${Math.random().toString(36).slice(2)}`, ...r }));
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
    conversations: [
      { id: CONV(1), type: "club_group", club_id: "club1", name: null, created_by: "u1", deleted_at: null },
      { id: CONV(2), type: "group", club_id: null, name: "Study crew", created_by: "u1", deleted_at: null },
      { id: CONV(3), type: "direct", club_id: null, name: null, created_by: "u1", deleted_at: null },
    ],
    conversation_channels: [
      { id: CH(1), conversation_id: CONV(1), name: "general", kind: "main", post_permission: "everyone", is_restricted: false, display_order: 0 },
      { id: CH(2), conversation_id: CONV(1), name: "announcements", kind: "channel", post_permission: "officers", is_restricted: true, display_order: 1 },
      { id: CH(3), conversation_id: CONV(1), name: "empty-chan", kind: "channel", post_permission: "everyone", is_restricted: false, display_order: 2 },
    ],
    messages: [
      { id: MSG(1), conversation_id: CONV(1), channel_id: CH(2), sender_id: "u2", message_type: "text", content: "Secret meeting at 5pm", attachment_url: null, attachment_name: null, attachment_size: null, attachment_mime: null, deleted_at: null },
      { id: MSG(2), conversation_id: CONV(1), channel_id: CH(2), sender_id: "u2", message_type: "text", content: "This was unsent", attachment_url: null, deleted_at: "2026-07-01T00:00:00Z" },
    ],
    profiles: [
      { id: "u1", full_name: "User One", username: "u1" },
      { id: "u2", full_name: "User Two", username: "u2" },
    ],
    polls: [],
    notifications: [{ id: NOTIF(1), user_id: "u1", type: "like", read: false, read_at: null }],
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

// ── Authorization ─────────────────────────────────────────────────────────────
describe("authorization", () => {
  it("denies a non-founder and never constructs the service-role client", async () => {
    asNonFounder();
    await expect(createChannel(CONV(1), "events")).rejects.toBeInstanceOf(SecureAdminError);
    await expect(setNotificationRead(NOTIF(1), true)).rejects.toBeInstanceOf(SecureAdminError);
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects every channel/notification write when the write kill switch is off", async () => {
    asFounder();
    process.env.ADMIN_WRITES_ENABLED = "false";
    await expect(createChannel(CONV(1), "events")).rejects.toMatchObject({ reason: "writes_disabled" });
    await expect(renameChannel(CH(2), "news")).rejects.toMatchObject({ reason: "writes_disabled" });
    await expect(setChannelPermission(CH(2), "everyone")).rejects.toMatchObject({ reason: "writes_disabled" });
    await expect(deleteEmptyChannel(CH(3))).rejects.toMatchObject({ reason: "writes_disabled" });
    await expect(setNotificationRead(NOTIF(1), true)).rejects.toMatchObject({ reason: "writes_disabled" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

// ── Sensitive reveal ──────────────────────────────────────────────────────────
describe("revealMessageBody — recent-MFA gated", () => {
  it("rejects when aal2 has no fresh TOTP (step-up required)", async () => {
    asFounder(); // aal2 but NO recent totp
    await expect(revealMessageBody(MSG(1))).rejects.toMatchObject({ reason: "stepup_required" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("reveals an active message body with a fresh TOTP verification", async () => {
    asFounderStepUp();
    const res = await revealMessageBody(MSG(1));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.content).toBe("Secret meeting at 5pm");
  });

  it("NEVER reveals retained content for a deleted message", async () => {
    asFounderStepUp();
    const res = await revealMessageBody(MSG(2));
    expect(res.ok).toBe(false);
    // No content is present anywhere in the (safe) failure result.
    expect(JSON.stringify(res)).not.toContain("This was unsent");
  });

  it("rejects an invalid message id", async () => {
    asFounderStepUp();
    const res = await revealMessageBody("not-a-uuid");
    expect(res.ok).toBe(false);
  });
});

// ── Sensitive content search ──────────────────────────────────────────────────
describe("searchMessageContent — recent-MFA gated", () => {
  it("requires a fresh TOTP verification", async () => {
    asFounder();
    await expect(searchMessageContent("secret")).rejects.toMatchObject({ reason: "stepup_required" });
  });

  it("enforces a minimum query length", async () => {
    asFounderStepUp();
    const res = await searchMessageContent("ab");
    expect(res.ok).toBe(false);
  });

  it("matches active messages and excludes deleted ones", async () => {
    asFounderStepUp();
    const res = await searchMessageContent("meeting");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.map((d) => d.id)).toContain(MSG(1));
      expect(res.data.map((d) => d.id)).not.toContain(MSG(2)); // deleted excluded
    }
  });

  it("does not return deleted-message content even on a matching term", async () => {
    asFounderStepUp();
    const res = await searchMessageContent("unsent");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toHaveLength(0);
  });
});

// ── Channel management ────────────────────────────────────────────────────────
describe("channel management", () => {
  it("creates a hashtag channel and reads it back", async () => {
    asFounder();
    const res = await createChannel(CONV(1), "Cool Events!");
    expect(res.ok).toBe(true);
    // Name is normalized like the canonical RPC.
    expect(h.holder.db.tables.conversation_channels.some((c: any) => c.name === "cool-events")).toBe(true);
  });

  it("refuses to create a channel on a direct message", async () => {
    asFounder();
    const res = await createChannel(CONV(3), "events");
    expect(res.ok).toBe(false);
  });

  it("renames a hashtag channel but never the Main chat", async () => {
    asFounder();
    const ok = await renameChannel(CH(2), "news-flash");
    expect(ok.ok).toBe(true);
    expect(h.holder.db.tables.conversation_channels.find((c: any) => c.id === CH(2)).name).toBe("news-flash");

    const main = await renameChannel(CH(1), "renamed-main");
    expect(main.ok).toBe(false);
    expect(h.holder.db.tables.conversation_channels.find((c: any) => c.id === CH(1)).name).toBe("general");
  });

  it("sets everyone/officers permission but rejects 'certain' and Main", async () => {
    asFounder();
    const off = await setChannelPermission(CH(3), "officers");
    expect(off.ok).toBe(true);
    expect(h.holder.db.tables.conversation_channels.find((c: any) => c.id === CH(3)).post_permission).toBe("officers");

    expect((await setChannelPermission(CH(3), "certain")).ok).toBe(false);
    expect((await setChannelPermission(CH(1), "officers")).ok).toBe(false); // main
  });

  it("removes an EMPTY channel but refuses a non-empty one and the Main chat", async () => {
    asFounder();
    // CH(3) empty-chan has no messages → removable.
    const del = await deleteEmptyChannel(CH(3));
    expect(del.ok).toBe(true);
    expect(h.holder.db.tables.conversation_channels.some((c: any) => c.id === CH(3))).toBe(false);

    // CH(2) announcements holds a message → refused (no cascade).
    const nonEmpty = await deleteEmptyChannel(CH(2));
    expect(nonEmpty.ok).toBe(false);
    expect(h.holder.db.tables.conversation_channels.some((c: any) => c.id === CH(2))).toBe(true);
    // The messages are untouched.
    expect(h.holder.db.tables.messages.some((m: any) => m.channel_id === CH(2))).toBe(true);

    // Main chat is never removable.
    const main = await deleteEmptyChannel(CH(1));
    expect(main.ok).toBe(false);
  });
});

// ── Notifications ─────────────────────────────────────────────────────────────
describe("setNotificationRead", () => {
  it("marks a notification read and unread", async () => {
    asFounder();
    const read = await setNotificationRead(NOTIF(1), true);
    expect(read.ok).toBe(true);
    expect(h.holder.db.tables.notifications.find((n: any) => n.id === NOTIF(1)).read).toBe(true);

    const unread = await setNotificationRead(NOTIF(1), false);
    expect(unread.ok).toBe(true);
    expect(h.holder.db.tables.notifications.find((n: any) => n.id === NOTIF(1)).read).toBe(false);
  });

  it("rejects an invalid notification id", async () => {
    asFounder();
    expect((await setNotificationRead("nope", true)).ok).toBe(false);
  });
});

// ── No message-mutation surface ───────────────────────────────────────────────
describe("no destructive message mutation is exported", () => {
  it("exposes no message delete/redact/restore/purge action", () => {
    const names = Object.keys(messagingActions);
    for (const banned of [
      "deleteMessage",
      "redactMessage",
      "restoreMessage",
      "purgeMessages",
      "clearDeletion",
      "hardDeleteMessage",
      "deleteConversation",
      "removeNotification",
      "resendNotification",
    ]) {
      expect(names).not.toContain(banned);
    }
    expect(names.sort()).toEqual([
      "createChannel",
      "deleteEmptyChannel",
      "renameChannel",
      "revealMessageBody",
      "searchMessageContent",
      "setChannelPermission",
      "setNotificationRead",
    ]);
  });
});
