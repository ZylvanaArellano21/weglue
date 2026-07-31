import { describe, it, expect, beforeEach, vi } from "vitest";

// ============================================================================
// requireRecentMfaWrite() — the write-specific step-up composition
// ============================================================================
//
// THE DEFECT THIS FILE EXISTS TO PREVENT FROM RETURNING.
//
// `requireRecentMfa()` calls `requireSecureAdmin()` WITHOUT `{ write: true }`.
// It therefore proves a recent second factor but says NOTHING about the global
// write kill switch. Any privileged mutation guarded only by it would satisfy
// step-up MFA while bypassing `ADMIN_WRITES_ENABLED` entirely.
//
// The fix could NOT be "add { write: true } to requireRecentMfa()", because the
// two existing callers are sensitive READS (message.revealBody,
// message.contentSearch) that must keep working while writes are disabled —
// which is the portal's normal, safe posture.
//
// So the two guards are separated, and this file pins BOTH halves of that
// contract: the read guard must still work with writes off, and the write guard
// must fail closed.
// ============================================================================

const getUser = vi.fn();
const getAAL = vi.fn();
vi.mock("../../supabase/server", () => ({
  createClient: () => ({
    auth: { getUser, mfa: { getAuthenticatorAssuranceLevel: getAAL } },
  }),
}));

import {
  requireRecentMfa,
  requireRecentMfaWrite,
  SecureAdminError,
} from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const OTHER = { id: "00000009-0000-0000-0000-000000000009", email: "someone@else.com" };

const now = () => Math.floor(Date.now() / 1000);

function portalOn() {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
}
function writesOn() {
  process.env.ADMIN_WRITES_ENABLED = "true";
}
function setUser(user: unknown) {
  getUser.mockResolvedValue({ data: { user } });
}
/**
 * A session whose TOTP factor was verified `totpAgoSeconds` ago.
 *
 * NOTE ON THE PASSWORD TIMESTAMP: session START is the EARLIEST amr timestamp
 * (adminEnv.sessionStartSeconds), so pinning the password entry at "30 seconds
 * ago" while backdating the TOTP would make the SESSION look older than its max
 * age and report `session_expired` instead of `stepup_required`. Both entries
 * are therefore aged together, which models the real thing: a session that
 * began N seconds ago and satisfied TOTP at sign-in.
 */
function setAal(level: "aal1" | "aal2", totpAgoSeconds: number | null = 0) {
  const sessionAge = Math.max(totpAgoSeconds ?? 0, 30);
  const methods: Array<{ method: string; timestamp: number }> = [
    { method: "password", timestamp: now() - sessionAge },
  ];
  if (totpAgoSeconds !== null) {
    methods.push({ method: "totp", timestamp: now() - totpAgoSeconds });
  }
  getAAL.mockResolvedValue({
    data: { currentLevel: level, nextLevel: "aal2", currentAuthenticationMethods: methods },
  });
}

beforeEach(() => {
  getUser.mockReset();
  getAAL.mockReset();
  delete process.env.ADMIN_PORTAL_ENABLED;
  delete process.env.ADMIN_WRITES_ENABLED;
  delete process.env.ADMIN_FOUNDER_USER_IDS;
  delete process.env.ADMIN_FOUNDER_EMAILS;
});

// ── The core regression ──────────────────────────────────────────────────────

describe("requireRecentMfaWrite — the write kill switch is enforced", () => {
  it("REJECTS with writes disabled, even when recent MFA is perfect", async () => {
    portalOn(); // ADMIN_WRITES_ENABLED deliberately unset
    setUser(FOUNDER);
    setAal("aal2", 0);
    await expect(requireRecentMfaWrite()).rejects.toMatchObject({
      reason: "writes_disabled",
    });
  });

  it("REJECTS with ADMIN_WRITES_ENABLED set to a non-'true' value (fail closed)", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2", 0);
    for (const v of ["false", "1", "TRUE", "yes", ""]) {
      process.env.ADMIN_WRITES_ENABLED = v;
      await expect(requireRecentMfaWrite()).rejects.toMatchObject({
        reason: "writes_disabled",
      });
    }
  });

  it("ALLOWS with writes enabled and recent MFA", async () => {
    portalOn();
    writesOn();
    setUser(FOUNDER);
    setAal("aal2", 0);
    await expect(requireRecentMfaWrite()).resolves.toMatchObject({ id: FOUNDER.id });
  });
});

