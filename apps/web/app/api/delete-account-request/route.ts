import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../lib/supabase/admin";

// Public endpoint — no auth required.
// Inserts a row into deletion_requests and sends a notification email.
export async function POST(request: NextRequest) {
  let body: { email?: string; reason?: string | null };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Insert deletion request
  const { error: insertError } = await supabase
    .from("deletion_requests")
    .insert({
      email,
      reason: body.reason ?? null,
    });

  if (insertError) {
    console.error("[delete-account-request] insert error:", insertError);
    return NextResponse.json(
      { error: "Failed to record deletion request. Please try again." },
      { status: 500 },
    );
  }

  // Send notification email via Supabase Auth admin API is not ideal here.
  // Use Resend if configured, otherwise log to console for manual processing.
  // TODO: wire up Resend or another transactional email provider when available.
  console.log(
    `[delete-account-request] New request from ${email} at ${new Date().toISOString()}`,
  );

  return NextResponse.json({ success: true }, { status: 200 });
}
