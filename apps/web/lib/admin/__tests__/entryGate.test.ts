// ============================================================================
// Admin entry gateway — concealment, ticket integrity, and fail-closed config
// ============================================================================

import { afterEach, describe, expect, it } from "vitest";
import {
  ADMIN_ENTRY_COOKIE_NAME,
  ADMIN_ENTRY_COOKIE_PATH,
  ADMIN_ENTRY_INTERNAL_ROUTE,
  ADMIN_ENTRY_TTL_DEFAULT_MINUTES,
  ADMIN_NOT_FOUND_ROUTE,
  adminEntryCookieSecret,
  adminEntryDecision,
  adminEntryPath,
  adminEntryTtlMinutes,
  isEntryGateConfigured,
  issueEntryTicket,
  normalizeEntryPath,
  readCookie,
  shouldUseSecureCookie,
  signEntryTicket,
  verifyEntryTicket,
} from "../entryGate";

const SECRET = "a".repeat(48);
const ENTRY = "/q7-lantern-mesa-04";

const ENV_KEYS = [
  "ADMIN_ENTRY_PATH",
  "ADMIN_ENTRY_SECRET_HASH",
  "ADMIN_ENTRY_COOKIE_SECRET",
  "ADMIN_ENTRY_COOKIE_TTL_MINUTES",
  "VERCEL_ENV",
  "VERCEL",
] as const;

const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

/** Split a ticket into its two parts without indexed access (strict TS). */
function splitTicket(value: string): { payload: string; sig: string } {
  const i = value.indexOf(".");
  return { payload: value.slice(0, i), sig: value.slice(i + 1) };
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function configure(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}) {
  process.env.ADMIN_ENTRY_PATH = ENTRY;
  process.env.ADMIN_ENTRY_SECRET_HASH = "scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2E=$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYQ==";
  process.env.ADMIN_ENTRY_COOKIE_SECRET = SECRET;
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
}

// ── Concealment: nothing under /admin exists without a ticket ────────────────

describe("concealment: /admin is a 404 without a valid entry ticket", () => {
  const base = { entryPath: ENTRY, configured: true };

  const CONCEALED = [
    "/admin",
    "/admin/",
    "/admin/login",
    "/admin/mfa",
    "/admin/users",
    "/admin/users/94387196-e84c-4a66-acf9-6f3d754bc27f",
    "/admin/reports",
    "/admin/settings",
    "/admin/messages/abc",
    "/admin/deleted-content",
    "/admin/api/search",
    "/admin/api/message-reveal",
    "/admin/api/message-search",
  ];

  for (const pathname of CONCEALED) {
    it(`conceals ${pathname} with no ticket`, () => {
      expect(adminEntryDecision({ ...base, pathname, hasValidTicket: false })).toEqual({
        action: "conceal_admin",
      });
    });
  }

  for (const pathname of CONCEALED) {
    it(`allows ${pathname} through to the existing chain WITH a ticket`, () => {
      expect(adminEntryDecision({ ...base, pathname, hasValidTicket: true })).toEqual({
        action: "admin_allowed",
      });
    });
  }

  it("conceals every admin path when the gate is unconfigured (fail closed)", () => {
    for (const pathname of CONCEALED) {
      expect(
        adminEntryDecision({ pathname, hasValidTicket: false, entryPath: null, configured: false })
      ).toEqual({ action: "conceal_admin" });
    }
  });

  it("404s the internal gateway route when requested directly", () => {
    expect(
      adminEntryDecision({ ...base, pathname: ADMIN_ENTRY_INTERNAL_ROUTE, hasValidTicket: false })
    ).toEqual({ action: "conceal_internal" });
    // Even holding a valid ticket must not expose the internal implementation path.
    expect(
      adminEntryDecision({ ...base, pathname: ADMIN_ENTRY_INTERNAL_ROUTE, hasValidTicket: true })
    ).toEqual({ action: "conceal_internal" });
  });

  it("404s the internal concealment route when requested directly", () => {
    expect(
      adminEntryDecision({ ...base, pathname: ADMIN_NOT_FOUND_ROUTE, hasValidTicket: true })
    ).toEqual({ action: "conceal_internal" });
  });
});

