// Day 10B durable account deletion + transactional email worker.
//
// This endpoint is intentionally invoked only by the verified scheduler.  It
// holds no user session, accepts no target ID, and claims database jobs with a
// lease before it performs any work.  Every recipient/payload comes from the
// protected outbox; never from the request.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPPORT_EMAIL = "zylvana.arellano.campos@gmail.com";
const WORKER_HEADER = "x-weglue-worker-secret";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "worker_operation_failed";
  return message
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-token]")
    .slice(0, 240);
}

function emailFor(kind: string, payload: Record<string, unknown>): { subject: string; text: string } {
  const category = String(payload.violation_category ?? "Community Guidelines violation");
  const reason = String(payload.public_reason ?? "activity associated with your account violated the We Glue Community Guidelines");
  const date = payload.scheduled_deletion_at
    ? new Date(String(payload.scheduled_deletion_at)).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;

  switch (kind) {
    case "admin_deletion_scheduled":
      return {
        subject: "Your We Glue account is scheduled for deletion",
        text: `Your We Glue account is scheduled for permanent deletion on ${date ?? "the scheduled date"}.\n\nViolation: ${category}\nReason: ${reason}\n\nTo appeal this decision before the deletion date, contact ${SUPPORT_EMAIL} and include your We Glue username.`,
      };
    case "admin_deletion_cancelled":
      return {
        subject: "Your We Glue account deletion was cancelled",
        text: `The scheduled deletion of your We Glue account was cancelled. If you have questions, contact ${SUPPORT_EMAIL}.`,
      };
    case "admin_deletion_finalized":
      return {
        subject: "Your We Glue account has been permanently deleted",
        text: `Your We Glue account has been permanently deleted.\n\nViolation: ${category}\nReason: ${reason}\n\nTo appeal or ask questions, contact ${SUPPORT_EMAIL}.`,
      };
    case "voluntary_deletion_completed":
      return {
        subject: "Your We Glue account has been deleted",
        text: `Your We Glue account has been successfully deleted. If you did not expect this or have questions, contact ${SUPPORT_EMAIL}.`,
      };
    case "admin_report_resolution":
      return {
        subject: "A We Glue moderation decision affected your account or content",
        text: `A We Glue moderation decision was applied.\n\nCategory: ${category}\nExplanation: ${reason}\n\nIf you believe this was incorrect, contact ${SUPPORT_EMAIL}.`,
      };
    default:
      throw new Error("unknown_email_kind");
  }
}

async function sendResend(
  apiKey: string,
  from: string,
  recipient: string,
  kind: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  const email = emailFor(kind, payload);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      reply_to: SUPPORT_EMAIL,
      subject: email.subject,
      text: email.text,
    }),
  });
  if (!response.ok) {
    // Do not log Resend's response body: it may include recipient information.
    throw new Error(`resend_http_${response.status}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("ACCOUNT_DELETION_WORKER_SECRET");
  if (!expectedSecret) {
    console.error(JSON.stringify({ tag: "account_deletion_worker", stage: "configuration", ok: false, error: "worker_secret_missing" }));
    return json({ error: "Worker is not configured" }, 503);
  }
  if (req.headers.get(WORKER_HEADER) !== expectedSecret) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Worker is not configured" }, 503);
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const workerId = crypto.randomUUID();
  let deletionFinalized = 0;
  let deletionFailed = 0;
  let emailSent = 0;
  let emailFailed = 0;

  const { data: jobs, error: claimError } = await admin.rpc("claim_account_deletion_jobs", {
    p_worker_id: workerId,
    p_limit: 10,
  });
  if (claimError) {
    console.error(JSON.stringify({ tag: "account_deletion_worker", stage: "claim_deletions", ok: false, error: safeError(claimError) }));
    return json({ error: "Could not claim deletion work" }, 500);
  }
  for (const job of (jobs ?? []) as Array<{ job_id: string }>) {
    const { error } = await admin.rpc("finalize_claimed_account_deletion", { p_worker_id: workerId, p_job_id: job.job_id });
    if (error) {
      deletionFailed += 1;
      console.error(JSON.stringify({ tag: "account_deletion_worker", stage: "finalize_deletion", ok: false, error: safeError(error) }));
    } else {
      deletionFinalized += 1;
    }
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_TRANSACTIONAL_FROM");
  if (!resendKey || !from) {
    // The durable rows stay pending.  This is loudly visible and no account is
    // recreated or rolled back merely because email configuration is absent.
    console.error(JSON.stringify({ tag: "account_deletion_worker", stage: "email_configuration", ok: false, error: !resendKey ? "resend_key_missing" : "transactional_from_missing" }));
    return json({ deletionFinalized, deletionFailed, emailSent, emailFailed, emailConfiguration: "missing" }, 503);
  }

  const { data: messages, error: emailClaimError } = await admin.rpc("claim_transactional_email_outbox", {
    p_worker_id: workerId,
    p_limit: 25,
  });
  if (emailClaimError) {
    console.error(JSON.stringify({ tag: "account_deletion_worker", stage: "claim_email", ok: false, error: safeError(emailClaimError) }));
    return json({ deletionFinalized, deletionFailed, emailSent, emailFailed, error: "Could not claim email work" }, 500);
  }
  for (const row of (messages ?? []) as Array<{ outbox_id: string; kind: string; recipient_email: string; payload: Record<string, unknown>; idempotency_key: string }>) {
    try {
      await sendResend(resendKey, from, row.recipient_email, row.kind, row.payload ?? {}, row.idempotency_key);
      const { error } = await admin.rpc("complete_transactional_email_outbox", { p_worker_id: workerId, p_outbox_id: row.outbox_id, p_sent: true, p_error: null });
      if (error) throw error;
      await updateReportDelivery(admin, row.payload, row.outbox_id, "sent");
      emailSent += 1;
    } catch (error) {
      emailFailed += 1;
      const { error: completionError } = await admin.rpc("complete_transactional_email_outbox", {
        p_worker_id: workerId, p_outbox_id: row.outbox_id, p_sent: false, p_error: safeError(error),
      });
      await updateReportDelivery(admin, row.payload, row.outbox_id, "failed", safeError(error));
      console.error(JSON.stringify({ tag: "account_deletion_worker", stage: "deliver_email", ok: false, error: safeError(completionError ?? error) }));
    }
  }

  console.info(JSON.stringify({ tag: "account_deletion_worker", ok: deletionFailed === 0 && emailFailed === 0, deletionFinalized, deletionFailed, emailSent, emailFailed }));
  return json({ deletionFinalized, deletionFailed, emailSent, emailFailed });
});

async function updateReportDelivery(
  admin: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  outboxId: string,
  state: "sent" | "failed",
  lastError: string | null = null,
): Promise<void> {
  const decisionId = typeof payload.report_decision_id === "string" ? payload.report_decision_id : null;
  if (!decisionId) return;
  await admin.rpc("complete_report_notification_delivery", {
    p_decision_id: decisionId,
    p_outbox_id: outboxId,
    p_sent: state === "sent",
    p_error: lastError,
  });
}
