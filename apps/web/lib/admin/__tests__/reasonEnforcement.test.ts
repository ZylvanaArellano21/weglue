// ============================================================================
// Day 10A hardening — reason enforcement + cross-service audit pattern
// ============================================================================
//
// The DATABASE guarantees (mutation rolled back when the audit write is
// refused, append-only, privilege model) are proven against real PostgreSQL in
// supabase/scripts/test_055_*.sql and test_056_*.sql. THIS suite covers the
// server layer's own responsibilities:
//
//   • a destructive action rejects a missing/blank/over-long reason BEFORE the
//     database is touched at all,
//   • calling the server action directly — bypassing the confirmation dialog
//     entirely — cannot skip the requirement,
//   • an accepted reason reaches the durable audit record,
//   • the cross-service (Auth/Storage) flow records an attempt first, performs
//     nothing if that fails, and never overwrites the attempt.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const h = vi.hoisted(() => {
  const holder = { db: null as any };
  return {
    getUser: vi.fn(),
    getAAL: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
    cookieSet: vi.fn(),
    cookieGet: vi.fn(),
    holder,
    createAdminClient: vi.fn(() => holder.db),
  };
});
vi.mock("../../supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: h.getUser, signOut: h.signOut, mfa: { getAuthenticatorAssuranceLevel: h.getAAL } },
  }),
}));
vi.mock("../../supabase/admin", () => ({ createAdminClient: h.createAdminClient }));
vi.mock("next/headers", () => ({ cookies: () => ({ set: h.cookieSet, get: h.cookieGet }) }));

import { removeMembership, setMembershipRole, removeGluemate, setUniversityActive } from "../actions";
import { removePostFromClub, removeRsvp } from "../contentActions";
import { deleteEmptyChannel } from "../messagingActions";
import { reactivateClub } from "../deletedContentActions";
import { runCrossServiceOperation } from "../crossService";
import { AUDIT_ACTIONS } from "../auditSanitize";
import { makeDb } from "./fakeAdmin";

const FOUNDER = { id: "94387196-0000-4000-8000-000000000001", email: "founder@weglue.app" };
const CLUB = "22222222-0000-4000-8000-000000000003";
const UA = "aaaaaaaa-0000-4000-8000-00000000000a";
const UB = "bbbbbbbb-0000-4000-8000-00000000000b";
const POST = "dddddddd-0000-4000-8000-00000000000d";
const EVENT = "eeeeeeee-0000-4000-8000-00000000000e";
const CHAN = "11111111-0000-4000-8000-000000000011";
const UNI = "174a1779-0000-4000-8000-000000000002";

function asFounder() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = "true";
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  h.getAAL.mockResolvedValue({
    data: {
      currentLevel: "aal2",
      nextLevel: "aal2",
      currentAuthenticationMethods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }],
    },
  });
}

function seed() {
  return makeDb({
    universities: [{ id: UNI, name: "Lone Star College", slug: "lone-star-college", is_active: true }],
    profiles: [
      { id: UA, username: "ann", full_name: "Ann A", university_id: UNI },
      { id: UB, username: "bob", full_name: "Bob B", university_id: UNI },
    ],
    clubs: [{ id: CLUB, name: "Chess Club", handle: "chess", university_id: UNI, is_active: false }],
    club_members: [
      { id: "m1", club_id: CLUB, user_id: UA, role: "member" },
      { id: "m2", club_id: CLUB, user_id: UB, role: "officer" },
      { id: "m3", club_id: CLUB, user_id: FOUNDER.id, role: "officer" },
    ],
    club_officers: [
      { id: "o2", club_id: CLUB, user_id: UB, role_title: "Treasurer" },
      { id: "o3", club_id: CLUB, user_id: FOUNDER.id, role_title: "President" },
    ],
    follows: [
      { id: "f1", follower_id: UA, following_id: UB, status: "accepted" },
      { id: "f2", follower_id: UB, following_id: UA, status: "accepted" },
    ],
    posts: [{ id: POST, author_id: UA, club_id: CLUB, caption: "hi" }],
    post_club_tags: [{ id: "t1", post_id: POST, club_id: CLUB }],
    club_photos: [{ id: "cp1", club_id: CLUB, post_id: POST, url: "https://x/p.jpg" }],
    events: [{ id: EVENT, club_id: CLUB, title: "Tournament" }],
    event_rsvps: [{ id: "r1", event_id: EVENT, user_id: UA, status: "going" }],
    conversations: [{ id: "ffffffff-0000-4000-8000-00000000000f", type: "club_group", club_id: CLUB }],
    conversation_channels: [
      { id: CHAN, conversation_id: "ffffffff-0000-4000-8000-00000000000f", name: "general", kind: "topic", post_permission: "everyone" },
    ],
    messages: [],
  });
}

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  h.holder.db = seed();
  asFounder();
});

