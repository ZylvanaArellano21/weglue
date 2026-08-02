import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn(); const getAAL = vi.fn(); const rpc = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../supabase/server", () => ({ createClient: () => ({ auth: { getUser, mfa: { getAuthenticatorAssuranceLevel: getAAL } } }) }));
vi.mock("../../supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...args: unknown[]) => rpc(...args) }) }));
vi.mock("../audit", () => ({ adminAudit: async () => ({ persisted: true }), newCorrelationId: () => "00000000-0000-4000-8000-00000000c0de" }));
vi.mock("../restrictionObservability", () => ({ diagnosticFromUnknown: () => ({ message: "safe" }), logRestrictionAction: vi.fn() }));

import { platformBlockUser, suspendUser, unblockUser, unsuspendUser } from "../restrictionActions";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const TARGET = "55550000-0000-4000-8000-000000000001";
const valid = { violationCategory: "targeted_harassment" as const, publicReason: "Your account was suspended because repeated unwanted messages targeted another student.", internalReason: "Controlled test restriction." };

beforeEach(() => {
  process.env.ADMIN_PORTAL_ENABLED = "true"; process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id; process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  getUser.mockResolvedValue({ data: { user: FOUNDER } });
  getAAL.mockResolvedValue({ data: { currentLevel: "aal2", currentAuthenticationMethods: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] } });
  rpc.mockReset(); rpc.mockResolvedValue({ data: { status: "ok" }, error: null });
});

describe("Day 10B application-access invalidation", () => {
  it("requires separate category, public reason, and internal note before a suspend RPC", async () => {
    await expect(suspendUser(TARGET, { ...valid, publicReason: "short" }, null)).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the v2 suspend RPC and never calls the unsupported UUID signOut API", async () => {
    const result = await suspendUser(TARGET, valid, null);
    expect(result).toMatchObject({ ok: true, status: "restrictionAppliedAccessInvalidated", accessInvalidated: true });
    expect(rpc).toHaveBeenCalledWith("admin_tx_restriction_suspend_v2", expect.objectContaining({
      p_user_id: TARGET, p_violation_category: valid.violationCategory, p_public_reason: valid.publicReason,
      p_reason: valid.internalReason,
    }));
  });

  it("blocks with the v2 RPC and reports database-enforced application blocking", async () => {
    const result = await platformBlockUser(TARGET, valid);
    expect(result.message).toMatch(/access is blocked on all devices/i);
    expect(rpc).toHaveBeenCalledWith("admin_tx_restriction_block_v2", expect.any(Object));
  });

  it("lifts do not manufacture a session or submit public reason fields", async () => {
    await unsuspendUser(TARGET, "Resolved after review.");
    await unblockUser(TARGET, "Resolved after review.");
    for (const [, args] of rpc.mock.calls) {
      expect(args).not.toHaveProperty("p_public_reason");
      expect(args).not.toHaveProperty("p_violation_category");
    }
  });
});
