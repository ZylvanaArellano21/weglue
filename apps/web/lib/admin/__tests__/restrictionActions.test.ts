import { describe, it, expect, beforeEach, vi } from "vitest";

// ============================================================================
// Administrator restriction actions — authorization + validation contract
// ============================================================================
//
// The DATABASE half (transitions, atomicity, expiry, enforcement) is proven by
// supabase/scripts/test_058_admin_restrictions.sql against the real 055/056/057
// migrations. This file pins the SERVER-ACTION half, which the database cannot
// see:
//
//   • every action refuses to run with ADMIN_WRITES_ENABLED unset — the
//     production posture today;
//   • the actor is the server-validated founder, never a form field;
//   • reason and expiry are validated BEFORE the database is touched;
//   • lifting a restriction does NOT revoke sessions, and applying one does.
// ============================================================================

const getUser = vi.fn();
const getAAL = vi.fn();
vi.mock("../../supabase/server", () => ({
  createClient: () => ({ auth: { getUser, mfa: { getAuthenticatorAssuranceLevel: getAAL } } }),
}));

const signOut = vi.fn();
const rpc = vi.fn();
vi.mock("../../supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    auth: { admin: { signOut: (...a: unknown[]) => signOut(...a) } },
  }),
}));

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock("../audit", () => ({
  adminAudit: async (o: Record<string, unknown>) => {
    auditCalls.push(o);
    return { persisted: true };
  },
  newCorrelationId: () => "00000000-0000-4000-8000-00000000c0de",
}));

import {
  suspendUser,
  unsuspendUser,
  platformBlockUser,
  unblockUser,
  adjustSuspensionExpiry,
} from "../restrictionActions";
import { SecureAdminError } from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const TARGET = "55550000-0000-4000-8000-000000000001";
const now = () => Math.floor(Date.now() / 1000);
const future = () => new Date(Date.now() + 86_400_000).toISOString();

function portalOn() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
}
function writesOn() {
  process.env.ADMIN_WRITES_ENABLED = "true";
}
function goodSession() {
  getUser.mockResolvedValue({ data: { user: FOUNDER } });
  getAAL.mockResolvedValue({
    data: {
      currentLevel: "aal2",
      nextLevel: "aal2",
      currentAuthenticationMethods: [
        { method: "password", timestamp: now() - 30 },
        { method: "totp", timestamp: now() },
      ],
    },
  });
}

beforeEach(() => {
  getUser.mockReset();
  getAAL.mockReset();
  signOut.mockReset();
  rpc.mockReset();
  auditCalls.length = 0;
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_WRITES_ENABLED;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
  delete process.env.ADMIN_FOUNDER_EMAILS;
  rpc.mockResolvedValue({ data: { status: "ok" }, error: null });
  signOut.mockResolvedValue({ error: null });
});

// ── The production posture ───────────────────────────────────────────────────