// Every reason-requiring action, paired with a call that supplies NO reason and
// one that supplies a valid reason. Calling these functions directly IS the
// bypass attempt: there is no dialog in the loop at all.
const DESTRUCTIVE: Array<{
  action: keyof typeof AUDIT_ACTIONS;
  call: (reason: any) => Promise<{ ok: boolean; error?: string }>;
  /** Asserts the canonical row is untouched. */
  unchanged: () => boolean;
}> = [
  {
    action: "membership.remove",
    call: (r) => removeMembership(CLUB, UA, r),
    unchanged: () => h.holder.db.tables.club_members.some((m: any) => m.user_id === UA),
  },
  {
    action: "officer.demote",
    call: (r) => setMembershipRole(CLUB, UB, "member", undefined, r),
    unchanged: () => h.holder.db.tables.club_members.find((m: any) => m.user_id === UB).role === "officer",
  },
  {
    action: "gluemate.remove",
    call: (r) => removeGluemate(UA, UB, r),
    unchanged: () => h.holder.db.tables.follows.length === 2,
  },
  {
    action: "university.setActive",
    call: (r) => setUniversityActive(UNI, false, r),
    unchanged: () => h.holder.db.tables.universities[0].is_active === true,
  },
  {
    action: "post.removeFromClub",
    call: (r) => removePostFromClub(POST, CLUB, r),
    unchanged: () => h.holder.db.tables.posts[0].club_id === CLUB,
  },
  {
    action: "rsvp.remove",
    call: (r) => removeRsvp(EVENT, UA, r),
    unchanged: () => h.holder.db.tables.event_rsvps.length === 1,
  },
  {
    action: "channel.deleteEmpty",
    call: (r) => deleteEmptyChannel(CHAN, r),
    unchanged: () => h.holder.db.tables.conversation_channels.length === 1,
  },
  {
    action: "deletedContent.reactivateClub",
    call: (r) => reactivateClub(CLUB, r),
    unchanged: () => h.holder.db.tables.clubs[0].is_active === false,
  },
];

describe("the reason-required actions are declared as such", () => {
  // Day 10C adds six founder lifecycle actions. The three creator-deletion
  // audit records are system-originated evidence, not founder mutations, so
  // they intentionally do not request a founder reason.
  it("is exactly this set", () => {
    const required = Object.entries(AUDIT_ACTIONS)
      .filter(([, spec]) => spec.requiresReason)
      .map(([name]) => name)
      .sort();
    expect(required).toEqual(
      [
        // Day 10A / 10B1
        "channel.deleteEmpty",
        "deletedContent.reactivateClub",
        "gluemate.remove",
        "membership.remove",
        "officer.demote",
        "post.removeFromClub",
        "rsvp.remove",
        "university.add",
        "university.setActive",
        // Day 10B2 — administrator account restrictions
        "restriction.suspend",
        "restriction.unsuspend",
        "restriction.block",
        "restriction.unblock",
        "restriction.adjustExpiry",
        "restriction.revokeSessions",
        // Day 10C — content lifecycle
        "post.remove",
        "post.restore",
        "comment.remove",
        "comment.restore",
        "event.remove",
        "event.restore",
        // Day 10D — report review and terminal decisions
        "report.dismiss",
        "report.resolve",
        "report.review",
        "report.supersede",
        "report.viewEvidence",
      ].sort()
    );
    expect(required).toHaveLength(26);
  });

  it("requires a reason for every restriction action, including the lifts", () => {
    for (const action of Object.keys(AUDIT_ACTIONS).filter((a) => a.startsWith("restriction."))) {
      expect(`${action}=${AUDIT_ACTIONS[action as keyof typeof AUDIT_ACTIONS].requiresReason}`).toBe(
        `${action}=true`
      );
    }
  });
});

