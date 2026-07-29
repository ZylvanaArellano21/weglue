import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  platformAdminRedirectPath,
  isPlatformAdminExemptPath,
  PLATFORM_ADMIN_BLOCKED_PATH,
} from "../auth/platformAdminGuard";
import { isPlatformAdminAuthUser } from "@weglue/shared/auth/platformAdmin";

// ============================================================================
// Student web app — platform-admin containment
// ============================================================================
// Proves the founder's admin identity cannot enter the normal student web app,
// and — just as important — that ordinary `.edu` students are entirely
// unaffected by the guard.

const ADMIN = { app_metadata: { provider: "email", account_type: "platform_admin" } };
const STUDENT = { app_metadata: { provider: "email", providers: ["email"] } };
const OAUTH_STUDENT = { app_metadata: { provider: "azure", providers: ["azure"] } };

const STUDENT_ROUTES = [
  "/",
  "/home",
  "/dashboard",
  "/clubs",
  "/club/abc",
  "/profile/own",
  "/u/someone",
  "/interests",
  "/login",
  "/get-started",
  "/onboarding/signup",
  "/onboarding/interests",
  "/onboarding/activities",
  "/onboarding/explore-clubs",
  "/invite/token123",
];

describe("platform-admin cannot enter the student web app", () => {
  it("redirects a platform-admin session away from every student route", () => {
    for (const route of STUDENT_ROUTES) {
      expect(platformAdminRedirectPath(ADMIN, route), route).toBe(
        PLATFORM_ADMIN_BLOCKED_PATH
      );
    }
  });

  it("blocks onboarding and profile-repair routes specifically", () => {
    // These are the routes that would otherwise create/require a student
    // profile row for the admin identity.
    for (const route of [
      "/onboarding/signup",
      "/onboarding/interests",
      "/onboarding/activities",
      "/dashboard",
      "/home",
    ]) {
      expect(platformAdminRedirectPath(ADMIN, route), route).not.toBeNull();
    }
  });

  it("does not loop: the blocked page itself is reachable", () => {
    expect(platformAdminRedirectPath(ADMIN, PLATFORM_ADMIN_BLOCKED_PATH)).toBeNull();
  });

  it("leaves /auth/* reachable so sign-out and recovery still work", () => {
    expect(platformAdminRedirectPath(ADMIN, "/auth/callback")).toBeNull();
    expect(platformAdminRedirectPath(ADMIN, "/auth/reset-password")).toBeNull();
  });

  it("never intercepts /admin — that subtree has its own stricter gate", () => {
    expect(platformAdminRedirectPath(ADMIN, "/admin")).toBeNull();
    expect(platformAdminRedirectPath(ADMIN, "/admin/login")).toBeNull();
    expect(platformAdminRedirectPath(ADMIN, "/admin/mfa")).toBeNull();
  });

  it("keeps the store-policy pages reachable", () => {
    for (const p of [
      "/privacy-policy",
      "/terms",
      "/terms-of-service",
      "/child-safety-standards",
      "/delete-account",
    ]) {
      expect(platformAdminRedirectPath(ADMIN, p), p).toBeNull();
    }
  });
});

describe("ordinary students are completely unaffected", () => {
  it("never redirects a password (.edu) student on any route", () => {
    for (const route of STUDENT_ROUTES) {
      expect(platformAdminRedirectPath(STUDENT, route), route).toBeNull();
    }
  });

  it("never redirects a Microsoft (OAuth) student", () => {
    for (const route of STUDENT_ROUTES) {
      expect(platformAdminRedirectPath(OAUTH_STUDENT, route), route).toBeNull();
    }
  });

  it("never redirects an anonymous visitor", () => {
    for (const route of STUDENT_ROUTES) {
      expect(platformAdminRedirectPath(null, route), route).toBeNull();
      expect(platformAdminRedirectPath(undefined, route), route).toBeNull();
    }
  });
});

describe("the marker cannot be spoofed or accidentally matched", () => {
  it("only the exact string 'platform_admin' counts", () => {
    expect(isPlatformAdminAuthUser({ app_metadata: { account_type: "platform_admin" } })).toBe(true);
    expect(isPlatformAdminAuthUser({ app_metadata: { account_type: "Platform_Admin" } })).toBe(false);
    expect(isPlatformAdminAuthUser({ app_metadata: { account_type: "platform_admin " } })).toBe(false);
    expect(isPlatformAdminAuthUser({ app_metadata: { account_type: "admin" } })).toBe(false);
    expect(isPlatformAdminAuthUser({ app_metadata: { account_type: true } })).toBe(false);
    expect(isPlatformAdminAuthUser({ app_metadata: { account_type: 1 } })).toBe(false);
    expect(isPlatformAdminAuthUser({ app_metadata: {} })).toBe(false);
    expect(isPlatformAdminAuthUser({ app_metadata: null })).toBe(false);
    expect(isPlatformAdminAuthUser({})).toBe(false);
    expect(isPlatformAdminAuthUser(null)).toBe(false);
  });

  it("a client-settable user_metadata claim is NOT honored", () => {
    // signUp({options:{data}}) and auth.updateUser({data}) write user_metadata.
    // If the guard read that, any student could mark themselves. It must not.
    const spoofer: any = {
      app_metadata: { provider: "email" },
      user_metadata: { account_type: "platform_admin" },
    };
    expect(isPlatformAdminAuthUser(spoofer)).toBe(false);
    expect(platformAdminRedirectPath(spoofer, "/home")).toBeNull();
  });
});

describe("exempt-path predicate", () => {
  it("matches nested paths under an exempt prefix", () => {
    expect(isPlatformAdminExemptPath("/privacy-policy/details")).toBe(true);
    expect(isPlatformAdminExemptPath("/auth/callback?code=x")).toBe(true);
  });

  it("does not treat a lookalike legal path as exempt", () => {
    expect(isPlatformAdminExemptPath("/terms-and-conditions-club")).toBe(false);
    expect(isPlatformAdminExemptPath("/privacy-policy-club")).toBe(false);
  });

  it("uses the same /admin prefix test as middleware, on purpose", () => {
    // middleware enters its admin branch on pathname.startsWith("/admin") and
    // returns before this guard runs, so the two must agree. Asserted so a
    // future 'tightening' of one side can't silently diverge from the other.
    const middleware = readFileSync(
      fileURLToPath(new URL("../../middleware.ts", import.meta.url)),
      "utf8"
    );
    expect(middleware).toContain('pathname.startsWith("/admin")');
    expect(isPlatformAdminExemptPath("/administrators")).toBe(true);
  });
});

describe("the Admin Dashboard is not advertised on any public surface", () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("the blocked page names no admin URL and renders no admin link", () => {
    const page = read("../../app/account-restricted/page.tsx");
    const actions = read("../../app/account-restricted/AccountRestrictedActions.tsx");
    for (const src of [page, actions]) {
      expect(src).not.toMatch(/href=["'][^"']*\/admin/);
      expect(src).not.toMatch(/router\.(push|replace)\(["'][^"']*\/admin/);
    }
  });

  it("the student login page contains no admin link", () => {
    const src = read("../../app/login/page.tsx");
    expect(src).not.toMatch(/href=["'][^"']*\/admin/);
  });

  it("the guard module never grants admin authorization", () => {
    // account_type must remain classification-only. If this file ever starts
    // importing the admin gate, the separation has been broken.
    const src = read("../auth/platformAdminGuard.ts");
    expect(src).not.toMatch(/ADMIN_FOUNDER_USER_IDS|requireSecureAdmin|isAllowlistedAdmin/);
  });
});
