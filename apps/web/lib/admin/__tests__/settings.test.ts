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
  h.getAAL.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2", currentAuthenticationMethods: [] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.holder.db = makeDb({ universities: [{ id: "u", name: "State U" }] }, []);
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

  it("reflects deferred audit + privacy backend honestly", async () => {
    const s = await getAdminSettings();
    expect(s.auditPersistenceAvailable).toBe(false);
    expect(s.privacyBackendDeployed).toBe(false);
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
