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
  conversationTypeLabel,
  CONVERSATION_TYPE_LABEL,
  adminLinkForNotification,
  listConversations,
  listChannels,
  listMessages,
  listNotifications,
  getMessageDetail,
} from "../messagingData";
import { SecureAdminError } from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const CONV = (n: number) => `0000000b-0000-0000-0000-00000000000${n}`;
const CH = (n: number) => `0000000c-0000-0000-0000-00000000000${n}`;
const MSG = (n: number) => `0000000d-0000-0000-0000-00000000000${n}`;

function aal(level: "aal1" | "aal2") {
  h.getAAL.mockResolvedValue({ data: { currentLevel: level, nextLevel: "aal2", currentAuthenticationMethods: [] } });
}
function asFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  aal("aal2");
}
function asNonFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  h.getUser.mockResolvedValue({ data: { user: { id: "student", email: "s@my.edu" } } });
  aal("aal2");
}
function asAal1Founder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  aal("aal1");
}

// Minimal fake (eq/in/is/not + maybeSingle/then) sufficient for getMessageDetail.
function makeDb(initial: Record<string, any[]>) {
  const tables: Record<string, any[]> = {};
  for (const k of Object.keys(initial)) tables[k] = (initial[k] ?? []).map((r) => ({ ...r }));
  function from(table: string) {
    const st: any = { table, filters: [] };
    const b: any = {
      select(_c: string, opts?: any) { st.head = !!opts?.head; st.count = !!opts?.count; return b; },
      eq(col: string, val: any) { st.filters.push({ type: "eq", col, val }); return b; },
      in(col: string, vals: any[]) { st.filters.push({ type: "in", col, vals }); return b; },
      is(col: string, val: any) { st.filters.push({ type: "is", col, val }); return b; },
      not(col: string, _op: string, val: any) { st.filters.push({ type: "not", col, val }); return b; },
      or() { return b; },
      order() { return b; },
      range() { return b; },
      limit() { return b; },
      maybeSingle() { return Promise.resolve(exec(true)); },
      then(res: any, rej: any) { return Promise.resolve(exec(false)).then(res, rej); },
    };
    function match(row: any): boolean {
      return st.filters.every((f: any) => {
        if (f.type === "eq") return row[f.col] === f.val;
        if (f.type === "in") return f.vals.includes(row[f.col]);
        if (f.type === "is") return f.val === null ? row[f.col] == null : row[f.col] === f.val;
        if (f.type === "not") return f.val === null ? row[f.col] != null : row[f.col] !== f.val;
        return true;
      });
    }
    function exec(single: boolean) {
      const arr = tables[table] || (tables[table] = []);
      const matched = arr.filter(match);
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
    messages: [
      { id: MSG(1), conversation_id: CONV(1), channel_id: CH(1), sender_id: "u2", message_type: "text", content: "Hello there friend", attachment_url: null, attachment_name: null, attachment_size: null, attachment_mime: null, deleted_at: null, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
      { id: MSG(2), conversation_id: CONV(1), channel_id: CH(1), sender_id: "u2", message_type: "text", content: "This was unsent", attachment_url: "chat-attachments/abc/x.png", attachment_name: "x.png", attachment_size: 10, attachment_mime: "image/png", deleted_at: "2026-07-02T00:00:00Z", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-02T00:00:00Z" },
    ],
    conversations: [{ id: CONV(1), type: "club_group", name: null, club_id: "club1", deleted_at: null, created_by: "u1" }],
    conversation_channels: [{ id: CH(1), name: "general" }],
    clubs: [{ id: "club1", name: "Robotics", handle: "robotics", avatar_url: null, university_id: null }],
    profiles: [{ id: "u2", full_name: "User Two", username: "u2", avatar_url: null, university_id: null }],
    polls: [],
    reports: [],
  });
}

beforeEach(() => {
  h.getUser.mockReset();
  h.getAAL.mockReset();
  h.createAdminClient.mockClear();
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
  delete process.env.ADMIN_FOUNDER_EMAILS;
  h.holder.db = seed();
});

// ── Pure presentation helpers ─────────────────────────────────────────────────
describe("conversation-type mapping", () => {
  it("maps every canonical type to a clear label", () => {
    expect(conversationTypeLabel("direct")).toBe("Direct message");
    expect(conversationTypeLabel("group")).toBe("Custom group");
    expect(conversationTypeLabel("club_group")).toBe("Club chat");
    expect(conversationTypeLabel("officer_chat")).toBe("Official club chat");
    expect(Object.keys(CONVERSATION_TYPE_LABEL)).toEqual(["direct", "group", "club_group", "officer_chat"]);
  });
  it("falls back to the raw type for anything unexpected", () => {
    expect(conversationTypeLabel("mystery")).toBe("mystery");
  });
});

describe("adminLinkForNotification — safe canonical deep links only", () => {
  it("routes by entity_type/entity_id, never a raw client path", () => {
    expect(adminLinkForNotification({ entity_type: "event", entity_id: "e1", actor_id: null })).toBe("/admin/events/e1");
    expect(adminLinkForNotification({ entity_type: "club", entity_id: "c1", actor_id: null })).toBe("/admin/clubs/c1");
    expect(adminLinkForNotification({ entity_type: "message", entity_id: "m1", actor_id: null })).toBe("/admin/conversations/m1");
    expect(adminLinkForNotification({ entity_type: null, entity_id: null, actor_id: "a1" })).toBe("/admin/users/a1");
    expect(adminLinkForNotification({ entity_type: null, entity_id: null, actor_id: null })).toBeNull();
  });
});

// ── Authorization on every list loader ────────────────────────────────────────
describe("authorization", () => {
  it("denies a non-founder for every messaging loader (no service-role client)", async () => {
    asNonFounder();
    await expect(listConversations()).rejects.toBeInstanceOf(SecureAdminError);
    await expect(listChannels()).rejects.toBeInstanceOf(SecureAdminError);
    await expect(listMessages()).rejects.toBeInstanceOf(SecureAdminError);
    await expect(listNotifications()).rejects.toBeInstanceOf(SecureAdminError);
    await expect(getMessageDetail(MSG(1))).rejects.toBeInstanceOf(SecureAdminError);
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("denies an aal1 founder (MFA required) for messaging loaders", async () => {
    asAal1Founder();
    await expect(listConversations()).rejects.toMatchObject({ reason: "mfa_required" });
    await expect(listMessages()).rejects.toMatchObject({ reason: "mfa_required" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

// ── Deleted-message privacy in message detail ─────────────────────────────────
describe("getMessageDetail privacy", () => {
  it("returns a preview for an active text message", async () => {
    asFounder();
    const d = await getMessageDetail(MSG(1));
    expect(d).toBeTruthy();
    expect(d!.deleted).toBe(false);
    expect(d!.preview).toBe("Hello there friend");
    expect(d!.attachment).toBeNull(); // no attachment on this message
  });

  it("never exposes retained content or attachment for a deleted message", async () => {
    asFounder();
    const d = await getMessageDetail(MSG(2));
    expect(d).toBeTruthy();
    expect(d!.deleted).toBe(true);
    expect(d!.preview).toBeNull();
    expect(d!.attachment).toBeNull();
    expect(d!.poll).toBeNull();
    // The retained original text never appears anywhere in the payload.
    expect(JSON.stringify(d)).not.toContain("This was unsent");
    expect(JSON.stringify(d)).not.toContain("x.png");
  });
});
