import { NextResponse, type NextRequest } from "next/server";
import { searchMessageContent } from "../../../../lib/admin/messagingActions";
import { SecureAdminError } from "../../../../lib/admin/secureAdmin";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

/**
 * Active-message content search. The query arrives in the POST body (never a URL
 * / query string, so search terms never land in access logs or history),
 * authorization + fresh-MFA + a minimum length + a server-side result cap are
 * enforced inside searchMessageContent(). Deleted content is never returned and
 * neither the term nor matched content is logged.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { q?: string };
    const result = await searchMessageContent(String(body.q ?? ""));
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof SecureAdminError) {
      return NextResponse.json({ ok: false, error: err.message, reason: err.reason }, { status: err.httpStatus, headers: NO_STORE });
    }
    return NextResponse.json({ ok: false, error: "Search failed." }, { status: 500, headers: NO_STORE });
  }
}
