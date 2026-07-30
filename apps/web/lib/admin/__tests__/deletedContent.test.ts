import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeDb } from "./fakeAdmin";

const h = vi.hoisted(() => {
  const holder = { db: null as any };
  return { getUser: vi.fn(), getAAL: vi.fn(), holder, createAdminClient: vi.fn(() => holder.db) };
});
vi.mock("../../supabase/server", () => ({
  createClient: () => ({ auth: { getUser: h.getUser, mfa: { getAuthenticatorAssuranceLevel: h.getAAL } } }),
}));
vi.mock("../../supabase/admin", () => ({ createAdminClient: h.createAdminClient }));

import { listDeletedContent, getDeletedContentSummary } from "../deletedContentData";
import { reactivateClub } from "../deletedContentActions";
import { SecureAdminError } from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const CID = "0000000c-0000-0000-0000-000000000001";

function asFounder(write = false) {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = write ? "true" : "false";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  h.getAAL.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] } });
}

function seed() {
  return makeDb(
    {
      clubs: [
        { id: CID, name: "Dead Club", handle: "dead", is_active: false, updated_at: "2026-07-20T00:00:00Z", university_id: null },
        { id: "c-live", name: "Live Club", handle: "live", is_active: true, updated_at: "2026-07-20T00:00:00Z", university_id: null },
      ],
      conversations: [
        { id: "conv-del", type: "group", name: "Gone Group", club_id: null, created_by: "u1", deleted_at: "2026-07-21T00:00:00Z" },
        { id: "conv-live", type: "group", name: "Active Group", club_id: null, created_by: "u1", deleted_at: null },
      ],
      messages: [
        { id: "msg-del", conversation_id: "conv-live", sender_id: "u1", deleted_by: "u1", message_type: "text", content: "SHOULD NOT APPEAR", deleted_at: "2026-07-22T00:00:00Z" },
        { id: "msg-live", conversation_id: "conv-live", sender_id: "u1", deleted_by: null, message_type: "text", content: "hi", deleted_at: null },
      ],
      profiles: [{ id: "u1", full_name: "User One", username: "userone" }],
      reports: [],
    },
    []
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.holder.db = seed();
});

describe("listDeletedContent — safe unified list", () => {
  it("surfaces deactivated clubs, deleted conversations, and deleted messages (metadata only)", async () => {
    asFounder();
    const res = await listDeletedContent();
    const byType = (t: string) => res.rows.filter((r) => r.entity_type === t);
    expect(byType("club").length).toBe(1);
    expect(byType("conversation").length).toBe(1);
    expect(byType("message").length).toBe(1);
  });

  it("never exposes a deleted message body and locks restore/purge", async () => {
    asFounder();
    const res = await listDeletedContent({ type: "message" });
    const msg = res.rows[0]!;
    expect(msg.privacy_locked).toBe(true);
    expect(msg.restorable).toBe(false);
    expect(msg.purgeable).toBe(false);
    expect(JSON.stringify(res)).not.toContain("SHOULD NOT APPEAR");
  });

  it("marks deactivated clubs restorable and conversations not", async () => {
    asFounder();
    const club = (await listDeletedContent({ type: "club" })).rows[0]!;
    expect(club.restorable).toBe(true);
    const conv = (await listDeletedContent({ type: "conversation" })).rows[0]!;
    expect(conv.restorable).toBe(false);
    expect(conv.purgeable).toBe(false);
  });

  it("filters by restore capability", async () => {
    asFounder();
    const restorable = await listDeletedContent({ restorable: "restorable" });
    expect(restorable.rows.every((r) => r.restorable)).toBe(true);
    const locked = await listDeletedContent({ restorable: "locked" });
    expect(locked.rows.every((r) => !r.restorable)).toBe(true);
  });

  it("summary counts each source", async () => {
    asFounder();
    const s = await getDeletedContentSummary();
    expect(s.clubs).toBe(1);
    expect(s.conversations).toBe(1);
    expect(s.messages).toBe(1);
    expect(s.restorable).toBe(1);
  });
});

describe("reactivateClub — the only canonical restore", () => {
  it("reactivates a deactivated club with read-back", async () => {
    asFounder(true);
    const res = await reactivateClub(CID);
    expect(res.ok).toBe(true);
    expect(h.holder.db.tables.clubs.find((c: any) => c.id === CID).is_active).toBe(true);
  });

  it("refuses an already-active club", async () => {
    asFounder(true);
    const res = await reactivateClub("c-live");
    expect(res.ok).toBe(false);
  });

  it("denies when writes are disabled", async () => {
    asFounder(false);
    await expect(reactivateClub(CID)).rejects.toBeInstanceOf(SecureAdminError);
  });

  it("rejects an invalid id", async () => {
    asFounder(true);
    const res = await reactivateClub("nope");
    expect(res.ok).toBe(false);
  });
});