// ── The private path ────────────────────────────────────────────────────────

describe("the private entry path", () => {
  it("rewrites the configured path to the gateway", () => {
    expect(
      adminEntryDecision({ pathname: ENTRY, hasValidTicket: false, entryPath: ENTRY, configured: true })
    ).toEqual({ action: "gateway" });
  });

  it("accepts the configured path with a trailing slash", () => {
    expect(
      adminEntryDecision({ pathname: `${ENTRY}/`, hasValidTicket: false, entryPath: ENTRY, configured: true })
    ).toEqual({ action: "gateway" });
  });

  it("does NOT open the gateway when required config is missing", () => {
    expect(
      adminEntryDecision({ pathname: ENTRY, hasValidTicket: false, entryPath: ENTRY, configured: false })
    ).toEqual({ action: "passthrough" });
  });

  it("does not match a near-miss path", () => {
    for (const near of [`${ENTRY}x`, `${ENTRY}/extra`, ENTRY.slice(0, -1), ENTRY.toUpperCase()]) {
      expect(
        adminEntryDecision({ pathname: near, hasValidTicket: false, entryPath: ENTRY, configured: true })
      ).not.toEqual({ action: "gateway" });
    }
  });
});

// ── Student site untouched ──────────────────────────────────────────────────

describe("public and student routes are completely unaffected", () => {
  const PUBLIC_ROUTES = [
    "/",
    "/login",
    "/get-started",
    "/privacy-policy",
    "/terms",
    "/child-safety-standards",
    "/delete-account",
    "/home",
    "/dashboard",
    "/clubs",
    "/club/abc",
    "/profile",
    "/u/123",
    "/onboarding/signup",
    "/auth/confirm",
    "/account-restricted",
    "/robots.txt",
  ];

  for (const pathname of PUBLIC_ROUTES) {
    it(`passes through ${pathname} regardless of ticket state`, () => {
      for (const hasValidTicket of [false, true]) {
        expect(
          adminEntryDecision({ pathname, hasValidTicket, entryPath: ENTRY, configured: true })
        ).toEqual({ action: "passthrough" });
      }
    });
  }

  it("passes public routes through even when the gate is unconfigured", () => {
    for (const pathname of PUBLIC_ROUTES) {
      expect(
        adminEntryDecision({ pathname, hasValidTicket: false, entryPath: null, configured: false })
      ).toEqual({ action: "passthrough" });
    }
  });

  it("does not treat a student path that merely contains 'admin' as an admin path", () => {
    for (const pathname of ["/u/admin", "/club/admin-club", "/administrators"]) {
      expect(
        adminEntryDecision({ pathname, hasValidTicket: false, entryPath: ENTRY, configured: true })
      ).toEqual({ action: "passthrough" });
    }
  });
});

// ── Ticket integrity ────────────────────────────────────────────────────────

