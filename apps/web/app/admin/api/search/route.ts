import { NextResponse, type NextRequest } from "next/server";
import { notFound } from "next/navigation";
import { searchEntities } from "../../../../lib/admin/data";
import { SecureAdminError } from "../../../../lib/admin/secureAdmin";
import { hasValidEntryTicket } from "../../../../lib/admin/entryTicket";

export const dynamic = "force-dynamic";

/**
 * Secure-admin-gated global search endpoint. Authorization is enforced inside
 * searchEntities() → requireSecureAdmin() (portal + allowlist + aal2 MFA). A
 * non-founder, aal1, unauthenticated, or portal-off caller receives 401/403 and
 * never any admin data. Responses are explicitly non-cacheable.
 */
export async function GET(request: NextRequest) {
  // Private entry gateway: without a valid ticket this endpoint does not exist.
  // notFound() yields Next's ordinary 404 — no JSON, no error shape, no hint that
  // an administration API is here. Concealment only; the authorization chain
  // inside the called function is unchanged.
  if (!(await hasValidEntryTicket())) notFound();

  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const results = await searchEntities(q);
    return NextResponse.json(results, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    if (err instanceof SecureAdminError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.httpStatus, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
