import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const h = vi.hoisted(() => {
  const holder = { db: null as any };
  return { holder, createAdminClient: vi.fn(() => holder.db) };
});
vi.mock("../../supabase/admin", () => ({ createAdminClient: h.createAdminClient }));

import { adminAudit, newCorrelationId } from "../audit";
import { makeDb } from "./fakeAdmin";

const FOUNDER_ID = "94387196-0000-4000-8000-000000000001";
const TARGET_ID = "11111111-0000-4000-8000-000000000002";

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.holder.db = makeDb({});
  h.createAdminClient.mockClear();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
});

/** Every operational log line this call emitted, parsed. */
function logged(): any[] {
  return logSpy.mock.calls.map((c: unknown[]) => {
    try {
      return JSON.parse(c[0] as string);
    } catch {
      return { raw: c[0] };
    }
  });
}

describe("adminAudit — durable write path", () => {
  it("persists through the admin_audit_log RPC, not a direct table insert", async () => {
    const res = await adminAudit({
      action: "membership.add",
      actorId: FOUNDER_ID,
      actorEmail: "founder@weglue.app",
      target: { clubId: "33333333-0000-4000-8000-000000000004", userId: TARGET_ID },
      after: { id: "cm1", club_id: "33333333-0000-4000-8000-000000000004", user_id: TARGET_ID, role: "member" },
      ok: true,
    });

    expect(res.persisted).toBe(true);
    expect(h.holder.db.rpcCalls).toHaveLength(1);
    expect(h.holder.db.rpcCalls[0].fn).toBe("admin_audit_log");
    // Nothing was written to any table directly.
    expect(Object.keys(h.holder.db.tables)).toHaveLength(0);
  });

  it("sends the server-validated actor identity, never anything from the browser", async () => {
    await adminAudit({
      action: "membership.add",
      actorId: FOUNDER_ID,
      actorEmail: "founder@weglue.app",
      target: { userId: TARGET_ID },
      ok: true,
    });
    const args = h.holder.db.rpcCalls[0].args;
    expect(args.p_actor_user_id).toBe(FOUNDER_ID);
    expect(args.p_actor_email).toBe("founder@weglue.app");
  });

  it("resolves target_type from the registry rather than from the caller", async () => {
    await adminAudit({
      action: "report.setStatus",
      actorId: FOUNDER_ID,
      target: { reportId: TARGET_ID, nextStatus: "resolved" },
      ok: true,
    });
    const args = h.holder.db.rpcCalls[0].args;
    expect(args.p_target_type).toBe("report");
    expect(args.p_target_id).toBe(TARGET_ID);
    expect(args.p_metadata).toEqual({ reportId: TARGET_ID, nextStatus: "resolved" });
  });

  it("does not construct the service-role client for an unknown action", async () => {
    const res = await adminAudit({
      action: "totally.madeUp",
      actorId: FOUNDER_ID,
      target: {},
      ok: true,
    });
    expect(res.persisted).toBe(false);
    expect(h.createAdminClient).not.toHaveBeenCalled();
    expect(logged().some((l) => l.tag === "admin_audit_unknown_action")).toBe(true);
  });
});

describe("adminAudit — success/failure semantics", () => {
  it("maps a success row to a NULL error_code", async () => {
    await adminAudit({ action: "notification.setRead", actorId: FOUNDER_ID, target: {}, ok: true });
    expect(h.holder.db.rpcCalls[0].args.p_success).toBe(true);
    expect(h.holder.db.rpcCalls[0].args.p_error_code).toBeNull();
  });

  it("never lets a failure row reach the database without an error code", async () => {
    // The database enforces (success XOR error_code); a caller that forgets the
    // error must not cause the failure record to be rejected and lost.
    await adminAudit({ action: "notification.setRead", actorId: FOUNDER_ID, target: {}, ok: false });
    expect(h.holder.db.rpcCalls[0].args.p_success).toBe(false);
    expect(h.holder.db.rpcCalls[0].args.p_error_code).toBe("unspecified_error");
  });

  it("preserves a supplied error code on the failure path", async () => {
    await adminAudit({
      action: "membership.remove",
      actorId: FOUNDER_ID,
      target: { userId: TARGET_ID },
      ok: false,
      error: "This user is not a member of this club.",
    });
    expect(h.holder.db.rpcCalls[0].args.p_error_code).toBe("This user is not a member of this club.");
  });

  it("reports persisted:false and logs LOUDLY when the database rejects the row", async () => {
    h.holder.db.state.rpcImpl = () => ({ data: null, error: { message: "forbidden key" } });

    const res = await adminAudit({
      action: "membership.add",
      actorId: FOUNDER_ID,
      target: { userId: TARGET_ID },
      ok: true,
    });

    // The mutation already committed; the gap must be visible, never silent.
    expect(res.persisted).toBe(false);
    const fail = logged().find((l) => l.tag === "admin_audit_persist_failed");
    expect(fail).toBeTruthy();
    expect(fail.persistError).toBe("forbidden key");
  });

  it("never throws — an audit problem must not fail the administrator's action", async () => {
    h.holder.db.state.rpcImpl = () => {
      throw new Error("connection reset");
    };
    const res = await adminAudit({
      action: "membership.add",
      actorId: FOUNDER_ID,
      target: { userId: TARGET_ID },
      ok: true,
    });
    expect(res.persisted).toBe(false);
    expect(logged().some((l) => l.tag === "admin_audit_persist_failed")).toBe(true);
  });

  it("retains structured operational logging alongside the durable row", async () => {
    await adminAudit({ action: "portal.lock", actorId: FOUNDER_ID, target: {}, ok: true });
    const line = logged().find((l) => l.tag === "admin_audit");
    expect(line).toBeTruthy();
    expect(line.action).toBe("portal.lock");
    expect(line.persisted).toBe(true);
  });
});

