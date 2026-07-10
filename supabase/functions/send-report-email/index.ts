// Emails the support inbox about a new content report.
//
// Called by the mobile app right after a row is inserted into `reports`.
// The report row is the source of truth — this email is a best-effort
// notification on top of it. If RESEND_API_KEY isn't configured (or the
// send fails), the function returns { sent: false } and the report stays
// safely in the table with status 'pending'.
//
// Env (Supabase function secrets):
//   SUPPORT_EMAIL    — recipient (defaults to the configured support inbox)
//   RESEND_API_KEY   — Resend API key; without it, email is skipped
//   REPORTS_FROM     — optional from address (defaults to Resend's onboarding sender)

import { createClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_SUPPORT_EMAIL = "zylvana.arellano.campos@gmail.com";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Missing authorization token" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);
  if (userError || !user) return json({ error: "Invalid session" }, 401);

  let reportId: string | null = null;
  try {
    const body = await req.json();
    reportId = typeof body?.reportId === "string" ? body.reportId : null;
  } catch {
    // fall through — missing body handled below
  }
  if (!reportId) return json({ error: "Missing reportId" }, 400);

  // Load the report server-side so the email always reflects the real row
  // (client-supplied fields can't be spoofed) and only the reporter's own
  // report can trigger a send.
  const { data: report, error: reportError } = await admin
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .eq("reporter_id", user.id)
    .maybeSingle();

  if (reportError || !report) return json({ error: "Report not found" }, 404);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const supportEmail = Deno.env.get("SUPPORT_EMAIL") ?? DEFAULT_SUPPORT_EMAIL;
  const fromAddress = Deno.env.get("REPORTS_FROM") ?? "We Glue Reports <onboarding@resend.dev>";

  if (!resendKey) {
    console.warn("[send-report-email] RESEND_API_KEY not set — report stored, email skipped");
    return json({ sent: false, reason: "email_not_configured" }, 200);
  }

  const lines = [
    `A new report was submitted in We Glue.`,
    ``,
    `Reporter username: @${report.reporter_username ?? "unknown"}`,
    `Reporter email:    ${report.reporter_email ?? "unknown"}`,
    `Reporter user id:  ${report.reporter_id}`,
    ``,
    `Entity type:  ${report.entity_type}`,
    `Entity id:    ${report.entity_id ?? "—"}`,
    `Entity name:  ${report.entity_name ?? "—"}`,
    `Club id:      ${report.club_id ?? "—"}`,
    `Reason:       ${report.reason ?? "—"}`,
    `Details:      ${report.details ?? "—"}`,
    ``,
    `Report id:    ${report.id}`,
    `Status:       ${report.status}`,
    `Created at:   ${report.created_at}`,
  ];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [supportEmail],
        subject: `[We Glue Report] ${report.entity_type}: ${report.entity_name ?? report.entity_id ?? ""}`,
        text: lines.join("\n"),
      }),
    });

    if (!res.ok) {
      console.error("[send-report-email] Resend error:", res.status, await res.text());
      return json({ sent: false, reason: "email_failed" }, 200);
    }
  } catch (e) {
    console.error("[send-report-email] Resend request threw:", e);
    return json({ sent: false, reason: "email_failed" }, 200);
  }

  return json({ sent: true }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