describe("entry ticket integrity", () => {
  it("issues a ticket that verifies, and stores no phrase in it", async () => {
    const { value, ticket } = await issueEntryTicket(SECRET, 10, 1_000);
    expect(await verifyEntryTicket(SECRET, value, 1_000)).toMatchObject({ v: 1, exp: 1_600 });
    // The payload is public once decoded — it must carry only timing + a nonce.
    const payload = JSON.parse(
      Buffer.from(splitTicket(value).payload, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "jti", "v"]);
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(ticket.jti).toBeTruthy();
  });

  it("rejects a modified payload", async () => {
    const { value } = await issueEntryTicket(SECRET, 10, 1_000);
    const { payload, sig } = splitTicket(value);
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.exp = 99_999_999; // attacker extends their own ticket
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;
    expect(await verifyEntryTicket(SECRET, forged, 1_000)).toBeNull();
  });

  it("rejects a modified signature", async () => {
    const { value } = await issueEntryTicket(SECRET, 10, 1_000);
    const { payload, sig } = splitTicket(value);
    // Flip a bit in the DECODED signature and re-encode. Mutating the last
    // base64url character is not a reliable tamper: its low bits are discarded
    // padding, so several characters decode to identical bytes.
    const bytes = Buffer.from(sig, "base64url");
    bytes.set([(bytes.at(0) ?? 0) ^ 0x01], 0);
    const tampered = bytes.toString("base64url");
    expect(tampered).not.toBe(sig);
    expect(await verifyEntryTicket(SECRET, `${payload}.${tampered}`, 1_000)).toBeNull();
  });

  it("rejects a signature truncated or padded to a different length", async () => {
    const { value } = await issueEntryTicket(SECRET, 10, 1_000);
    const { payload, sig } = splitTicket(value);
    const short = Buffer.from(sig, "base64url").subarray(0, 16).toString("base64url");
    const long = Buffer.concat([Buffer.from(sig, "base64url"), Buffer.alloc(4)]).toString("base64url");
    expect(await verifyEntryTicket(SECRET, `${payload}.${short}`, 1_000)).toBeNull();
    expect(await verifyEntryTicket(SECRET, `${payload}.${long}`, 1_000)).toBeNull();
  });

  it("rejects a ticket signed with a different secret", async () => {
    const { value } = await issueEntryTicket("b".repeat(48), 10, 1_000);
    expect(await verifyEntryTicket(SECRET, value, 1_000)).toBeNull();
  });

  it("rejects an expired ticket", async () => {
    const { value } = await issueEntryTicket(SECRET, 10, 1_000);
    expect(await verifyEntryTicket(SECRET, value, 1_000 + 600)).toBeNull(); // exactly at exp
    expect(await verifyEntryTicket(SECRET, value, 1_000 + 601)).toBeNull();
    expect(await verifyEntryTicket(SECRET, value, 1_000 + 60_000)).toBeNull();
  });

  it("honours the configured TTL", async () => {
    const { ticket } = await issueEntryTicket(SECRET, 3, 500);
    expect(ticket.exp - ticket.iat).toBe(180);
  });

  it("rejects malformed, empty and structurally odd values", async () => {
    for (const bad of [
      undefined,
      null,
      "",
      ".",
      "abc",
      "abc.",
      ".abc",
      "a.b.c",
      "!!!.???",
      "e30=.e30=",
    ]) {
      expect(await verifyEntryTicket(SECRET, bad as string | undefined, 1_000)).toBeNull();
    }
  });

  it("rejects a ticket whose version is not 1", async () => {
    const forged = await signEntryTicket(SECRET, {
      v: 2 as unknown as 1,
      iat: 1_000,
      exp: 9_999_999,
      jti: "x",
    });
    expect(await verifyEntryTicket(SECRET, forged, 1_000)).toBeNull();
  });

  it("issues a distinct ticket every time", async () => {
    const a = await issueEntryTicket(SECRET, 10, 1_000);
    const b = await issueEntryTicket(SECRET, 10, 1_000);
    expect(a.value).not.toBe(b.value);
  });
});

// ── Config: fail closed ─────────────────────────────────────────────────────

