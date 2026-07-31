import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeDb } from "./fakeAdmin";

const h = vi.hoisted(() => {
  const holder = { db: null as any };
  return { getUser: vi.fn(), getAAL: vi.fn(), holder, createAdminClient: vi.fn(() => holder.db) };
});
vi.mock("../../supabase/server", () => ({
  createClient: () => ({ auth: { getUser: h.getUser, mfa: { getAuthenticatorAssuranceLevel: h.getAAL } } }),
}));
vi.mock("../../supabase/admin", () => ({ createAdminClient: h.createAdminClient }));

import { getAdminSettings } from "../settingsData";
import { testSupabaseConnection } from "../settingsActions";
import { SecureAdminError } from "../secureAdmin";

const FOUNDER = { id: "00000001-0000-0000-0000-000000000001", email: "founder@weglue.app" };
const SECRET = "super-secret-service-role-key-value";

function asFounder(writes = true) {
  process.env.ADMIN_PORTAL_ENABLED = "true";
  process.env.ADMIN_WRITES_ENABLED = writes ? "true" : "false";
  process.env.ADMIN_FOUNDER_USER_IDS = FOUNDER.id;
  process.env.ADMIN_FOUNDER_EMAILS = FOUNDER.email;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc123.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET;
  h.getUser.mockResolvedValue({ data: { user: FOUNDER } });
  h.getAAL.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }] } });
}

/** Stub the PostgREST OpenAPI description the capability probe reads. */
function stubRpcSpec(paths: string[], opts: { ok?: boolean; throws?: boolean } = {}) {
  const f = vi.fn(async () => {
    if (opts.throws) throw new Error("network down");
    return {
      ok: opts.ok ?? true,
      json: async () => ({ paths: Object.fromEntries(paths.map((p) => [p, {}])) }),
    } as unknown as Response;
  });
  globalThis.fetch = f as unknown as typeof fetch;
  return f;
}

/** A db whose audit tables are absent, as before migration 055. */
function dbWithoutAudit() {
  const db = makeDb({ universities: [{ id: "u", name: "State U" }] }, []);
  const orig = db.from;
  (db as any).from = (t: string) => {
    if (t === "admin_audit_events" || t === "admin_audit_actions" || t === "message_deletion_attempts") {
      const b: any = {
        select: () => b,
        limit: () => Promise.resolve({ data: null, count: null, error: { code: "PGRST205", message: "not found" } }),
        then: (res: any, rej: any) =>
          Promise.resolve({ data: null, count: null, error: { code: "PGRST205", message: "not found" } }).then(res, rej),
      };
      return b;
    }
    return orig(t);
  };
  return db;
}

/** A db whose audit tables exist. `events` may legitimately be empty. */
function dbWithAudit(events = 0, catalog = 26) {
  const db = makeDb({ universities: [{ id: "u", name: "State U" }] }, []);
  const orig = db.from;
  (db as any).from = (t: string) => {
    if (t === "admin_audit_events" || t === "admin_audit_actions") {
      const n = t === "admin_audit_events" ? events : catalog;
      const b: any = {
        select: () => b,
        limit: () => Promise.resolve({ data: null, count: n, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: null, count: n, error: null }).then(res, rej),
      };
      return b;
    }
    if (t === "message_deletion_attempts") {
      const b: any = {
        select: () => b,
        limit: () => Promise.resolve({ data: null, count: null, error: { code: "PGRST205", message: "not found" } }),
        then: (res: any, rej: any) =>
          Promise.resolve({ data: null, count: null, error: { code: "PGRST205", message: "not found" } }).then(res, rej),
      };
      return b;
    }
    return orig(t);
  };
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.holder.db = makeDb({ universities: [{ id: "u", name: "State U" }] }, []);
  stubRpcSpec(["/rpc/admin_audit_log"]);
  asFounder();
});

