import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { checkPublicRateLimit } from "../../../lib/security/publicRateLimit";

function requestKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

// Public endpoint — no auth required.
// Inserts a row into deletion_requests and sends a notification email.
export async function POST(request: NextRequest) {
  const limit = checkPublicRateLimit(requestKey(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: { email?: string; reason?: string | null };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : null;

  // This endpoint only creates a request row. Use the normal server client so
  // a browser cannot turn this public form into a service-role capability.
  const supabase = createClient();

  // Insert deletion request
  const { error: insertError } = await supabase
    .from("deletion_requests")
    .insert({
      email,
      reason: reason || null,
    });

  if (insertError) {
    console.error("[delete-account-request] insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to record deletion request. Please try again." },
      { status: 500 },
    );
  }

  // Keep operational logging free of submitted PII. Notification delivery is
  // intentionally a separate follow-up integration, not a service-role side
  // effect of this public endpoint.
  console.log("[delete-account-request] request recorded");

  return NextResponse.json({ success: true }, { status: 200 });
}
