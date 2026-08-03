import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireSecureAdmin: vi.fn(async () => ({ id: "founder" })),
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
  lifecycleRows: [] as any[],
  lifecycleError: null as any,
  profileCalls: 0,
}));

function response(table: string) {
  if (table === "admin_content_lifecycle_records") {
    return { data: h.lifecycleRows, error: h.lifecycleError, count: h.lifecycleRows.length };
  }
  if (table === "profiles") {
    h.profileCalls += 1;
    if (h.profileCalls <= 2) return { data: [{ id: "00000000-0000-4000-8000-000000000001" }], error: null };
    return {
      data: [{ id: "00000000-0000-4000-8000-000000000001", full_name: "Creator One", username: "creator", avatar_url: null }],
      error: null,
    };
  }
  return { data: [], error: null, count: 0 };
}

function query(table: string) {
  const chain: any = {
    select(...args: unknown[]) { h.calls.push({ table, method: "select", args }); return chain; },
    eq(...args: unknown[]) { h.calls.push({ table, method: "eq", args }); return chain; },
    not(...args: unknown[]) { h.calls.push({ table, method: "not", args }); return chain; },
    is(...args: unknown[]) { h.calls.push({ table, method: "is", args }); return chain; },
    in(...args: unknown[]) { h.calls.push({ table, method: "in", args }); return chain; },
    ilike(...args: unknown[]) { h.calls.push({ table, method: "ilike", args }); return chain; },
    or(...args: unknown[]) { h.calls.push({ table, method: "or", args }); return chain; },
    order(...args: unknown[]) { h.calls.push({ table, method: "order", args }); return chain; },
    range(...args: unknown[]) { h.calls.push({ table, method: "range", args }); return chain; },
    limit(...args: unknown[]) { h.calls.push({ table, method: "limit", args }); return chain; },
    maybeSingle() { return Promise.resolve(response(table)); },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(response(table)).then(resolve, reject);
    },
  };
  return chain;
}

vi.mock("../../supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => query(table) }) }));
vi.mock("../secureAdmin", () => ({ requireSecureAdmin: h.requireSecureAdmin }));

import { listContentLifecycle } from "../lifecycleData";

const POST = "00000000-0000-4000-8000-000000000010";

beforeEach(() => {
  h.calls.length = 0;
  h.profileCalls = 0;
  h.lifecycleError = null;
  h.lifecycleRows = [{
    entity_type: "post",
    entity_id: POST,
    owner_id: "00000000-0000-4000-8000-000000000001",
    club_id: null,
    content_created_at: "2026-01-01T00:00:00.000Z",
    state: "active",
    removed_at: "2026-01-02T00:00:00.000Z",
    removed_by: "00000000-0000-4000-8000-000000000099",
    removal_correlation_id: "00000000-0000-4000-8000-000000000098",
    restored_at: "2026-01-03T00:00:00.000Z",
    restored_by: "00000000-0000-4000-8000-000000000099",
    restoration_correlation_id: "00000000-0000-4000-8000-000000000097",
    creator_deleted_at: null,
    purge_requested_at: null,
    purge_completed_at: null,
    lifecycle_updated_at: "2026-01-03T00:00:00.000Z",
  }];
});

describe("Day 10C lifecycle dashboard data", () => {
  it("filters restored content as active with a restoration marker", async () => {
    const result = await listContentLifecycle({ entityType: "post", status: "restored" });
    expect(result.available).toBe(true);
    expect(result.data.rows[0]?.displayStatus).toBe("restored");
    expect(h.calls).toContainEqual({ table: "admin_content_lifecycle_records", method: "eq", args: ["entity_type", "post"] });
    expect(h.calls).toContainEqual({ table: "admin_content_lifecycle_records", method: "eq", args: ["state", "active"] });
    expect(h.calls).toContainEqual({ table: "admin_content_lifecycle_records", method: "not", args: ["restored_at", "is", null] });
  });

  it("searches creator names through typed profile filters, never a raw PostgREST or expression", async () => {
    await listContentLifecycle({ search: "creator,()" });
    expect(h.calls).toContainEqual({ table: "profiles", method: "ilike", args: ["full_name", "%creator,()%"] });
    expect(h.calls).toContainEqual({ table: "profiles", method: "ilike", args: ["username", "%creator,()%"] });
    expect(h.calls).toContainEqual({
      table: "admin_content_lifecycle_records",
      method: "in",
      args: ["owner_id", ["00000000-0000-4000-8000-000000000001"]],
    });
    expect(h.calls.some((call) => call.table === "admin_content_lifecycle_records" && call.method === "or")).toBe(false);
  });

  it("accepts a full UUID content ID as the narrow entity/creator search", async () => {
    await listContentLifecycle({ search: POST });
    expect(h.calls).toContainEqual({
      table: "admin_content_lifecycle_records",
      method: "or",
      args: [`entity_id.eq.${POST},owner_id.eq.${POST}`],
    });
  });

  it("reports a missing migration honestly instead of inventing active state", async () => {
    h.lifecycleError = { code: "PGRST205" };
    const result = await listContentLifecycle();
    expect(result.available).toBe(false);
    expect(result.message).toMatch(/migration 063/i);
    expect(result.data.rows).toEqual([]);
  });
});