describe("every restriction action fails closed with writes disabled", () => {
  it("throws writes_disabled for all five, and never reaches the database", async () => {
    portalOn(); // ADMIN_WRITES_ENABLED deliberately unset
    goodSession();
    const calls: Array<Promise<unknown>> = [
      suspendUser(TARGET, "a valid reason", null),
      unsuspendUser(TARGET, "a valid reason"),
      platformBlockUser(TARGET, "a valid reason"),
      unblockUser(TARGET, "a valid reason"),
      adjustSuspensionExpiry(TARGET, "a valid reason", future()),
    ];
    for (const c of calls) {
      await expect(c).rejects.toMatchObject({ reason: "writes_disabled" });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("authorization is enforced before anything else", () => {
  it("rejects a non-allowlisted administrator", async () => {
    portalOn();
    writesOn();
    getUser.mockResolvedValue({ data: { user: { id: "someone-else", email: "x@y.z" } } });
    getAAL.mockResolvedValue({ data: { currentLevel: "aal2", currentAuthenticationMethods: [] } });
    await expect(suspendUser(TARGET, "a valid reason", null)).rejects.toBeInstanceOf(SecureAdminError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects stale MFA", async () => {
    portalOn();
    writesOn();
    getUser.mockResolvedValue({ data: { user: FOUNDER } });
    getAAL.mockResolvedValue({
      data: {
        currentLevel: "aal2",
        currentAuthenticationMethods: [
          { method: "password", timestamp: now() - 600 },
          { method: "totp", timestamp: now() - 600 },
        ],
      },
    });
    await expect(platformBlockUser(TARGET, "a valid reason")).rejects.toMatchObject({
      reason: "stepup_required",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ── Input validation happens BEFORE the database ─────────────────────────────

describe("reason and expiry are validated before any mutation", () => {
  beforeEach(() => {
    portalOn();
    writesOn();
    goodSession();
  });

  it("rejects an empty, whitespace, too-short or too-long reason", async () => {
    for (const bad of ["", "   ", "ab", "x".repeat(501)]) {
      const res = await suspendUser(TARGET, bad, null);
      expect(res.ok).toBe(false);
      expect(res.outcome).toBe("rejected");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts a 3-character and a 500-character reason (the exact bounds)", async () => {
    await expect(suspendUser(TARGET, "abc", null)).resolves.toMatchObject({ ok: true });
    await expect(suspendUser(TARGET, "y".repeat(500), null)).resolves.toMatchObject({ ok: true });
  });

  it("rejects a malformed expiration", async () => {
    const res = await suspendUser(TARGET, "a valid reason", "not-a-date");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/expiration/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a PAST expiration", async () => {
    const res = await suspendUser(TARGET, "a valid reason", new Date(Date.now() - 1000).toISOString());
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/future/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed user id without touching the database", async () => {
    const res = await suspendUser("not-a-uuid", "a valid reason", null);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ── Session revocation: applied vs lifted ────────────────────────────────────

describe("session revocation happens for restrictions, NOT for lifts", () => {
  beforeEach(() => {
    portalOn();
    writesOn();
    goodSession();
  });

  it("suspend revokes sessions globally", async () => {
    const res = await suspendUser(TARGET, "a valid reason", null);
    expect(res).toMatchObject({ ok: true, outcome: "applied", sessionsRevoked: true });
    expect(signOut).toHaveBeenCalledWith(TARGET, "global");
  });

  it("block revokes sessions globally", async () => {
    const res = await platformBlockUser(TARGET, "a valid reason");
    expect(res).toMatchObject({ ok: true, sessionsRevoked: true });
    expect(signOut).toHaveBeenCalledWith(TARGET, "global");
  });

  it("unsuspend does NOT revoke, and does NOT create a session", async () => {
    const res = await unsuspendUser(TARGET, "a valid reason");
    expect(res).toMatchObject({ ok: true, sessionsRevoked: false });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("unblock does NOT revoke", async () => {
    const res = await unblockUser(TARGET, "a valid reason");
    expect(res).toMatchObject({ ok: true, sessionsRevoked: false });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("adjusting the expiry does NOT re-revoke — sessions died at suspend time", async () => {
    const res = await adjustSuspensionExpiry(TARGET, "a valid reason", future());
    expect(res.ok).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("a failed revocation is reported honestly, not as a clean success", () => {
  beforeEach(() => {
    portalOn();
    writesOn();
    goodSession();
  });

  it("reports sessionsFailed AND states that access is still denied", async () => {
    signOut.mockResolvedValue({ error: { message: "auth unreachable" } });
    const res = await platformBlockUser(TARGET, "a valid reason");
    // The restriction still committed — this is degraded, not unsafe.
    expect(res.ok).toBe(true);
    expect(res.outcome).toBe("sessionsFailed");
    expect(res.sessionsRevoked).toBe(false);
    expect(res.message).toMatch(/still denied by the database/i);
  });

  it("a database rejection is reported as rejected, and no revocation is attempted", async () => {
    rpc.mockResolvedValue({ data: { status: "already_blocked" }, error: null });
    const res = await platformBlockUser(TARGET, "a valid reason");
    expect(res).toMatchObject({ ok: false, outcome: "rejected" });
    expect(signOut).not.toHaveBeenCalled();
  });
});

// ── Provenance ───────────────────────────────────────────────────────────────

describe("the actor and correlation id come from the server", () => {
  beforeEach(() => {
    portalOn();
    writesOn();
    goodSession();
  });

  it("passes the server-validated founder id, never a caller-supplied one", async () => {
    await suspendUser(TARGET, "a valid reason", null);
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.p_actor_id).toBe(FOUNDER.id);
    expect(args.p_actor_email).toBe(FOUNDER.email);
    expect(args.p_user_id).toBe(TARGET);
  });

  it("uses ONE correlation id across the database and Auth legs", async () => {
    const res = await platformBlockUser(TARGET, "a valid reason");
    const dbArgs = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(dbArgs.p_correlation_id).toBe(res.correlationId);
    const revocationAudits = auditCalls.filter((c) => c.action === "restriction.revokeSessions");
    expect(revocationAudits.length).toBeGreaterThan(0);
    for (const a of revocationAudits) expect(a.correlationId).toBe(res.correlationId);
  });

  it("records the Auth leg as attempt THEN outcome, never updating the attempt", async () => {
    await platformBlockUser(TARGET, "a valid reason");
    const types = auditCalls
      .filter((c) => c.action === "restriction.revokeSessions")
      .map((c) => c.eventType ?? "success");
    expect(types[0]).toBe("attempt");
    expect(types).toContain("success");
  });
});
