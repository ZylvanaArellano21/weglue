// ============================================================================
// Day 8, Phase 4 — complete write-path security review, mechanically enforced
// ============================================================================
//
// Enumerates EVERY privileged mutation the Admin Dashboard exposes and asserts,
// for each one, that the whole gate chain fails closed and that the service-role
// client is never constructed on a denied path.
//
// This file is deliberately exhaustive rather than representative: it is the
// artifact that says "these are all the writes there are". A new mutation that
// forgets `requireSecureAdmin({ write: true })` has to be added to this table to
// pass review, and will fail these tests if it is not gated.
//
// Sensitive READS (message reveal / content search) are covered too: they are
// not writes, but they are the only paths that expose message bodies, and they
// carry an extra recent-MFA bound on top of everything below.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const holder = { db: null as any };
  return {
    getUser: vi.fn(),
    getAAL: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
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

import {
  addMembership,
  removeMembership,
  setMembershipRole,
  addOfficer,
  editOfficerTitle,
  removeGluemate,
  addUniversity,
  editUniversity,
  setUniversityActive,
} from "../actions";
import {
  editPostCaption,
  removePostFromClub,
  editCommentContent,
  editEvent,
  upsertRsvp,
  removeRsvp,
} from "../contentActions";
import {
  createChannel,
  renameChannel,
  setChannelPermission,
  deleteEmptyChannel,
  setNotificationRead,
  revealMessageBody,
  searchMessageContent,
} from "../messagingActions";
import { setReportStatus } from "../reportsActions";
import { reactivateClub } from "../deletedContentActions";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const ID = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
const NOW = () => Math.floor(Date.now() / 1000);

// ── The complete privileged-mutation inventory ───────────────────────────────
const MUTATIONS: Array<[string, () => Promise<unknown>]> = [
  // Memberships + officers (actions.ts)
  ["membership.add", () => addMembership(ID(1), ID(2))],
  ["membership.remove", () => removeMembership(ID(1), ID(2))],
  ["officer.promote", () => setMembershipRole(ID(1), ID(2), "officer", "President")],
  ["officer.demote", () => setMembershipRole(ID(1), ID(2), "member")],
  ["officer.add", () => addOfficer(ID(1), ID(2), "President")],
  ["officer.editTitle", () => editOfficerTitle(ID(1), ID(2), "Treasurer")],
  // Gluemates
  ["gluemate.remove", () => removeGluemate(ID(1), ID(2))],
  // Universities
  ["university.add", () => addUniversity("Test University", "test-university")],
  ["university.edit", () => editUniversity(ID(1), { name: "Renamed" })],
  ["university.setActive", () => setUniversityActive(ID(1), false)],
  // Content (contentActions.ts)
  ["post.editCaption", () => editPostCaption(ID(1), "caption")],
  ["post.removeFromClub", () => removePostFromClub(ID(1), ID(2))],
  ["comment.edit", () => editCommentContent(ID(1), "content")],
  ["event.edit", () => editEvent(ID(1), { title: "Renamed event" })],
  ["rsvp.upsert", () => upsertRsvp(ID(1), ID(2), "going")],
  ["rsvp.remove", () => removeRsvp(ID(1), ID(2))],
  // Messaging (messagingActions.ts)
  ["channel.create", () => createChannel(ID(1), "general")],
  ["channel.rename", () => renameChannel(ID(1), "renamed")],
  ["channel.setPermission", () => setChannelPermission(ID(1), "everyone")],
  ["channel.deleteEmpty", () => deleteEmptyChannel(ID(1))],
  ["notification.setRead", () => setNotificationRead(ID(1), true)],
  // Reports + deleted content
  ["report.setStatus", () => setReportStatus(ID(1), "resolved")],
  ["club.reactivate", () => reactivateClub(ID(1))],
];

// Sensitive reads — message bodies. Not writes; still fully gated + recent MFA.
const SENSITIVE_READS: Array<[string, () => Promise<unknown>]> = [
  ["message.reveal", () => revealMessageBody(ID(1))],
  ["message.contentSearch", () => searchMessageContent("anything")],
];

const ALL = [...MUTATIONS, ...SENSITIVE_READS];

function env(portal: boolean, writes: boolean) {
  if (portal) process.env.ADMIN_PORTAL_ENABLED = "true";
  else delete process.env.ADMIN_PORTAL_ENABLED;
  if (writes) process.env.ADMIN_WRITES_ENABLED = "true";
  else delete process.env.ADMIN_WRITES_ENABLED;
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
}
function session(user: unknown, level: "aal1" | "aal2", ageSeconds: number) {
  h.getUser.mockResolvedValue({ data: { user } });
  h.getAAL.mockResolvedValue({
    data: {
      currentLevel: level,
      nextLevel: "aal2",
      currentAuthenticationMethods: [
        { method: "password", timestamp: NOW() - ageSeconds },
        { method: "totp", timestamp: NOW() - ageSeconds + 1 },
      ],
    },
  });
}

beforeEach(() => {
  h.getUser.mockReset();
  h.getAAL.mockReset();
  h.createAdminClient.mockClear();
  h.holder.db = null; // any attempt to touch the database throws
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_WRITES_ENABLED;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
  delete process.env.ADMIN_FOUNDER_EMAILS;
});

// ── 1. The Day-8 production posture: writes disabled ─────────────────────────

describe("ADMIN_WRITES_ENABLED unset — every mutation fails closed", () => {
  it.each(MUTATIONS)("%s is refused with writes_disabled", async (_name, run) => {
    env(true, false);
    session(FOUNDER, "aal2", 30); // fully valid founder session
    await expect(run()).rejects.toMatchObject({ reason: "writes_disabled" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it.each(MUTATIONS)("%s is refused with ADMIN_WRITES_ENABLED='false'", async (_name, run) => {
    env(true, false);
    process.env.ADMIN_WRITES_ENABLED = "false";
    session(FOUNDER, "aal2", 30);
    await expect(run()).rejects.toMatchObject({ reason: "writes_disabled" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it.each(MUTATIONS)("%s is refused with a near-miss value ('TRUE')", async (_name, run) => {
    env(true, false);
    process.env.ADMIN_WRITES_ENABLED = "TRUE"; // must be exactly "true"
    session(FOUNDER, "aal2", 30);
    await expect(run()).rejects.toMatchObject({ reason: "writes_disabled" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

// ── 2. The rest of the chain, applied to writes AND sensitive reads ──────────

describe("portal kill switch", () => {
  it.each(ALL)("%s is refused when the portal is off", async (_name, run) => {
    env(false, true);
    session(FOUNDER, "aal2", 30);
    await expect(run()).rejects.toMatchObject({ reason: "portal_disabled" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("authentication", () => {
  it.each(ALL)("%s is refused for an unauthenticated caller", async (_name, run) => {
    env(true, true);
    session(null, "aal2", 30);
    await expect(run()).rejects.toMatchObject({ reason: "unauthenticated" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("founder identity", () => {
  it.each(ALL)("%s is refused for a non-founder account", async (_name, run) => {
    env(true, true);
    session({ id: ID(9), email: "student@my.edu" }, "aal2", 30);
    await expect(run()).rejects.toMatchObject({ reason: "denied" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it.each(ALL)("%s is refused when the email does not match the allowlist", async (_name, run) => {
    env(true, true);
    // Correct immutable id, WRONG email — the AND consistency check must deny.
    session({ id: FOUNDER.id, email: "someone.else@weglue.app" }, "aal2", 30);
    await expect(run()).rejects.toMatchObject({ reason: "denied" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("session maximum age", () => {
  it.each(ALL)("%s is refused on an expired session", async (_name, run) => {
    env(true, true);
    session(FOUNDER, "aal2", 16 * 60); // past the 15-minute default
    await expect(run()).rejects.toMatchObject({ reason: "session_expired" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it.each(ALL)("%s is refused when session freshness is unprovable", async (_name, run) => {
    env(true, true);
    h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
    h.getAAL.mockResolvedValue({
      data: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [] },
    });
    await expect(run()).rejects.toMatchObject({ reason: "session_expired" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("multi-factor assurance", () => {
  it.each(ALL)("%s is refused at aal1", async (_name, run) => {
    env(true, true);
    session(FOUNDER, "aal1", 30);
    await expect(run()).rejects.toMatchObject({ reason: "mfa_required" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

describe("step-up freshness for message content", () => {
  it.each(SENSITIVE_READS)("%s needs a RECENT multi-factor verification", async (_name, run) => {
    env(true, true);
    h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
    // Session itself is inside the maximum age; the TOTP is past the 5-minute
    // step-up window.
    h.getAAL.mockResolvedValue({
      data: {
        currentLevel: "aal2",
        nextLevel: "aal2",
        currentAuthenticationMethods: [
          { method: "password", timestamp: NOW() - 700 },
          { method: "totp", timestamp: NOW() - 700 },
        ],
      },
    });
    await expect(run()).rejects.toMatchObject({ reason: "stepup_required" });
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });
});

// ── 3. Inventory guard ───────────────────────────────────────────────────────

describe("inventory", () => {
  it("covers 23 privileged mutations and 2 sensitive reads", () => {
    // If this number changes, the write-path review has to be redone — that is
    // the point of asserting it.
    expect(MUTATIONS).toHaveLength(23);
    expect(SENSITIVE_READS).toHaveLength(2);
  });

  it("every entry is a distinct named operation", () => {
    const names = ALL.map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
  });
});
