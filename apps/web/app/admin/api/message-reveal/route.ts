import { NextResponse, type NextRequest } from "next/server";
import { notFound } from "next/navigation";
import { revealMessageBody } from "../../../../lib/admin/messagingActions";
import { SecureAdminError } from "../../../../lib/admin/secureAdmin";
import { hasValidEntryTicket } from "../../../../lib/admin/entryTicket";

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
  // Private entry gateway: without a valid ticket this endpoint does not exist.
  // notFound() yields Next's ordinary 404 — no JSON, no error shape, no hint that
  // an administration API is here. Concealment only; the authorization chain
  // inside the called function is unchanged.
  if (!(await hasValidEntryTicket())) notFound();

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

/**
 * GET is not an operation here — this endpoint deliberately takes its input in the
 * POST body. Without this handler Next answers a GET with 405 Method Not Allowed,
 * and a 405 discloses that a route EXISTS at this path while any nonexistent path
 * returns 404. Answering 404 keeps the endpoint concealed either way.
 */
export async function GET(): Promise<never> {
  notFound();
}
