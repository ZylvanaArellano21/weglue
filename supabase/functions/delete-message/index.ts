// Day 10F sender / room-moderator message deletion entry point.
//
// The database transaction performs immediate canonical scrubbing. This
// endpoint deliberately returns only a coarse state: attachment paths, evidence
// presence, reconciliation details, and database errors are never client data.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { attachmentCleanupOutcomeWithoutLease } from "./cleanupOutcome.ts";
import { parseDeleteMessageRequest } from "./requestValidation.ts";

// Set per request so every response — including the error paths — carries the
// CORS headers. A response the browser cannot read is indistinguishable from a
// failure to the caller, which is how the web unsend appeared broken.
function json(body: Record<string, unknown>, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private", ...cors },
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

/**
 * Keep a promise running after the response has been written.
 *
 * Supabase's edge runtime exposes `EdgeRuntime.waitUntil` for exactly this: it
 * holds the isolate open until the promise settles, instead of tearing it down
 * the moment the handler returns. If it is ever unavailable the work is still
 * started — it simply loses the guarantee of finishing, which is safe here
 * because the cleanup job stays leased in the queue and the scheduled
 * reconciler retries anything left behind.
 */
function runInBackground(work: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  const settled = work.catch(() => {
    // Never surface cleanup detail; the queue and the reconciler own retries.
  });
  if (typeof runtime?.waitUntil === "function") runtime.waitUntil(settled);
}

Deno.serve(async (request) => {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const cors = corsHeaders(request.headers.get("Origin"));

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const auth = request.headers.get("Authorization") ?? "";
  if (!url || !anonKey || !serviceKey || !auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401, cors);

  const token = auth.slice("Bearer ".length);
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await client.auth.getUser(token);
  if (!userData.user) return json({ error: "Unauthorized" }, 401, cors);

  const deletionRequest = parseDeleteMessageRequest(await request.json().catch(() => null));
  if (!deletionRequest) return json({ error: "Invalid request" }, 400, cors);
  const { messageId, idempotencyKey } = deletionRequest;

  const { data, error } = await client.rpc("begin_message_deletion", {
    p_message_id: messageId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    // Deliberately do not pass Postgres messages through; they can distinguish
    // deleted, nonexistent, or unauthorized IDs and occasionally include SQL.
    const status = error.code === "42501" ? 403 : error.code === "28000" ? 401 : 409;
    return json({ error: status === 403 ? "Not permitted" : "Message is unavailable" }, status, cors);
  }

  const state = typeof (data as any)?.state === "string" ? (data as any).state : "unavailable";
  if (state === "unavailable") return json({ state: "unavailable" }, 404, cors);

  // ── Bug 1: the response is no longer gated on storage I/O ──────────────────
  //
  // `begin_message_deletion` has COMMITTED by this point. That transaction is
  // what actually unsends the message: the row is redacted and RLS stops
  // returning it to every participant on both platforms. Nothing below changes
  // whether the message is gone — it only removes the stored bytes.
  //
  // Previously all of that ran before the response was written, so the caller
  // waited on, in order: a cleanup-claim RPC, a full download of the original
  // object, an optional re-upload of an evidence copy into a second bucket, a
  // remove, and then ANOTHER download purely to prove the object 404s. On a
  // photo or a video that is seconds of transfer, which is exactly why unsend
  // felt slow and why attachments felt far slower than text.
  //
  // A message with no attachment now does no storage work at all, and one with
  // an attachment hands the cleanup to `EdgeRuntime.waitUntil` — the isolate is
  // kept alive to finish it, so physical removal still begins immediately
  // rather than waiting for the next scheduled run. `reconcile-deleted-messages`
  // remains the safety net: the lease/complete/fail protocol is unchanged and
  // idempotent, so a cold start, a redeploy or a failure mid-cleanup is still
  // picked up and retried.
  if (state === "deleted") {
    // The RPC returns `deleted` only when the message had no attachment_url, so
    // there is provably nothing to clean up. The helper stays the single place
    // that decides when "complete" may be claimed.
    const outcome = attachmentCleanupOutcomeWithoutLease(state, false);
    return json({ state: "deleted", attachmentCleanup: outcome.attachmentCleanup }, outcome.status, cors);
  }

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const cleanup = (async () => {
    const { data: claimed, error: claimError } = await admin.rpc("claim_message_attachment_cleanup_for_message", {
      p_worker_id: `delete-message:${crypto.randomUUID()}`,
      p_message_id: messageId,
    });
    // A failed or empty claim is never treated as success — the job stays in the
    // queue for the reconciler. This mirrors the previous no-lease reasoning.
    if (claimError || !Array.isArray(claimed) || claimed.length === 0) return;
    await processCleanup(admin, claimed[0] as CleanupJob);
  })();

  runInBackground(cleanup);

  // 202: the unsend itself is done and durable; only the byte cleanup is still
  // in flight. The student client does not read this body — it treats any
  // non-error response as "the message is gone", which it now is.
  return json({ state: "deleted", attachmentCleanup: "pending" }, 202, cors);
});