describe("getAdminSettings — safe status", () => {
  it("reports kill switches and the founder identity", async () => {
    const s = await getAdminSettings();
    expect(s.portalEnabled).toBe(true);
    expect(s.writesEnabled).toBe(true);
    expect(s.admin.userId).toBe(FOUNDER.id);
    expect(s.admin.email).toBe(FOUNDER.email);
    expect(s.admin.emailConsistency).toBe("enforced_consistent");
  });

  it("reports the MFA assurance state", async () => {
    const s = await getAdminSettings();
    expect(s.mfa.assuranceLevel).toBe("aal2");
    expect(s.mfa.meetsRequirement).toBe(true);
    expect(s.mfa.recentMfa).toBe(false); // no recent totp method
  });

  it("masks environment variables and never returns secret values", async () => {
    const s = await getAdminSettings();
    const svc = s.env.find((e) => e.name === "SUPABASE_SERVICE_ROLE_KEY");
    expect(svc?.present).toBe(true);
    expect(svc?.hint).toBe("set (hidden)");
    // The actual secret value must never appear anywhere in the payload.
    expect(JSON.stringify(s)).not.toContain(SECRET);
  });

  it("reports Supabase connectivity", async () => {
    const s = await getAdminSettings();
    expect(s.supabase.connected).toBe(true);
  });

  it("denies a non-founder", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: "x", email: "x@my.edu" } } });
    await expect(getAdminSettings()).rejects.toBeInstanceOf(SecureAdminError);
  });
});

describe("testSupabaseConnection", () => {
  it("succeeds against a reachable database", async () => {
    const res = await testSupabaseConnection();
    expect(res.ok).toBe(true);
  });

  it("denies a non-founder", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: "x", email: "x@my.edu" } } });
    await expect(testSupabaseConnection()).rejects.toBeInstanceOf(SecureAdminError);
  });
});


// ── Audit-persistence status accuracy (Day 10A UI correction) ───────────────
//
// The previous implementation hardcoded `auditPersistenceAvailable: false`, so
// Admin Settings said "Deferred" even after migrations 055/056 were live in
// Production. The old test asserted that `false` — it passed BECAUSE of the
// bug. These tests probe real behaviour instead.

