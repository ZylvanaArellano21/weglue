// ============================================================================
// Admin entry gateway — phrase verification, brute-force limits, log hygiene
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ENTRY_LOCKOUT_MS,
  ENTRY_MAX_ATTEMPTS,
  ENTRY_TRACKER_MAX_KEYS,
  ENTRY_WINDOW_MS,
  __resetEntryAttempts,
  clientKey,
  createScryptHash,
  isLockedOut,
  logEntrySecurityEvent,
  parseScryptHash,
  recordAttempt,
  verifyEntryPhrase,
} from "../entryGateServer";

const PHRASE = "correct horse battery staple lantern mesa";
let HASH: string;

beforeEach(() => {
  __resetEntryAttempts();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

// ── Phrase verification ─────────────────────────────────────────────────────

describe("phrase verification against the stored scrypt hash", () => {
  beforeEach(() => {
    HASH ??= createScryptHash(PHRASE);
  });

  it("accepts the correct phrase", () => {
    expect(verifyEntryPhrase(PHRASE, HASH)).toBe(true);
  });

  it("rejects a wrong phrase", () => {
    for (const wrong of [
      "wrong phrase entirely",
      PHRASE.toUpperCase(),
      `${PHRASE} `,
      ` ${PHRASE}`,
      PHRASE.slice(0, -1),
      `${PHRASE}x`,
      "",
    ]) {
      expect(verifyEntryPhrase(wrong, HASH)).toBe(false);
    }
  });

  it("NEVER stores the plaintext phrase in the hash", () => {
    const hash = createScryptHash(PHRASE);
    expect(hash).not.toContain(PHRASE);
    expect(hash).not.toContain("horse");
    expect(hash).not.toContain("battery");
    // Only the documented parameter/salt/digest envelope.
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    // The digest must not be a reversible encoding of the phrase.
    const digest = Buffer.from(hash.split("$")[5] ?? "", "base64").toString("utf8");
    expect(digest).not.toContain(PHRASE);
  });

  it("salts each hash, so the same phrase yields different stored values", () => {
    const a = createScryptHash(PHRASE);
    const b = createScryptHash(PHRASE);
    expect(a).not.toBe(b);
    expect(verifyEntryPhrase(PHRASE, a)).toBe(true);
    expect(verifyEntryPhrase(PHRASE, b)).toBe(true);
  });

  it("fails closed for an absent or malformed stored hash", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "not-a-hash",
      "scrypt$16384$8$1$onlyfourparts",
      "bcrypt$16384$8$1$c2FsdHNhbHRzYWx0c2E=$aGFzaGhhc2hoYXNoaGFzaA==",
      "scrypt$x$8$1$c2FsdHNhbHRzYWx0c2E=$aGFzaGhhc2hoYXNoaGFzaA==",
      // Weak / hostile parameters must be refused, not honoured.
      "scrypt$1$8$1$c2FsdHNhbHRzYWx0c2E=$aGFzaGhhc2hoYXNoaGFzaA==",
      "scrypt$16384$999$1$c2FsdHNhbHRzYWx0c2E=$aGFzaGhhc2hoYXNoaGFzaA==",
      // Too-short salt.
      "scrypt$16384$8$1$c2E=$aGFzaGhhc2hoYXNoaGFzaA==",
    ]) {
      expect(parseScryptHash(bad)).toBeNull();
      expect(verifyEntryPhrase(PHRASE, bad)).toBe(false);
    }
  });

  it("rejects an oversized phrase without doing scrypt work", () => {
    expect(verifyEntryPhrase("x".repeat(10_000), HASH)).toBe(false);
  });

  it("never throws, whatever it is handed", () => {
    expect(() =>
      verifyEntryPhrase(undefined as unknown as string, HASH)
    ).not.toThrow();
    expect(verifyEntryPhrase(undefined as unknown as string, HASH)).toBe(false);
    expect(verifyEntryPhrase(123 as unknown as string, HASH)).toBe(false);
  });
});

// ── Brute-force protection ──────────────────────────────────────────────────

