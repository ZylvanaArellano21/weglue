import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAAL: vi.fn(),
  rpc: vi.fn(),
  adminAudit: vi.fn(async () => ({ persisted: true, correlationId: "00000000-0000-4000-8000-00000000c0de" })),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("../../supabase/server", () => ({
  createClient: () => ({ auth: { getUser: h.getUser, mfa: { getAuthenticatorAssuranceLevel: h.getAAL } } }),
}));
vi.mock("../../supabase/admin", () => ({ createAdminClient: () => ({ rpc: h.rpc }) }));
vi.mock("../audit", () => ({
  adminAudit: h.adminAudit,
  newCorrelationId: () => "00000000-0000-4000-8000-00000000c0de",
}));

import {
  removeComment,
  removeEvent,
  removePost,
  restoreComment,
  restoreEvent,
  restorePost,
} from "../contentLifecycleActions";

const FOUNDER = { id: "00000001-0000-4000-8000-000000000001", email: "founder@weglue.app" };
const POST = "00000002-0000-4000-8000-000000000002";
const COMMENT = "00000003-0000-4000-8000-000000000003";
const EVENT = "00000004-0000-4000-8000-000000000004";
const REASON = "Documented content-lifecycle test reason.";

function asFounder(totpAgoSeconds = 0) {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  h.getAAL.mockResolvedValue({
    data: {
      currentLevel: "aal2",
      nextLevel: "aal2",
      currentAuthenticationMethods: [
        { method: "password", timestamp: Math.floor(Date.now() / 1000) - Math.max(totpAgoSeconds, 30) },
        { method: "totp", timestamp: Math.floor(Date.now() / 1000) - totpAgoSeconds },
      ],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_WRITES_ENABLED;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
  delete process.env.ADMIN_FOUNDER_EMAILS;
  h.rpc.mockResolvedValue({ data: { status: "ok", after: { state: "removed" } }, error: null });
});

describe("Day 10C lifecycle actions", () => {
  it("removes a post only through its fixed audited RPC after recent MFA", async () => {
    asFounder();
    await expect(removePost(POST, REASON)).resolves.toMatchObject({ ok: true });
    expect(h.rpc).toHaveBeenCalledWith("admin_tx_post_remove", expect.objectContaining({
      p_actor_id: FOUNDER.id,
      p_actor_email: FOUNDER.email,
      p_reason: REASON,
      p_correlation_id: "00000000-0000-4000-8000-00000000c0de",
      p_post_id: POST,
    }));
    expect(h.revalidatePath).toHaveBeenCalledWith(`/admin/posts/${POST}`);
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/content-lifecycle");
  });

  it.each([
    ["comment remove", () => removeComment(COMMENT, REASON), "admin_tx_comment_remove", "p_comment_id", COMMENT],
    ["comment restore", () => restoreComment(COMMENT, REASON), "admin_tx_comment_restore", "p_comment_id", COMMENT],
    ["event remove", () => removeEvent(EVENT, REASON), "admin_tx_event_remove", "p_event_id", EVENT],
    ["event restore", () => restoreEvent(EVENT, REASON), "admin_tx_event_restore", "p_event_id", EVENT],
    ["post restore", () => restorePost(POST, REASON), "admin_tx_post_restore", "p_post_id", POST],
  ])("dispatches %s to a narrow RPC", async (_name, call, rpc, idArg, id) => {
    asFounder();
    await expect(call()).resolves.toMatchObject({ ok: true });
    expect(h.rpc).toHaveBeenCalledWith(rpc, expect.objectContaining({ [idArg]: id }));
  });

  it("does not reach the mutation RPC for a missing internal reason", async () => {
    asFounder();
    await expect(removePost(POST, "  ")).resolves.toMatchObject({ ok: false, error: "A reason is required for this action." });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.adminAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "post.remove", ok: false }));
  });

  it("returns the database's honest impossible-restoration error", async () => {
    asFounder();
    h.rpc.mockResolvedValue({ data: { status: "parent_unavailable" }, error: null });
    await expect(restoreComment(COMMENT, REASON)).resolves.toMatchObject({
      ok: false,
      error: "Restore the parent post before restoring this comment.",
      rpcStatus: "parent_unavailable",
    });
  });

  it("records an audit failure outcome when the atomic RPC rolls back", async () => {
    asFounder();
    h.rpc.mockResolvedValue({ data: null, error: { message: "audit write rejected" } });
    h.adminAudit.mockResolvedValueOnce({ persisted: false, correlationId: "00000000-0000-4000-8000-00000000c0de" });
    await expect(removeEvent(EVENT, REASON)).resolves.toMatchObject({ ok: false, failure: "audit" });
  });

  it("fails closed for a non-founder without constructing a service-role client", async () => {
    asFounder();
    h.getUser.mockResolvedValue({ data: { user: { id: "00000009-0000-4000-8000-000000000009", email: "student@example.edu" } } });
    await expect(removePost(POST, REASON)).resolves.toMatchObject({ ok: false, error: "Not authorized for admin access." });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when recent MFA is stale", async () => {
    asFounder(10 * 60);
    await expect(removePost(POST, REASON)).resolves.toMatchObject({ ok: false, error: "This action requires a recent multi-factor verification." });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when ADMIN_WRITES_ENABLED is off", async () => {
    asFounder();
    process.env.ADMIN_WRITES_ENABLED = "false";
    await expect(removePost(POST, REASON)).resolves.toMatchObject({ ok: false, error: "Admin write operations are currently disabled." });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("refuses malformed identifiers before the mutation RPC", async () => {
    asFounder();
    await expect(restoreEvent("not-a-uuid", REASON)).resolves.toMatchObject({ ok: false, error: "Invalid content id." });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
