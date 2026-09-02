import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Club QR route security — /club/{id}?source=qr
// ============================================================================
//
// The middleware lets an UNAUTHENTICATED `/club/*?source=qr` request through
// instead of redirecting it to /login, so a scanned club QR can reach the club
// page's own store-bounce when the app isn't installed. This pins the security
// contract at the middleware boundary for a signed-out visitor:
//
//   • the ONLY unauthenticated request the `?source=qr` marker lets past the
//     /login gate is a `/club/*` path — every other protected route still
//     bounces to /login even with the marker;
//   • the marker is matched exactly (`source=qr`), so a spoofed value cannot
//     widen the exception;
//   • when it IS let through, the club page never renders an authenticated
//     shell — `apps/web/app/club/[clubId]/page.tsx` redirects a signed-out
//     visitor to a store or /login and reads no club/member/chat data
//     (asserted by lib/__tests__ + covered by the page's own early returns).
// ============================================================================

const getUser = vi.fn(async () => ({ data: { user: null as { id: string } | null } }));

vi.mock("../supabase/middleware", () => ({
  createMiddlewareClient: () => ({ auth: { getUser } }),
}));

import { NextRequest } from "next/server";
import { middleware } from "../../middleware";

function req(path: string): NextRequest {
  return new NextRequest(`https://weglue.app${path}`, {
    headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)" },
  });
}

async function location(path: string): Promise<string | null> {
  const res = await middleware(req(path));
  return res?.headers.get("location") ?? null;
}

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: null } });
});

describe("unauthenticated: /login gate", () => {
  it("/club/<id> WITHOUT ?source=qr is redirected to /login", async () => {
    expect(await location("/club/11111111-1111-1111-1111-111111111111")).toMatch(
      /\/login$/
    );
  });

  it("/club/<id>?source=qr is NOT redirected to /login (page handles the bounce)", async () => {
    const loc = await location("/club/11111111-1111-1111-1111-111111111111?source=qr");
    expect(loc === null || !loc.includes("/login")).toBe(true);
  });

  it("?source=qr does NOT bypass /login on any non-club protected route", async () => {
    expect(await location("/messages?source=qr")).toMatch(/\/login$/);
    expect(await location("/home?source=qr")).toMatch(/\/login$/);
    expect(await location("/profile?source=qr")).toMatch(/\/login$/);
    expect(await location("/settings/blocked?source=qr")).toMatch(/\/login$/);
  });

  it("a spoofed source value does not widen the exception", async () => {
    expect(await location("/club/abc?source=QR")).toMatch(/\/login$/);
    expect(await location("/club/abc?source=qr%20")).toMatch(/\/login$/);
    expect(await location("/club/abc?source=x")).toMatch(/\/login$/);
    expect(await location("/club/abc?source=")).toMatch(/\/login$/);
    expect(await location("/club/abc")).toMatch(/\/login$/);
  });
});