describe("a missing reason is rejected BEFORE any mutation", () => {
  // `university.add` is covered in singleCampus.test.ts, where the campus gate
  // refuses it first; the other eight are exercised here.
  it.each(DESTRUCTIVE.map((d) => [d.action, d] as const))(
    "%s rejects an omitted reason and changes nothing",
    async (_name, d) => {
      const res = await d.call(undefined);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/reason is required/i);
      expect(d.unchanged()).toBe(true);
    }
  );

  it.each(DESTRUCTIVE.map((d) => [d.action, d] as const))(
    "%s rejects a whitespace-only reason and changes nothing",
    async (_name, d) => {
      const res = await d.call("   \n\t  ");
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/reason is required/i);
      expect(d.unchanged()).toBe(true);
    }
  );

  it.each(DESTRUCTIVE.map((d) => [d.action, d] as const))(
    "%s never reaches the database when the reason is missing",
    async (_name, d) => {
      await d.call(null);
      // The ONLY rpc call permitted on this path is the failure audit record —
      // never an admin_tx_* mutation.
      const mutations = h.holder.db.rpcCalls.filter((c: any) => c.fn.startsWith("admin_tx_"));
      expect(mutations).toHaveLength(0);
    }
  );
});

describe("a valid reason is accepted and recorded", () => {
  it.each(DESTRUCTIVE.map((d) => [d.action, d] as const))(
    "%s succeeds with a reason and passes it to the database",
    async (name, d) => {
      const reason = `Documented justification for ${name}.`;
      const res = await d.call(reason);
      expect(res.ok).toBe(true);

      const call = h.holder.db.rpcCalls.find((c: any) => c.fn.startsWith("admin_tx_"));
      expect(call).toBeTruthy();
      expect(call.args.p_reason).toBe(reason);
      // Identity always comes from the validated server session.
      expect(call.args.p_actor_id).toBe(FOUNDER.id);
      expect(call.args.p_actor_email).toBe(FOUNDER.email);
      expect(call.args.p_correlation_id).toMatch(/^[0-9a-f-]{36}$/i);
    }
  );

  it("records the reason on the durable audit row", async () => {
    await removeMembership(CLUB, UA, "Graduated and asked to be removed.");
    const audit = h.holder.db.auditRows.find((r: any) => r.action === "membership.remove");
    expect(audit).toBeTruthy();
    expect(audit.reason).toBe("Graduated and asked to be removed.");
    expect(audit.event_type).toBe("success");
  });
});

describe("an over-long reason is rejected", () => {
  it("is refused by the database contract, leaving the row unchanged", async () => {
    // The 500-char cap lives in the database CHECK; the fake mirrors the whole
    // transaction failing, so the mutation must not survive.
    h.holder.db.state.rpcImpl = () => ({
      data: null,
      error: { message: 'new row violates check constraint "admin_audit_events_reason_len_chk"' },
    });
    const res = await removeMembership(CLUB, UA, "x".repeat(600));
    expect(res.ok).toBe(false);
    expect(h.holder.db.tables.club_members.some((m: any) => m.user_id === UA)).toBe(true);
  });
});

describe("authorization still precedes everything", () => {
  it("a non-founder cannot reach the mutation even with a perfect reason", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: "student-1", email: "s@my.edu" } } });
    await expect(removeMembership(CLUB, UA, "A perfectly good reason.")).rejects.toThrow();
    expect(h.holder.db.rpcCalls.filter((c: any) => c.fn.startsWith("admin_tx_"))).toHaveLength(0);
  });

  it("the write kill switch still blocks it", async () => {
    process.env.ADMIN_WRITES_ENABLED = "false";
    await expect(removeMembership(CLUB, UA, "A perfectly good reason.")).rejects.toThrow();
    expect(h.holder.db.rpcCalls.filter((c: any) => c.fn.startsWith("admin_tx_"))).toHaveLength(0);
    process.env.ADMIN_WRITES_ENABLED = "true";
  });
});

// ── Cross-service (Auth / Storage) ──────────────────────────────────────────

