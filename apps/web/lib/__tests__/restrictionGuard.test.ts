import { describe, it, expect } from "vitest";
import {
  restrictionRedirectPath,
  shouldLeaveRestrictedShell,
  isRestrictionExemptPath,
  RESTRICTED_PATH,
} from "../auth/restrictionGuard";

// ============================================================================
// Student-web restriction containment — pure routing decision
// ============================================================================
//
// This guard is NOT the security control (migration 058 is). It decides what a
// restricted student SEES. The properties that matter:
//
//   • an unrestricted student is completely unaffected;
//   • a restricted student cannot reach a student page by deep link, client
//     navigation or refresh;
//   • account deletion and the legal pages stay reachable — a restricted
//     account must never become one the student cannot leave;
//   • the private admin portal is untouched;
//   • a lifted or lapsed restriction releases the student automatically.
// ============================================================================

const STUDENT_PAGES = ["/home", "/clubs", "/club/abc", "/u/xyz", "/profile", "/dashboard", "/settings/blocked"];

describe("unrestricted students are completely unaffected", () => {
  it("returns null for every student page when active", () => {
    for (const p of STUDENT_PAGES) {
      expect(`${p}:${restrictionRedirectPath("active", p)}`).toBe(`${p}:null`);
    }
  });

  it("returns null when the state is unknown (fails OPEN, deliberately)", () => {
    // A momentary failure to read the state must not lock out a healthy
    // student. Safe because the server refuses a genuinely restricted account
    // regardless of what this function decides.
    for (const state of [null, undefined]) {
      expect(restrictionRedirectPath(state, "/home")).toBeNull();
    }
  });
});

describe("restricted students are contained", () => {
  for (const state of ["suspended", "restricted", "platform_blocked"] as const) {
    it(`redirects every student page to the shell when ${state}`, () => {
      for (const p of STUDENT_PAGES) {
        expect(`${p}:${restrictionRedirectPath(state, p)}`).toBe(`${p}:${RESTRICTED_PATH}`);
      }
    });
  }

  it("redirects a deep link into a nested student route", () => {
    expect(restrictionRedirectPath("suspended", "/club/abc/events/def")).toBe(RESTRICTED_PATH);
  });

  it("does not redirect the shell itself (no loop)", () => {
    expect(restrictionRedirectPath("suspended", RESTRICTED_PATH)).toBeNull();
  });
});

describe("the escape hatches stay open while restricted", () => {
  it("keeps ACCOUNT DELETION reachable — both entry points", () => {
    for (const p of ["/account/delete", "/delete-account"]) {
      expect(`${p}:${restrictionRedirectPath("platform_blocked", p)}`).toBe(`${p}:null`);
    }
  });

  it("keeps the legal and safety pages reachable", () => {
    for (const p of ["/privacy-policy", "/terms", "/terms-of-service", "/community-guidelines", "/child-safety-standards"]) {
      expect(`${p}:${restrictionRedirectPath("suspended", p)}`).toBe(`${p}:null`);
    }
  });

  it("keeps sign-out and auth callbacks reachable, or the student cannot leave", () => {
    for (const p of ["/login", "/logout", "/auth/confirm", "/auth/reset-password"]) {
      expect(`${p}:${restrictionRedirectPath("suspended", p)}`).toBe(`${p}:null`);
    }
  });
});

describe("the private admin portal is untouched", () => {
  it("never redirects an /admin path, whatever the student state", () => {
    for (const p of ["/admin", "/admin/users/1", "/admin/api/search", "/admin/login"]) {
      expect(`${p}:${restrictionRedirectPath("platform_blocked", p)}`).toBe(`${p}:null`);
    }
  });

  it("uses the SAME prefix test middleware uses to enter its admin branch", () => {
    expect(isRestrictionExemptPath("/administrator-lookalike")).toBe(true);
  });
});

describe("a lifted or lapsed restriction releases the student", () => {
  it("leaves the shell once the state is active", () => {
    expect(shouldLeaveRestrictedShell("active", RESTRICTED_PATH)).toBe(true);
  });

  it("leaves the shell when the state is unreadable (fails open)", () => {
    expect(shouldLeaveRestrictedShell(null, RESTRICTED_PATH)).toBe(true);
  });

  it("stays on the shell while still restricted", () => {
    for (const state of ["suspended", "restricted", "platform_blocked"] as const) {
      expect(`${state}`).toBe(`${state}`);
      expect(shouldLeaveRestrictedShell(state, RESTRICTED_PATH)).toBe(false);
    }
  });

  it("does not fire for pages other than the shell", () => {
    expect(shouldLeaveRestrictedShell("active", "/home")).toBe(false);
  });
});
