import { NextResponse, type NextRequest } from "next/server";
import { searchEntities } from "../../../../lib/admin/data";
import { FounderAuthError } from "../../../../lib/admin/founder";

export const dynamic = "force-dynamic";

/**
 * Founder-gated global search endpoint. Authorization is enforced inside
 * searchEntities() → requireFounder(); a non-founder or unauthenticated caller
 * receives 403/401 and never any admin data.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const results = await searchEntities(q);
    return NextResponse.json(results);
  } catch (err) {
    if (err instanceof FounderAuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status === "unauthenticated" ? 401 : 403 }
      );
    }
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
