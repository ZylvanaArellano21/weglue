// Day 10F sender / room-moderator message deletion entry point.
//
// The database transaction performs immediate canonical scrubbing. This
// endpoint deliberately returns only a coarse state: attachment paths, evidence
// presence, reconciliation details, and database errors are never client data.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" },
  });
}

type CleanupJob = {
  job_id: string;
  original_bucket: string;
  original_object_path: string;
  report_evidence_id: string | null;
  requires_evidence_copy: boolean;
  claim_token: string;
};

function safeErrorCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error ?? "operation_failed");
  const status = value.match(/(?:status|http)[^0-9]{0,8}(\d{3})/i)?.[1];
  if (status) return `storage_http_${status}`;
  if (/timeout|network|fetch failed|temporar/i.test(value)) return "storage_transient";
  if (/not found|404/i.test(value)) return "storage_not_found";
  return "storage_operation_failed";
}

function retryable(error: unknown): boolean {
  const code = safeErrorCode(error);
  return code === "storage_transient" || /^storage_http_5/.test(code) || code === "storage_http_429";
}

async function ensureObjectAbsent(admin: SupabaseClient, bucket: string, path: string): Promise<void> {
  const { error } = await admin.storage.from(bucket).download(path);
  if (!error) throw new Error("object_still_present");
  const status = (error as { statusCode?: number; status?: number }).statusCode ?? (error as { status?: number }).status;
  if (status === 404 || /not found|object not found/i.test(error.message)) return;
  throw error;
}

/**
 * The first deletion request attempts physical cleanup immediately. This is
 * intentionally the exact lease/complete/fail protocol used by the scheduled
 * reconciler, so a request retry and the background worker remain idempotent.
 */
async function processCleanup(admin: SupabaseClient, job: CleanupJob): Promise<boolean> {
  let retainedPath: string | null = null;
  try {
    if (job.requires_evidence_copy) {
      if (!job.report_evidence_id) throw new Error("evidence_mapping_missing");
      retainedPath = `report-evidence/${job.report_evidence_id}/attachment`;
      const { data: source, error: sourceError } = await admin.storage.from(job.original_bucket).download(job.original_object_path);
      if (sourceError || !source) throw sourceError ?? new Error("source_download_failed");
      const { error: copyError } = await admin.storage.from("deleted-message-evidence").upload(retainedPath, source, {
        upsert: true,
        contentType: source.type || undefined,
      });
      if (copyError) throw copyError;
    }
    const { error: removeError } = await admin.storage.from(job.original_bucket).remove([job.original_object_path]);
    if (removeError) throw removeError;
    await ensureObjectAbsent(admin, job.original_bucket, job.original_object_path);
    const { error: completeError } = await admin.rpc("complete_message_attachment_cleanup", {
      p_job_id: job.job_id,
      p_claim_token: job.claim_token,
      p_retained_attachment_path: retainedPath,
    });
    if (completeError) throw completeError;
    return true;
  } catch (error) {
    // A failed retry-state write is still safe: the short lease expires and the
    // reconciler can claim it. Never return a successful attachment cleanup.
    await admin.rpc("fail_message_attachment_cleanup", {
      p_job_id: job.job_id,
      p_claim_token: job.claim_token,
      p_error_code: safeErrorCode(error),
      p_retryable: retryable(error),
    });
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const auth = request.headers.get("Authorization") ?? "";
  if (!url || !anonKey || !serviceKey || !auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const token = auth.slice("Bearer ".length);
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await client.auth.getUser(token);
  if (!userData.user) return json({ error: "Unauthorized" }, 401);

  const input = (await request.json().catch(() => null)) as { messageId?: unknown; idempotencyKey?: unknown } | null;
  const messageId = typeof input?.messageId === "string" ? input.messageId : "";
  const idempotencyKey = typeof input?.idempotencyKey === "string" ? input.idempotencyKey : "";
  if (!UUID_RE.test(messageId) || !UUID_RE.test(idempotencyKey)) return json({ error: "Invalid request" }, 400);

  const { data, error } = await client.rpc("begin_message_deletion", {
    p_message_id: messageId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    // Deliberately do not pass Postgres messages through; they can distinguish
    // deleted, nonexistent, or unauthorized IDs and occasionally include SQL.
    const status = error.code === "42501" ? 403 : error.code === "28000" ? 401 : 409;
    return json({ error: status === 403 ? "Not permitted" : "Message is unavailable" }, status);
  }

  const state = typeof (data as any)?.state === "string" ? (data as any).state : "unavailable";
  if (state === "unavailable") return json({ state: "unavailable" }, 404);

  // Do not leave a remembered signed URL usable until the next scheduled run.
  // This service-role call learns the path only inside the server, and its
  // response is never returned to the student client.
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: claimed, error: claimError } = await admin.rpc("claim_message_attachment_cleanup_for_message", {
    p_worker_id: `delete-message:${crypto.randomUUID()}`,
    p_message_id: messageId,
  });
  if (!claimError && Array.isArray(claimed) && claimed.length > 0) {
    const complete = await processCleanup(admin, claimed[0] as CleanupJob);
    return json({ state: "deleted", attachmentCleanup: complete ? "complete" : "pending" }, complete ? 200 : 202);
  }
  // No job can mean a text-only message, a previously completed attempt, or a
  // concurrent worker holding the lease. The response remains intentionally
  // coarse and never claims completed attachment work unless this request did
  // it; clients refetch canonical message state either way.
  return json({ state: "deleted", attachmentCleanup: state === "deleted" ? "complete" : "pending" }, state === "deleted" ? 200 : 202);
});