describe("brute-force limits", () => {
  it("locks out after the configured number of failures", () => {
    const key = "client-a";
    for (let i = 1; i < ENTRY_MAX_ATTEMPTS; i++) {
      const state = recordAttempt(key, false);
      expect(state.locked).toBe(false);
      expect(state.failures).toBe(i);
      expect(isLockedOut(key)).toBe(false);
    }
    const final = recordAttempt(key, false);
    expect(final.failures).toBe(ENTRY_MAX_ATTEMPTS);
    expect(final.locked).toBe(true);
    expect(isLockedOut(key)).toBe(true);
  });

  it("keeps the lockout for its full duration, then releases it", () => {
    const key = "client-b";
    const t0 = 1_000_000;
    for (let i = 0; i < ENTRY_MAX_ATTEMPTS; i++) recordAttempt(key, false, t0);
    expect(isLockedOut(key, t0)).toBe(true);
    expect(isLockedOut(key, t0 + ENTRY_LOCKOUT_MS - 1)).toBe(true);
    expect(isLockedOut(key, t0 + ENTRY_LOCKOUT_MS + 1)).toBe(false);
  });

  it("rolls the failure window so old failures do not accumulate forever", () => {
    const key = "client-c";
    const t0 = 2_000_000;
    recordAttempt(key, false, t0);
    recordAttempt(key, false, t0);
    // A failure after the window elapses starts counting again from 1.
    const later = recordAttempt(key, false, t0 + ENTRY_WINDOW_MS + 1);
    expect(later.failures).toBe(1);
    expect(later.locked).toBe(false);
  });

  it("clears the record on success", () => {
    const key = "client-d";
    recordAttempt(key, false);
    recordAttempt(key, false);
    expect(recordAttempt(key, true)).toEqual({ locked: false, failures: 0 });
    expect(isLockedOut(key)).toBe(false);
  });

  it("tracks clients independently", () => {
    for (let i = 0; i < ENTRY_MAX_ATTEMPTS; i++) recordAttempt("noisy", false);
    expect(isLockedOut("noisy")).toBe(true);
    expect(isLockedOut("quiet")).toBe(false);
  });

  it("bounds memory under a spray of unique clients", () => {
    for (let i = 0; i < ENTRY_TRACKER_MAX_KEYS + 500; i++) recordAttempt(`spray-${i}`, false);
    // The most recent client must still be tracked (eviction drops the oldest).
    expect(isLockedOut(`spray-${ENTRY_TRACKER_MAX_KEYS + 499}`)).toBe(false);
    const recent = recordAttempt(`spray-${ENTRY_TRACKER_MAX_KEYS + 499}`, false);
    expect(recent.failures).toBeGreaterThanOrEqual(1);
  });
});

describe("client keying", () => {
  it("derives a non-reversible key from the forwarded address", () => {
    const key = clientKey(headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" }), "s".repeat(48));
    expect(key).not.toContain("203.0.113.7");
    expect(key).not.toContain("70.41.3.18");
    expect(key.length).toBe(22);
  });

  it("is stable for the same address and different across addresses", () => {
    const secret = "s".repeat(48);
    const a = clientKey(headers({ "x-forwarded-for": "203.0.113.7" }), secret);
    const b = clientKey(headers({ "x-forwarded-for": "203.0.113.7" }), secret);
    const c = clientKey(headers({ "x-forwarded-for": "198.51.100.9" }), secret);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("falls back to a shared bucket when no address is present (throttles harder)", () => {
    expect(clientKey(headers({}), "s".repeat(48))).toBeTruthy();
    expect(clientKey(headers({}), null)).toBe("anon:unknown");
  });
});

// ── Log hygiene ─────────────────────────────────────────────────────────────

describe("security events never contain secret material", () => {
  it("logs only the allowed fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logEntrySecurityEvent("admin_entry.failure", {
      clientKey: "abc123",
      failures: 3,
      locked: false,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0] ?? "");
    const payload = JSON.parse(line.replace("[security] ", "")) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["client", "evt", "failures", "locked", "ts"]);
  });

  it("cannot leak the phrase, hash, cookie or a TOTP code", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logEntrySecurityEvent("admin_entry.success", { clientKey: "abc123" });
    const line = String(warn.mock.calls[0]?.[0] ?? "");
    for (const secretish of [
      PHRASE,
      "horse",
      "scrypt$",
      "wg_x1",
      "123456", // a TOTP code
      "password",
      "Bearer ",
    ]) {
      expect(line).not.toContain(secretish);
    }
  });
});
