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

import {
  getReportDetail,
  isReportStatus,
  canTransition,
  REPORT_TRANSITIONS,
  reportEntityTypeLabel,
} from "../reportsData";
import { SecureAdminError } from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };

function asFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  h.getAAL.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] } });
}

function seed() {
  return makeDb(
    {
      reports: [
        { id: "r-post", status: "pending", entity_type: "post", entity_id: "post-1", entity_name: null, reason: "Spam", details: "look here", reporter_id: "u-rep", reporter_username: "reporter", reporter_email: "rep@my.edu", club_id: "club-1", created_at: "2026-07-20T00:00:00Z", content_snapshot: null, attachment_snapshot: null },
        { id: "r-msg", status: "reviewing", entity_type: "message", entity_id: "msg-1", entity_name: "Reported message", reason: "Harassment", details: null, reporter_id: "u-rep", reporter_username: "reporter", reporter_email: null, message_id: "msg-1", conversation_id: "conv-1", conversation_type: "direct", message_type: "text", message_sender_id: "u-bad", club_id: null, created_at: "2026-07-21T00:00:00Z", content_snapshot: "PRIVATE DELETED BODY", attachment_snapshot: { url: "https://x/y.jpg" } },
      ],
      posts: [{ id: "post-1", caption: "hello world caption", post_type: "picture" }],
      clubs: [{ id: "club-1", name: "Chess Club", handle: "chess", university_id: "uni-1" }],
      universities: [{ id: "uni-1", name: "State U" }],
      profiles: [
        { id: "u-rep", full_name: "Rep Orter", username: "reporter", avatar_url: null, university_id: "uni-1" },
        { id: "u-bad", full_name: "Bad Actor", username: "badactor", avatar_url: null, university_id: "uni-1" },
      ],
    },
    [
      { id: "u-rep", email: "rep@my.edu" },
      { id: "u-bad", email: "bad@my.edu" },
    ]
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.holder.db = seed();
  asFounder();
});

describe("transition helpers", () => {
  it("recognizes only canonical statuses", () => {
    expect(isReportStatus("pending")).toBe(true);
    expect(isReportStatus("banned")).toBe(false);
  });
  it("allows canonical transitions and rejects invalid ones", () => {
    expect(canTransition("pending", "reviewing")).toBe(true);
    expect(canTransition("pending", "resolved")).toBe(true);
    expect(canTransition("resolved", "reviewing")).toBe(false);
    expect(canTransition("dismissed", "pending")).toBe(true);
    expect(canTransition("pending", "banned")).toBe(false);
  });
  it("declares a transition set for every status", () => {
    for (const s of ["pending", "reviewing", "resolved", "dismissed"] as const) {
      expect(Array.isArray(REPORT_TRANSITIONS[s])).toBe(true);
    }
  });
  it("labels entity types", () => {
    expect(reportEntityTypeLabel("chat")).toBe("Conversation");
    expect(reportEntityTypeLabel("post")).toBe("Post");
  });
});

describe("getReportDetail — safe shaping", () => {
  it("shapes a post report with a linked target and no evidence fields", async () => {
    const d = await getReportDetail("r-post");
    expect(d).not.toBeNull();
    expect(d!.entity_type_label).toBe("Post");
    expect(d!.target_href).toBe("/admin/posts/post-1");
    expect(d!.reporter_username).toBe("reporter");
    expect(d!.allowedTransitions).toEqual(REPORT_TRANSITIONS.pending);
    expect(d!.message).toBeNull();
    // The detail object must not carry any evidence column.
    expect(JSON.stringify(d)).not.toContain("content_snapshot");
    expect(JSON.stringify(d)).not.toContain("attachment_snapshot");
  });

  it("shapes a message report as safe workflow metadata only", async () => {
    const d = await getReportDetail("r-msg");
    expect(d).not.toBeNull();
    expect(d!.message).not.toBeNull();
    expect(d!.message!.conversation_href).toBe("/admin/conversations/conv-1");
    expect(d!.message!.conversation_type).toBe("direct");
    expect(d!.message!.has_retained_evidence).toBe(true);
    expect(d!.reported_user_id).toBe("u-bad");
    // Never any retained body/attachment/snapshot text anywhere in the payload.
    const json = JSON.stringify(d);
    expect(json).not.toContain("PRIVATE DELETED BODY");
    expect(json).not.toContain("y.jpg");
  });

  it("denies a non-founder", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: "x", email: "x@my.edu" } } });
    await expect(getReportDetail("r-post")).rejects.toBeInstanceOf(SecureAdminError);
  });
});
