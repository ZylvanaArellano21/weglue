import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  isPlatformAdminSession,
  resolveMobileSessionRoute,
  shouldSyncStudentProfile,
  shouldHandleDeepLinkNavigation,
} from "../platformAdmin";

// ============================================================================
// Mobile platform-admin containment — iOS AND Android
// ============================================================================
// There is exactly ONE implementation of this behavior and both platforms run
// it: these pure functions, plus the root layout that consumes them. The last
// describe block asserts that wiring at the source level, and asserts that no
// Platform.OS branch exists anywhere in the path — so a "works on iOS, leaks on
// Android" divergence cannot be introduced without failing a test.

const ADMIN_SESSION = {
  user: {
    id: "94387196-e84c-4a66-acf9-6f3d754bc27f",
    email: "founder-admin@example.com",
    app_metadata: {
      provider: "email",
      providers: ["email"],
      account_type: "platform_admin",
    },
  },
};

const STUDENT_SESSION = {
  user: {
    id: "student-uuid",
    email: "student@my.lonestar.edu",
    app_metadata: { provider: "email", providers: ["email"] },
  },
};

const OAUTH_STUDENT_SESSION = {
  user: {
    id: "ms-student-uuid",
    email: "student@my.lonestar.edu",
    app_metadata: { provider: "azure", providers: ["azure"] },
  },
};

// `pathname` rather than node:url's fileURLToPath — the mobile tsconfig pulls
// in DOM lib types, which makes the DOM `URL` incompatible with node's.
const readRaw = (rel: string) =>
  readFileSync(
    decodeURIComponent(new URL(rel, import.meta.url).pathname),
    "utf8"
  );

/**
 * Source with comments removed. These assertions are about what the app DOES,
 * so a comment that merely mentions `<Stack>` or `Platform.OS` (this codebase
 * documents itself heavily) must not be mistaken for code.
 */
