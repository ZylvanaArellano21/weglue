import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const getUser = vi.fn();
  const rpc = vi.fn();
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { getUser, rpc, from, select, eq, maybeSingle };
});

vi.mock("../supabase/middleware", () => ({
  createMiddlewareClient: () => ({
    auth: { getUser: h.getUser },
    rpc: h.rpc,
    from: h.from,
  }),
}));

import { NextRequest } from "next/server";
import { middleware } from "../../middleware";

function request(pathname: string, cookie?: string): NextRequest {
  return new NextRequest(`https://weglue.app${pathname}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getUser.mockResolvedValue({ data: { user: null } });
  h.rpc.mockResolvedValue({ data: { state: "active" } });
  h.maybeSingle.mockResolvedValue({ data: { onboarding_completed: true } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("middleware Supabase fast paths", () => {
  it("does not create an auth dependency for an anonymous GET /", async () => {
    const response = await middleware(request("/"));

    expect(response.status).toBe(200);
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it("does not mistake unrelated cookies for a Supabase session", async () => {
    await middleware(request("/", "analytics_id=abc123"));

    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("validates a possible session on / so containment behavior is preserved", async () => {
    await middleware(request("/", "sb-project-auth-token=possible-session"));

    expect(h.getUser).toHaveBeenCalledTimes(1);
  });

  it.each([
    "/privacy-policy",
    "/terms",
    "/terms-of-service",
    "/child-safety-standards",
    "/delete-account",
  ])("bypasses Supabase for public route %s", async (pathname) => {
    await middleware(request(pathname, "sb-project-auth-token=possible-session"));

    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("still performs validated auth for a protected route", async () => {
    const response = await middleware(request("/home"));

    expect(h.getUser).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("https://weglue.app/login");
  });

  it("keeps access-state and onboarding checks on signed-in protected routes", async () => {
    h.getUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-1111-1111-111111111111",
          email_confirmed_at: "2026-09-22T00:00:00.000Z",
          app_metadata: {},
        },
      },
    });

    await middleware(request("/home", "sb-project-auth-token=possible-session"));

    expect(h.getUser).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("my_access_state");
    expect(h.from).toHaveBeenCalledWith("profiles");
    expect(h.select).toHaveBeenCalledWith("onboarding_completed");
  });

  it("does not run access-state on an exempt auth callback", async () => {
    h.getUser.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-1111-1111-111111111111",
          email_confirmed_at: "2026-09-22T00:00:00.000Z",
          app_metadata: {},
        },
      },
    });

    await middleware(request("/auth/reset-password"));

    expect(h.getUser).toHaveBeenCalledTimes(1);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([
    "/admin/users/11111111-1111-1111-1111-111111111111",
    "/wgx-entry/private",
    "/wgx-404/private",
  ])("redacts admin path %s from slow-request logs", async (pathname) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(1_000);

    await middleware(request(pathname));

    expect(warn).toHaveBeenCalledWith(
      "[MiddlewarePerf] total 1000ms pathname=[REDACTED_ADMIN_PATH]"
    );
    expect(warn.mock.calls.flat().join(" ")).not.toContain(pathname);
  });

  it.each(["/admin-private-entry-xyz", "/admin-private-entry-xyz/nested"])(
    "redacts configured private entry path %s from slow-request logs",
    async (pathname) => {
      const previousEntryPath = process.env.ADMIN_ENTRY_PATH;
      process.env.ADMIN_ENTRY_PATH = "/admin-private-entry-xyz";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(1_000);

      try {
        await middleware(request(pathname));
      } finally {
        if (previousEntryPath === undefined) delete process.env.ADMIN_ENTRY_PATH;
        else process.env.ADMIN_ENTRY_PATH = previousEntryPath;
      }

      expect(warn).toHaveBeenCalledWith(
        "[MiddlewarePerf] total 1000ms pathname=[REDACTED_ADMIN_PATH]"
      );
      expect(warn.mock.calls.flat().join(" ")).not.toContain("admin-private-entry-xyz");
    }
  );
});
