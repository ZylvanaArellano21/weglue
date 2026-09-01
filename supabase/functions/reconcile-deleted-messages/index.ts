// Day 10F deletion reconciliation and irreversible retention purge worker.
//
// Invocation is scheduler-only. It does not accept message/report IDs from the
// request; each work item is selected by a database lease and all externally
// visible results are content-free counters/error codes.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import { messageAttachmentPaths } from "../_shared/messageAttachmentPaths.ts";

const SECRET_HEADER = "x-weglue-message-privacy-secret";
const WORKER_LABEL = "deleted-message-reconciler";

type CleanupJob = {
  job_id: string;
  original_bucket: string;
  original_object_path: string;
  report_evidence_id: string | null;
  requires_evidence_copy: boolean;
  claim_token: string;
};

type EvidencePurge = {
  evidence_id: string;
  retained_bucket: string | null;
  retained_object_path: string | null;
  claim_token: string;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private" },
  });
}

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
  return code === "storage_transient" || /^storage_http_5/.test(code) || /^storage_http_429$/.test(code);
}

async function ensureObjectAbsent(admin: SupabaseClient, bucket: string, path: string): Promise<void> {
  const { error } = await admin.storage.from(bucket).download(path);
  if (!error) throw new Error("object_still_present");
  const status = (error as any).statusCode ?? (error as any).status;
  if (status === 404 || /not found|object not found/i.test(error.message)) return;
  throw error;
}

async function processCleanup(admin: SupabaseClient, job: CleanupJob): Promise<void> {
  let retainedPath: string | null = null;
  try {
    const cleanupPaths = await messageAttachmentPaths(admin, job.original_object_path);
    if (job.requires_evidence_copy) {
      if (!job.report_evidence_id) throw new Error("evidence_mapping_missing");
      // Deterministic key prevents duplicate files when a worker crashes after
      // copy but before database completion. No user-supplied filename is kept.
      retainedPath = `report-evidence/${job.report_evidence_id}/attachment`;
      const { data: source, error: sourceError } = await admin.storage.from(job.original_bucket).download(job.original_object_path);
      if (sourceError || !source) throw sourceError ?? new Error("source_download_failed");
      const { error: copyError } = await admin.storage.from("deleted-message-evidence").upload(retainedPath, source, {
        upsert: true,
        contentType: source.type || undefined,
      });
      if (copyError) throw copyError;
    }

    const { error: removeError } = await admin.storage.from(job.original_bucket).remove(cleanupPaths);
    if (removeError) throw removeError;
    for (const path of cleanupPaths) {
      await ensureObjectAbsent(admin, job.original_bucket, path);
    }

    const { error: completeError } = await admin.rpc("complete_message_attachment_cleanup", {
      p_job_id: job.job_id,
      p_claim_token: job.claim_token,
      p_retained_attachment_path: retainedPath,
    });
    if (completeError) throw completeError;
  } catch (error) {
    await admin.rpc("fail_message_attachment_cleanup", {
      p_job_id: job.job_id,
      p_claim_token: job.claim_token,
      p_error_code: safeErrorCode(error),
      p_retryable: retryable(error),
    });
    throw error;
  }
}

async function processEvidencePurge(admin: SupabaseClient, item: EvidencePurge): Promise<void> {
  try {
    if (item.retained_bucket && item.retained_object_path) {
      const { error: removeError } = await admin.storage.from(item.retained_bucket).remove([item.retained_object_path]);
      if (removeError) throw removeError;
      await ensureObjectAbsent(admin, item.retained_bucket, item.retained_object_path);
    }
    const { error: completeError } = await admin.rpc("complete_report_message_evidence_purge", {
      p_evidence_id: item.evidence_id,
      p_claim_token: item.claim_token,
    });
    if (completeError) throw completeError;
  } catch (error) {
    await admin.rpc("fail_report_message_evidence_purge", {
      p_evidence_id: item.evidence_id,
      p_claim_token: item.claim_token,
      p_error_code: safeErrorCode(error),
      p_retryable: retryable(error),
    });
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expectedSecret = Deno.env.get("MESSAGE_PRIVACY_WORKER_SECRET");
  if (!expectedSecret) {
    console.error(JSON.stringify({ tag: "message_privacy_worker", stage: "configuration", ok: false, error: "worker_secret_missing" }));
    return json({ error: "Worker is not configured" }, 503);
  }
  if (request.headers.get(SECRET_HEADER) !== expectedSecret) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Worker is not configured" }, 503);
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const workerId = `${WORKER_LABEL}:${crypto.randomUUID()}`;
  let attachmentsCompleted = 0;
  let attachmentsFailed = 0;
  let evidencePurged = 0;
  let evidenceFailed = 0;

  const { data: cleanupRows, error: cleanupClaimError } = await admin.rpc("claim_message_attachment_cleanup_jobs", {
    p_worker_id: workerId,
    p_limit: 10,
  });
  if (cleanupClaimError) {
    console.error(JSON.stringify({ tag: "message_privacy_worker", stage: "claim_cleanup", ok: false, error: safeErrorCode(cleanupClaimError) }));
    return json({ error: "Could not claim cleanup work" }, 500);
  }
  for (const job of (cleanupRows ?? []) as CleanupJob[]) {
    try {
      await processCleanup(admin, job);
      attachmentsCompleted += 1;
    } catch (error) {
      attachmentsFailed += 1;
      console.error(JSON.stringify({ tag: "message_privacy_worker", stage: "cleanup", ok: false, error: safeErrorCode(error) }));
    }
  }

  const { data: evidenceRows, error: evidenceClaimError } = await admin.rpc("claim_expired_report_message_evidence", {
    p_worker_id: workerId,
    p_limit: 10,
  });
  if (evidenceClaimError) {
    console.error(JSON.stringify({ tag: "message_privacy_worker", stage: "claim_evidence_purge", ok: false, error: safeErrorCode(evidenceClaimError) }));
    return json({ error: "Could not claim evidence purge work" }, 500);
  }
  for (const item of (evidenceRows ?? []) as EvidencePurge[]) {
    try {
      await processEvidencePurge(admin, item);
      evidencePurged += 1;
    } catch (error) {
      evidenceFailed += 1;
      console.error(JSON.stringify({ tag: "message_privacy_worker", stage: "purge_evidence", ok: false, error: safeErrorCode(error) }));
    }
  }

  const { data: metadataPurged, error: metadataError } = await admin.rpc("purge_expired_message_deletion_metadata", { p_limit: 100 });
  if (metadataError) {
    console.error(JSON.stringify({ tag: "message_privacy_worker", stage: "purge_metadata", ok: false, error: safeErrorCode(metadataError) }));
  }

  const ok = attachmentsFailed === 0 && evidenceFailed === 0 && !metadataError;
  console.info(JSON.stringify({ tag: "message_privacy_worker", ok, attachmentsCompleted, attachmentsFailed, evidencePurged, evidenceFailed, metadataPurged: metadataPurged ?? 0 }));
  return json({ ok, attachmentsCompleted, attachmentsFailed, evidencePurged, evidenceFailed, metadataPurged: metadataPurged ?? 0 }, ok ? 200 : 207);
});