// ── The read guard must NOT regress ──────────────────────────────────────────

describe("requireRecentMfa — sensitive READS still work with writes disabled", () => {
  it("ALLOWS message.revealBody-style reads while ADMIN_WRITES_ENABLED is unset", async () => {
    portalOn(); // writes off, which is production's normal posture
    setUser(FOUNDER);
    setAal("aal2", 0);
    await expect(requireRecentMfa()).resolves.toMatchObject({ id: FOUNDER.id });
  });

  it("still enforces the step-up window for reads", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2", 10 * 60); // TOTP verified 10 min ago: past the 5-min step-up window
    await expect(requireRecentMfa()).rejects.toMatchObject({ reason: "stepup_required" });
  });
});

// ── Gate ORDER: the cheap/most-severe checks must fire first ─────────────────

describe("requireRecentMfaWrite — enforcement order", () => {
  it("rejects portal-off BEFORE looking up any session", async () => {
    writesOn();
    setUser(FOUNDER);
    setAal("aal2", 0);
    await expect(requireRecentMfaWrite()).rejects.toMatchObject({ reason: "portal_disabled" });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    portalOn();
    writesOn();
    setUser(null);
    await expect(requireRecentMfaWrite()).rejects.toMatchObject({ reason: "unauthenticated" });
  });

  it("rejects a non-allowlisted administrator before any MFA lookup", async () => {
    portalOn();
    writesOn();
    setUser(OTHER);
    setAal("aal2", 0);
    await expect(requireRecentMfaWrite()).rejects.toMatchObject({ reason: "denied" });
    expect(getAAL).not.toHaveBeenCalled();
  });

  it("rejects a session that never satisfied MFA (aal1)", async () => {
    portalOn();
    writesOn();
    setUser(FOUNDER);
    setAal("aal1", null);
    await expect(requireRecentMfaWrite()).rejects.toMatchObject({ reason: "mfa_required" });
  });

  it("rejects STALE MFA (aal2 satisfied, but not recently)", async () => {
    portalOn();
    writesOn();
    setUser(FOUNDER);
    setAal("aal2", 10 * 60);
    await expect(requireRecentMfaWrite()).rejects.toMatchObject({ reason: "stepup_required" });
  });

  it("checks the WRITE SWITCH BEFORE the freshness window", async () => {
    // Both would fail. The reported reason must be writes_disabled, proving the
    // kill switch is evaluated first and cannot be skipped by a stale session.
    portalOn(); // writes off
    setUser(FOUNDER);
    setAal("aal2", 10 * 60); // also stale, but session still within max age
    await expect(requireRecentMfaWrite()).rejects.toMatchObject({
      reason: "writes_disabled",
    });
  });

  it("rejects a session past its absolute maximum age", async () => {
    portalOn();
    writesOn();
    process.env.ADMIN_SESSION_MAX_AGE_MINUTES = "15";
    setUser(FOUNDER);
    getAAL.mockResolvedValue({
      data: {
        currentLevel: "aal2",
        nextLevel: "aal2",
        currentAuthenticationMethods: [
          { method: "password", timestamp: now() - 60 * 60 }, // signed in an hour ago
          { method: "totp", timestamp: now() }, // re-verified just now
        ],
      },
    });
    // Re-verifying TOTP must NOT resurrect an aged session.
    await expect(requireRecentMfaWrite()).rejects.toMatchObject({
      reason: "session_expired",
    });
    delete process.env.ADMIN_SESSION_MAX_AGE_MINUTES;
  });
});

// ── Identity is never taken from the caller ──────────────────────────────────

describe("requireRecentMfaWrite — identity provenance", () => {
  it("returns the SERVER-VALIDATED user, not anything a caller could supply", async () => {
    portalOn();
    writesOn();
    setUser(FOUNDER);
    setAal("aal2", 0);
    const user = await requireRecentMfaWrite();
    expect(user.id).toBe(FOUNDER.id);
    // getUser() validates the JWT against the auth server; that is the only
    // identity source in the whole path.
    expect(getUser).toHaveBeenCalled();
  });

  it("throws SecureAdminError (never a bare Error) so callers can map reasons", async () => {
    portalOn();
    setUser(FOUNDER);
    setAal("aal2", 0);
    await expect(requireRecentMfaWrite()).rejects.toBeInstanceOf(SecureAdminError);
  });
});