describe("cross-service operations use the attempt → outcome pattern", () => {
  it("records the ATTEMPT before performing the external action", async () => {
    const order: string[] = [];
    h.holder.db.state.rpcImpl = (_fn: string, args: any) => {
      order.push(`audit:${args.p_event_type}`);
      return { data: "audit-1", error: null };
    };

    await runCrossServiceOperation({
      action: "portal.lock",
      actor: FOUNDER as any,
      target: {},
      perform: async () => {
        order.push("external");
        return { done: true };
      },
    });

    expect(order).toEqual(["audit:attempt", "external", "audit:success"]);
  });

  it("performs NOTHING when the attempt record cannot be persisted", async () => {
    let performed = false;
    h.holder.db.state.rpcImpl = () => ({ data: null, error: { message: "audit unavailable" } });

    const res = await runCrossServiceOperation({
      action: "portal.lock",
      actor: FOUNDER as any,
      target: {},
      perform: async () => {
        performed = true;
        return { done: true };
      },
    });

    expect(performed).toBe(false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not performed/i);
  });

  it("uses ONE correlation id across attempt and outcome", async () => {
    const ids: string[] = [];
    h.holder.db.state.rpcImpl = (_fn: string, args: any) => {
      ids.push(args.p_correlation_id);
      return { data: "audit-1", error: null };
    };

    const res = await runCrossServiceOperation({
      action: "portal.lock",
      actor: FOUNDER as any,
      target: {},
      perform: async () => ({ done: true }),
    });

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(res.correlationId).toBe(ids[0]);
  });

  it("writes a SEPARATE outcome row — it never rewrites the attempt", async () => {
    const events: string[] = [];
    h.holder.db.state.rpcImpl = (_fn: string, args: any) => {
      events.push(args.p_event_type);
      return { data: `audit-${events.length}`, error: null };
    };

    await runCrossServiceOperation({
      action: "portal.lock",
      actor: FOUNDER as any,
      target: {},
      perform: async () => ({ done: true }),
    });

    // Two distinct inserts, never an update.
    expect(events).toEqual(["attempt", "success"]);
  });

  it("flags RECONCILIATION_REQUIRED when the outcome cannot be recorded", async () => {
    const events: string[] = [];
    h.holder.db.state.rpcImpl = (_fn: string, args: any) => {
      events.push(args.p_event_type);
      // The attempt lands; the success record does not.
      if (args.p_event_type === "success") return { data: null, error: { message: "gone" } };
      return { data: "audit-1", error: null };
    };

    const res = await runCrossServiceOperation({
      action: "portal.lock",
      actor: FOUNDER as any,
      target: {},
      perform: async () => ({ done: true }),
    });

    expect(events).toEqual(["attempt", "success", "reconciliation_required"]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reconciliationRequired).toBe(true);
      expect(res.error).toMatch(/reconciliation/i);
    }
  });

  it("records a failure (not a success) when the external operation throws", async () => {
    const events: string[] = [];
    h.holder.db.state.rpcImpl = (_fn: string, args: any) => {
      events.push(args.p_event_type);
      return { data: "audit-1", error: null };
    };

    const res = await runCrossServiceOperation({
      action: "portal.lock",
      actor: FOUNDER as any,
      target: {},
      perform: async () => {
        throw new Error("auth service unavailable");
      },
    });

    expect(events).toEqual(["attempt", "failure"]);
    expect(res.ok).toBe(false);
  });
});

// ── Confirmation-dialog contract ────────────────────────────────────────────
//
// There is no DOM test runner in this project (vitest runs in `node`), and
// adding jsdom + testing-library to assert one modal would be a real dependency
// for a small gain. So this checks the dialog's contract at the SOURCE level and
// says plainly what that does and does not prove: it shows the wiring is right
// (cancel cannot invoke the action; confirm is gated on a valid reason), not
// that the rendered widget behaves correctly in a browser. Browser QA covers
// that, and — critically — neither is load-bearing: the server rejects a missing
// reason and the database rolls the mutation back regardless of any UI.