const read = (rel: string) =>
  readRaw(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("recognizing a platform-admin session", () => {
  it("recognizes the founder's admin identity", () => {
    expect(isPlatformAdminSession(ADMIN_SESSION)).toBe(true);
  });

  it("does not recognize any student session", () => {
    expect(isPlatformAdminSession(STUDENT_SESSION)).toBe(false);
    expect(isPlatformAdminSession(OAUTH_STUDENT_SESSION)).toBe(false);
  });

  it("fails closed to 'student' for a missing session", () => {
    expect(isPlatformAdminSession(null)).toBe(false);
    expect(isPlatformAdminSession(undefined)).toBe(false);
    expect(isPlatformAdminSession({} as any)).toBe(false);
    expect(isPlatformAdminSession({ user: null })).toBe(false);
  });

  it("cannot be spoofed through client-writable user_metadata", () => {
    // A phone can set user_metadata (signUp options.data / updateUser data).
    // It can never set app_metadata. Only the latter may be honored.
    const spoofer: any = {
      user: {
        id: "student-uuid",
        app_metadata: { provider: "email" },
        user_metadata: { account_type: "platform_admin" },
      },
    };
    expect(isPlatformAdminSession(spoofer)).toBe(false);
    expect(resolveMobileSessionRoute(spoofer)).toBe("student");
  });

  it("matches only the exact marker value", () => {
    const withType = (account_type: unknown) => ({
      user: { app_metadata: { account_type } },
    });
    expect(isPlatformAdminSession(withType("platform_admin") as any)).toBe(true);
    expect(isPlatformAdminSession(withType("Platform_Admin") as any)).toBe(false);
    expect(isPlatformAdminSession(withType("admin") as any)).toBe(false);
    expect(isPlatformAdminSession(withType(true) as any)).toBe(false);
    expect(isPlatformAdminSession(withType(null) as any)).toBe(false);
  });
});

describe("root routing: a platform-admin session never enters the app", () => {
  it("routes a platform-admin session to the blocking screen", () => {
    expect(resolveMobileSessionRoute(ADMIN_SESSION)).toBe("platform-admin-blocked");
  });

  it("routes students to the normal app, unchanged", () => {
    expect(resolveMobileSessionRoute(STUDENT_SESSION)).toBe("student");
    expect(resolveMobileSessionRoute(OAUTH_STUDENT_SESSION)).toBe("student");
  });

  it("routes no session to the normal signed-out flow", () => {
    expect(resolveMobileSessionRoute(null)).toBe("signed-out");
  });
});

describe("a platform-admin session never touches the student profile", () => {
  it("never syncs or repairs a profile (so ensure_profile is never called)", () => {
    expect(shouldSyncStudentProfile(ADMIN_SESSION)).toBe(false);
  });

  it("still syncs profiles for every student session", () => {
    expect(shouldSyncStudentProfile(STUDENT_SESSION)).toBe(true);
    expect(shouldSyncStudentProfile(OAUTH_STUDENT_SESSION)).toBe(true);
  });

  it("does not sync when signed out", () => {
    expect(shouldSyncStudentProfile(null)).toBe(false);
  });
});

describe("deep links cannot drag a platform admin into a student destination", () => {
  it("suppresses deep-link navigation for a platform-admin session", () => {
    expect(shouldHandleDeepLinkNavigation(ADMIN_SESSION)).toBe(false);
  });

  it("leaves deep links working for students and for signed-out users", () => {
    expect(shouldHandleDeepLinkNavigation(STUDENT_SESSION)).toBe(true);
    expect(shouldHandleDeepLinkNavigation(OAUTH_STUDENT_SESSION)).toBe(true);
    // Signed-out matters: an admin's own sign-in link must still be processed.
    expect(shouldHandleDeepLinkNavigation(null)).toBe(true);
  });
});

describe("the guard is actually wired into the app (iOS and Android alike)", () => {
  const layout = read("../../app/_layout.tsx");
  const block = read("../../components/auth/PlatformAdminBlock.tsx");
  const guard = read("../platformAdmin.ts");

  it("the root layout consumes the shared decision", () => {
    expect(layout).toContain("resolveMobileSessionRoute");
    expect(layout).toContain("shouldSyncStudentProfile");
  });

  it("the root layout renders the block INSTEAD of the navigator", () => {
    // The blocking return must come before the navigator is rendered; if it
    // were merely overlaid, Home/tabs would still mount and query student data.
    const blockAt = layout.indexOf("<PlatformAdminBlock");
    const stackAt = layout.indexOf("<Stack");
    expect(blockAt).toBeGreaterThan(-1);
    expect(stackAt).toBeGreaterThan(-1);
    expect(blockAt).toBeLessThan(stackAt);
  });

  it("gates ensure_profile behind the guard", () => {
    const rpcAt = layout.indexOf('rpc("ensure_profile")');
    const guardAt = layout.indexOf("shouldSyncStudentProfile");
    expect(rpcAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(rpcAt);
  });

  it("both deep-link hooks consult the guard", () => {
    expect(read("../../hooks/useAuthDeepLink.ts")).toContain(
      "shouldHandleDeepLinkNavigation"
    );
    expect(read("../../hooks/useInviteDeepLink.ts")).toContain(
      "shouldHandleDeepLinkNavigation"
    );
  });

  it("offers ONLY a sign-out affordance — no dashboard link of any kind", () => {
    expect(block).toContain("Sign out");
    expect(block).toContain("onSignOut");
    // No admin URL, deep link, or hidden entry point may exist in the binary.
    expect(block).not.toMatch(/\/admin/);
    expect(block).not.toMatch(/Linking\.openURL|WebBrowser|openAuthSession/);
    expect(block).not.toMatch(/onLongPress/);
    expect(block).not.toMatch(/weglue\.app/);
  });

  it("has no platform-specific branch anywhere in the guard path", () => {
    // This is the "no platform can bypass the guard" assertion.
    for (const [name, src] of [
      ["lib/platformAdmin.ts", guard],
      ["components/auth/PlatformAdminBlock.tsx", block],
    ] as const) {
      expect(src, name).not.toMatch(/Platform\.OS/);
      expect(src, name).not.toMatch(/\bisAndroid\b|\bisIOS\b/);
    }
    // The layout does contain one pre-existing Platform.OS use (the react-query
    // focus manager). Assert the platform-admin decision itself is not inside
    // any such branch: the guard lines must not mention Platform.
    const guardLines = layout
      .split("\n")
      .filter(
        (l) =>
          l.includes("resolveMobileSessionRoute") ||
          l.includes("shouldSyncStudentProfile") ||
          l.includes("isPlatformAdmin")
      );
    expect(guardLines.length).toBeGreaterThan(0);
    for (const l of guardLines) expect(l).not.toMatch(/Platform\./);
  });
});