describe("adminAudit — correlation ids", () => {
  it("generates one when the caller supplies none", async () => {
    const res = await adminAudit({ action: "portal.lock", actorId: FOUNDER_ID, target: {}, ok: true });
    expect(res.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(h.holder.db.rpcCalls[0].args.p_correlation_id).toBe(res.correlationId);
  });

  it("threads a supplied id through every step of one operation", async () => {
    const correlationId = newCorrelationId();

    await adminAudit({
      action: "officer.demote",
      actorId: FOUNDER_ID,
      target: { userId: TARGET_ID },
      ok: true,
      reason: "Officer transfer step 1 of 2.",
      correlationId,
    });
    await adminAudit({
      action: "officer.promote",
      actorId: FOUNDER_ID,
      target: { userId: "55555555-0000-4000-8000-000000000006" },
      ok: true,
      correlationId,
    });

    const ids = h.holder.db.rpcCalls.map((c: any) => c.args.p_correlation_id);
    expect(ids).toEqual([correlationId, correlationId]);
  });

  it("gives unrelated operations distinct ids", async () => {
    await adminAudit({ action: "portal.lock", actorId: FOUNDER_ID, target: {}, ok: true });
    await adminAudit({ action: "portal.lock", actorId: FOUNDER_ID, target: {}, ok: true });
    const [a, b] = h.holder.db.rpcCalls.map((c: any) => c.args.p_correlation_id);
    expect(a).not.toBe(b);
  });
});

describe("adminAudit — nothing sensitive ever reaches the database or the logs", () => {
  it("strips a secret smuggled through the target object", async () => {
    await adminAudit({
      action: "university.edit",
      actorId: FOUNDER_ID,
      target: { id: TARGET_ID, password: "hunter2", access_token: "eyJabc.def" },
      ok: true,
    });
    const payload = JSON.stringify(h.holder.db.rpcCalls[0].args);
    expect(payload).not.toContain("hunter2");
    expect(payload).not.toContain("access_token");
    expect(JSON.stringify(logged())).not.toContain("hunter2");
  });

  it("strips message content smuggled through before/after state", async () => {
    await adminAudit({
      action: "message.revealBody",
      actorId: FOUNDER_ID,
      target: { messageId: TARGET_ID, content_len: 42, has_attachment: false },
      before: { id: TARGET_ID, content: "THE PRIVATE MESSAGE", attachment_url: "https://x/y" },
      ok: true,
    });

    const args = h.holder.db.rpcCalls[0].args;
    const payload = JSON.stringify(args);
    expect(payload).not.toContain("THE PRIVATE MESSAGE");
    expect(payload).not.toContain("attachment_url");
    // The safe metadata still made it through.
    expect(args.p_metadata).toEqual({ messageId: TARGET_ID, content_len: 42, has_attachment: false });
    expect(JSON.stringify(logged())).not.toContain("THE PRIVATE MESSAGE");
  });

  it("does not log the reason-bearing payload of a destructive action verbatim into a secret field", async () => {
    await adminAudit({
      action: "membership.remove",
      actorId: FOUNDER_ID,
      target: { clubId: "33333333-0000-4000-8000-000000000004", userId: TARGET_ID },
      ok: true,
      reason: "Repeated harassment reports.",
    });
    expect(h.holder.db.rpcCalls[0].args.p_reason).toBe("Repeated harassment reports.");
  });

  it("sends a NULL reason when none was given, so the database rule can fire", async () => {
    await adminAudit({
      action: "membership.remove",
      actorId: FOUNDER_ID,
      target: { userId: TARGET_ID },
      ok: true,
    });
    expect(h.holder.db.rpcCalls[0].args.p_reason).toBeNull();
  });
});