describe("ConfirmAction dialog contract (source-level)", () => {
  const src = readFileSync(join(__dirname, "../../../components/admin/ConfirmAction.tsx"), "utf8");

  it("invokes the server action ONLY from the confirm handler", () => {
    // `run(` must appear exactly once outside the prop type declaration.
    const invocations = src.match(/await run\(/g) ?? [];
    expect(invocations).toHaveLength(1);
    const onConfirmBody = src.slice(src.indexOf("async function onConfirm"), src.indexOf("if (disabled)"));
    expect(onConfirmBody).toContain("await run(trimmedReason)");
  });

  it("wires Cancel to close(), never to the action", () => {
    expect(src).toContain("onClick={close}");
    const closeBody = src.slice(src.indexOf("function close()"), src.indexOf("async function onConfirm"));
    expect(closeBody).not.toContain("run(");
    // Closing also clears the typed reason, so a cancelled dialog leaves nothing
    // behind to be submitted accidentally on a later open.
    expect(closeBody).toContain("setReason(\"\")");
  });

  it("gates the confirm button on a valid reason", () => {
    expect(src).toContain("disabled={pending || !reasonValid}");
    expect(src).toContain("trimmedReason.length >= MIN_REASON && trimmedReason.length <= MAX_REASON");
  });

  it("re-checks the reason inside the handler, not only via the disabled button", () => {
    const onConfirmBody = src.slice(src.indexOf("async function onConfirm"), src.indexOf("if (disabled)"));
    expect(onConfirmBody).toContain("if (!reasonValid)");
  });

  it("caps the textarea at the database limit and warns against pasting secrets", () => {
    expect(src).toContain("maxLength={MAX_REASON}");
    expect(src).toMatch(/MAX_REASON = 500/);
    expect(src).toMatch(/Never\s*\n?\s*include passwords/);
  });

  it("shows the exact target being changed", () => {
    expect(src).toContain("targetSummary");
    expect(src).toContain("Target");
  });
});

// ── Re-entrancy guard (duplicate-submission) ────────────────────────────────
//
// Browser QA proved a NATIVE double-click submits exactly once, because React
// commits `pending` between the two clicks. It also proved that three
// SYNCHRONOUS programmatic invocations in one tick got through, since the
// disabled attribute had not been committed yet. `inFlight` is a ref, set
// before any await, which closes that window. These assert the source contract;
// the behavioural proof is the browser run recorded in the release report.

describe("ConfirmAction re-entrancy guard (source-level)", () => {
  const src = readFileSync(join(__dirname, "../../../components/admin/ConfirmAction.tsx"), "utf8");
  const onConfirm = src.slice(src.indexOf("async function onConfirm"), src.indexOf("if (disabled)"));

  it("uses a ref, not state, for the latch", () => {
    expect(src).toContain("const inFlight = useRef(false)");
    expect(src).toContain('import { useRef, useState, type ReactNode } from "react";');
  });

  it("checks and sets the latch BEFORE any await", () => {
    const check = onConfirm.indexOf("if (inFlight.current) return;");
    const set = onConfirm.indexOf("inFlight.current = true;");
    const firstAwait = onConfirm.indexOf("await run(");
    expect(check).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(check);
    expect(firstAwait).toBeGreaterThan(set);
  });

  it("releases the latch on success AND failure", () => {
    const finallyBlock = onConfirm.slice(onConfirm.indexOf("} finally {"));
    expect(finallyBlock).toContain("inFlight.current = false;");
  });

  it("clears the latch when the dialog closes, so reopening starts clean", () => {
    const closeBody = src.slice(src.indexOf("function close()"), src.indexOf("const pad ="));
    expect(closeBody).toContain("inFlight.current = false;");
  });

  it("keeps the visual loading state and disabled buttons unchanged", () => {
    expect(src).toContain("disabled={pending || !reasonValid}");
    expect(src).toContain('{pending ? "Working…" : confirmLabel}');
    expect(onConfirm).toContain("setPending(true);");
  });
});

describe("UniversityForm re-entrancy guard (source-level)", () => {
  const src = readFileSync(join(__dirname, "../../../components/admin/UniversityControls.tsx"), "utf8");
  const submit = src.slice(src.indexOf("function submit()"), src.indexOf("return ("));

  it("latches synchronously before the async submit", () => {
    expect(src).toContain("const inFlight = useRef(false)");
    expect(submit.indexOf("inFlight.current = true;")).toBeLessThan(submit.indexOf("onSubmit(name, slug"));
  });

  it("releases the latch in finally", () => {
    expect(submit).toContain("inFlight.current = false;");
  });
});

// Behavioural simulation of the exact defect the guard closes: three
// synchronous invocations of one handler instance must produce ONE call.
describe("re-entrancy guard behaviour (simulated handler)", () => {
  function makeHandler(run: () => Promise<void>) {
    const inFlight = { current: false };
    return async function onConfirm() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await run();
      } finally {
        inFlight.current = false;
      }
    };
  }

  it("three synchronous invocations produce exactly one call", async () => {
    let calls = 0;
    const h = makeHandler(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
    });
    await Promise.all([h(), h(), h()]);
    expect(calls).toBe(1);
  });

  it("allows a retry after the first attempt settles", async () => {
    let calls = 0;
    const h = makeHandler(async () => {
      calls++;
    });
    await h();
    await h();
    expect(calls).toBe(2);
  });

  it("releases after a throw, so a failed attempt can be retried", async () => {
    let calls = 0;
    const h = makeHandler(async () => {
      calls++;
      throw new Error("server error");
    });
    await expect(h()).rejects.toThrow();
    await expect(h()).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
