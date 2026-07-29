import { NextResponse, type NextRequest } from "next/server";
import { revealMessageBody } from "../../../../lib/admin/messagingActions";
import { SecureAdminError } from "../../../../lib/admin/secureAdmin";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

/**
 * Reveal one currently-visible message body. The id arrives in the POST body
 * (never a URL / query string), authorization + fresh-MFA are enforced inside
 * revealMessageBody(), the response is explicitly non-cacheable, and message
 * content is never logged. A deleted message is denied by the action.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { messageId?: string };
    const result = await revealMessageBody(String(body.messageId ?? ""));
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof SecureAdminError) {
      return NextResponse.json({ ok: false, error: err.message, reason: err.reason }, { status: err.httpStatus, headers: NO_STORE });
    }
    return NextResponse.json({ ok: false, error: "Reveal failed." }, { status: 500, headers: NO_STORE });
  }
}
