// Emails the support inbox about a new content report.
//
// Called by the mobile app right after a row is inserted into `reports`.
// The report row is the source of truth — this email is a best-effort
// notification on top of it. The function is idempotent: a report whose
// email already went out (email_sent_at set) is never re-sent, so rapid
// repeated taps / client retries cannot produce duplicate emails. Send
// failures are recorded on the row (email_error) so they can be retried
// and audited, and the structured JSON result lets the app show a
// truthful state instead of a false success.
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

  // Idempotency: one email per report, ever. Retries and duplicate
  // invocations return success without contacting Resend again.
  if (report.email_sent_at) {
    return json({ sent: true, deduped: true }, 200);
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const supportEmail = Deno.env.get("SUPPORT_EMAIL") ?? DEFAULT_SUPPORT_EMAIL;
  const fromAddress = Deno.env.get("REPORTS_FROM") ?? "We Glue Reports <onboarding@resend.dev>";

  if (!resendKey) {
    console.warn("[send-report-email] RESEND_API_KEY not set — report stored, email skipped");
    await recordEmailError(admin, reportId, "RESEND_API_KEY not configured");
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

  // Message reports carry a tamper-proof moderation snapshot. Only the storage
  // PATH is included — never a signed URL — so the email leaks no direct media
  // access. Investigators open the report row (RLS-protected) to view content.
  if (report.entity_type === "message") {
    const att = report.attachment_snapshot as
      | { name?: string; mime?: string; size?: number; url?: string }
      | null;
    lines.push(
      ``,
      `── Message snapshot ──`,
      `Conversation id:   ${report.conversation_id ?? "—"}`,
      `Conversation type: ${report.conversation_type ?? "—"}`,
      `Message id:        ${report.message_id ?? "—"}`,
      `Message type:      ${report.message_type ?? "—"}`,
      `Sender user id:    ${report.message_sender_id ?? "—"}`,
      `Content snapshot:  ${report.content_snapshot ?? "—"}`,
      `Attachment:        ${
        att ? `${att.name ?? "file"} (${att.mime ?? "?"}, path: ${att.url ?? "?"})` : "—"
      }`,
    );
  }

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
      // Resend's error body has no secrets — safe to persist for retry/audit.
      const errText = (await res.text()).slice(0, 500);
      console.error("[send-report-email] Resend error:", res.status, errText);
      await recordEmailError(admin, reportId, `Resend ${res.status}: ${errText}`);
      return json(
        { sent: false, reason: "email_failed", resendStatus: res.status, resendError: errText },
        200,
      );
    }

    const resendBody = await res.json().catch(() => null);
    await admin
      .from("reports")
      .update({ email_sent_at: new Date().toISOString(), email_error: null })
      .eq("id", reportId);

    return json({ sent: true, resendId: resendBody?.id ?? null }, 200);
  } catch (e) {
    console.error("[send-report-email] Resend request threw:", e);
    await recordEmailError(admin, reportId, `Request failed: ${String(e).slice(0, 300)}`);
    return json({ sent: false, reason: "email_failed" }, 200);
  }
});

async function recordEmailError(
  admin: ReturnType<typeof createClient>,
  reportId: string,
  message: string,
): Promise<void> {
  try {
    await admin.from("reports").update({ email_error: message }).eq("id", reportId);
  } catch {
    // bookkeeping only — never fail the request over it
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