describe("environment configuration fails closed", () => {
  it("is configured only when all three required values are valid", () => {
    configure();
    expect(isEntryGateConfigured()).toBe(true);

    for (const missing of [
      "ADMIN_ENTRY_PATH",
      "ADMIN_ENTRY_SECRET_HASH",
      "ADMIN_ENTRY_COOKIE_SECRET",
    ] as const) {
      configure();
      delete process.env[missing];
      expect(isEntryGateConfigured()).toBe(false);
    }
  });

  it("treats a short cookie secret as unconfigured", () => {
    configure({ ADMIN_ENTRY_COOKIE_SECRET: "tooshort" });
    expect(adminEntryCookieSecret()).toBeNull();
    expect(isEntryGateConfigured()).toBe(false);
  });

  it("rejects unsafe or reserved private paths", () => {
    for (const bad of [
      undefined,
      "",
      "/",
      "no-leading-slash",
      "/has space",
      "/a//b",
      "/../escape",
      "/with?query",
      "/with#hash",
      "/admin",
      "/admin/secret",
      "/api/hidden",
      "/_next/hidden",
      "/auth/hidden",
      "/wgx-entry",
      `/${"x".repeat(200)}`,
    ]) {
      expect(normalizeEntryPath(bad)).toBeNull();
    }
  });

  it("accepts and normalizes a good private path", () => {
    expect(normalizeEntryPath("/q7-lantern-mesa-04")).toBe("/q7-lantern-mesa-04");
    expect(normalizeEntryPath("  /q7-lantern-mesa-04/  ")).toBe("/q7-lantern-mesa-04");
    expect(normalizeEntryPath("/deep/private/entry")).toBe("/deep/private/entry");
  });

  it("defaults and clamps the TTL to a sane range", () => {
    configure();
    delete process.env.ADMIN_ENTRY_COOKIE_TTL_MINUTES;
    expect(adminEntryTtlMinutes()).toBe(ADMIN_ENTRY_TTL_DEFAULT_MINUTES);

    configure({ ADMIN_ENTRY_COOKIE_TTL_MINUTES: "10" });
    expect(adminEntryTtlMinutes()).toBe(10);
    configure({ ADMIN_ENTRY_COOKIE_TTL_MINUTES: "0" });
    expect(adminEntryTtlMinutes()).toBe(1);
    configure({ ADMIN_ENTRY_COOKIE_TTL_MINUTES: "99999" });
    expect(adminEntryTtlMinutes()).toBe(60);
    configure({ ADMIN_ENTRY_COOKIE_TTL_MINUTES: "not-a-number" });
    expect(adminEntryTtlMinutes()).toBe(ADMIN_ENTRY_TTL_DEFAULT_MINUTES);
  });

  it("reads the private path only from the environment", () => {
    configure();
    expect(adminEntryPath()).toBe(ENTRY);
    delete process.env.ADMIN_ENTRY_PATH;
    expect(adminEntryPath()).toBeNull();
  });
});

// ── Cookie attributes ───────────────────────────────────────────────────────

describe("cookie scoping and flags", () => {
  it("scopes the ticket to the admin subtree only", () => {
    expect(ADMIN_ENTRY_COOKIE_PATH).toBe("/admin");
  });

  it("uses an opaque cookie name that does not hint at an admin area", () => {
    expect(ADMIN_ENTRY_COOKIE_NAME).not.toMatch(/admin|entry|gate|founder|portal/i);
  });

  it("marks the cookie Secure on Vercel preview and production only", () => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    expect(shouldUseSecureCookie()).toBe(false); // local http development
    process.env.VERCEL_ENV = "preview";
    expect(shouldUseSecureCookie()).toBe(true);
    process.env.VERCEL_ENV = "production";
    expect(shouldUseSecureCookie()).toBe(true);
  });

  it("parses the ticket out of a realistic Cookie header", () => {
    const header = `sb-access-token=xyz; ${ADMIN_ENTRY_COOKIE_NAME}=abc.def; other=1`;
    expect(readCookie(header, ADMIN_ENTRY_COOKIE_NAME)).toBe("abc.def");
    expect(readCookie(header, "missing")).toBeNull();
    expect(readCookie(null, ADMIN_ENTRY_COOKIE_NAME)).toBeNull();
    // Must not match a cookie whose name merely ends with the target name.
    expect(readCookie(`x${ADMIN_ENTRY_COOKIE_NAME}=nope`, ADMIN_ENTRY_COOKIE_NAME)).toBeNull();
  });
});