describe("audit persistence status is probed, never hardcoded", () => {
  it("reports ACTIVE when the audit table and catalog exist, even with ZERO events", async () => {
    h.holder.db = dbWithAudit(0, 26);
    stubRpcSpec(["/rpc/admin_audit_log"]);
    const s = await getAdminSettings();
    expect(s.auditPersistence.status).toBe("active");
    // The exact Production state on release day: deployed, nothing recorded yet.
    expect(s.auditPersistence.detail).toMatch(/0 events recorded/);
  });

  it("an EMPTY audit table is not mistaken for missing infrastructure", async () => {
    h.holder.db = dbWithAudit(0, 26);
    const s = await getAdminSettings();
    expect(s.auditPersistence.status).not.toBe("unavailable");
    expect(s.auditPersistence.status).toBe("active");
  });

  it("reports ACTIVE with events present too", async () => {
    h.holder.db = dbWithAudit(7, 26);
    const s = await getAdminSettings();
    expect(s.auditPersistence.status).toBe("active");
    expect(s.auditPersistence.detail).toMatch(/7 events/);
  });

  it("reports UNAVAILABLE when the audit table is absent", async () => {
    h.holder.db = dbWithoutAudit();
    const s = await getAdminSettings();
    expect(s.auditPersistence.status).toBe("unavailable");
    expect(s.auditPersistence.detail).toMatch(/not deployed/i);
  });

  it("reports UNAVAILABLE when the catalog exists but is unseeded", async () => {
    h.holder.db = dbWithAudit(0, 0);
    const s = await getAdminSettings();
    expect(s.auditPersistence.status).toBe("unavailable");
    expect(s.auditPersistence.detail).toMatch(/unseeded/i);
  });

  it("reports UNAVAILABLE when the logging function is missing", async () => {
    h.holder.db = dbWithAudit(0, 26);
    stubRpcSpec([]); // admin_audit_log not exposed
    const s = await getAdminSettings();
    expect(s.auditPersistence.status).toBe("unavailable");
    expect(s.auditPersistence.detail).toMatch(/admin_audit_log/);
  });

  it("reports ERROR — never active — when the check itself fails", async () => {
    h.holder.db = dbWithAudit(0, 26);
    stubRpcSpec([], { throws: true });
    const s = await getAdminSettings();
    expect(s.auditPersistence.status).toBe("error");
    expect(s.auditPersistence.status).not.toBe("active");
  });

  it("reports ERROR on an unexpected database error, not ACTIVE", async () => {
    const db = makeDb({ universities: [{ id: "u", name: "State U" }] }, []);
    const orig = db.from;
    (db as any).from = (t: string) => {
      if (t === "admin_audit_events") {
        const b: any = {
          select: () => b,
          limit: () => Promise.resolve({ data: null, count: null, error: { code: "57014", message: "timeout" } }),
        };
        return b;
      }
      return orig(t);
    };
    h.holder.db = db;
    const s = await getAdminSettings();
    expect(s.auditPersistence.status).toBe("error");
  });

  it("is NOT derived from an environment variable", async () => {
    // Every admin env var present and enabled, but the infrastructure absent.
    h.holder.db = dbWithoutAudit();
    process.env.ADMIN_PORTAL_ENABLED = "true";
    process.env.ADMIN_WRITES_ENABLED = "true";
    const s = await getAdminSettings();
    expect(s.auditPersistence.status).toBe("unavailable");
  });

  it("performs NO insert, update, delete or truncate", async () => {
    const ops: string[] = [];
    const db = dbWithAudit(0, 26);
    const orig = db.from;
    (db as any).from = (t: string) => {
      const b = orig(t) as any;
      for (const op of ["insert", "update", "delete", "upsert"]) {
        b[op] = () => {
          ops.push(`${t}.${op}`);
          return b;
        };
      }
      return b;
    };
    h.holder.db = db;
    (db as any).rpc = vi.fn(async () => {
      ops.push("rpc");
      return { data: null, error: null };
    });
    await getAdminSettings();
    expect(ops).toEqual([]);
  });
});

describe("privacy backend status is probed, never hardcoded", () => {
  it("reports UNAVAILABLE while migration 051 is absent", async () => {
    h.holder.db = dbWithAudit(0, 26);
    const s = await getAdminSettings();
    expect(s.privacyBackend.status).toBe("unavailable");
    expect(s.privacyBackend.detail).toMatch(/051/);
  });
});

describe("deployed commit field", () => {
  it("shows the Git commit SHA from VERCEL_GIT_COMMIT_SHA, not a build id", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "1478358012345678deadbeef";
    process.env.VERCEL_GIT_COMMIT_REF = "main";
    h.holder.db = dbWithAudit(0, 26);
    const s = await getAdminSettings();
    expect(s.commit).toBe("14783580");
    expect(s.commitRef).toBe("main");
  });

  it("is null when Vercel does not supply one — never invented or hardcoded", async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_REF;
    h.holder.db = dbWithAudit(0, 26);
    const s = await getAdminSettings();
    expect(s.commit).toBeNull();
    expect(s.commitRef).toBeNull();
  });
});

describe("no secret ever leaves this module", () => {
  it("never returns an env VALUE, only presence and safe hints", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "1478358012345678deadbeef";
    h.holder.db = dbWithAudit(0, 26);
    const s = await getAdminSettings();
    const json = JSON.stringify(s);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(FOUNDER.id.slice(0, 8) + "-SECRET");
    // Presence booleans only.
    for (const e of s.env) expect(Object.keys(e)).toEqual(["name", "present", "hint"]);
  });
});
