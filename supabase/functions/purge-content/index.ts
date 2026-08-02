// Executes the durable, resumable permanent purge of posts, comments and
// events that an administrator has already REQUESTED (Day 10C, migration 061).
//
// Invoked on a schedule by pg_cron → pg_net, exactly like send-push. Auth: the
// caller must present the PURGE_DISPATCH_SECRET bearer (Vault for the cron job,
// function secrets here). This endpoint is NEVER called by a client, and it can
// never START a purge — it only carries out one a human already authorized.
//
// THE INVARIANT THIS FILE EXISTS TO PROTECT:
//   content is HIDDEN FIRST and destroyed second, and it is never reported as
//   purged unless it actually is.
// So every failure path leaves the content hidden and retryable, and the
// terminal `purged` state is written by ONE database function that refuses to
// run while any uniquely-owned Storage object is still undeleted.
//
// ONE ITEM, IN ORDER:
//   1. claim         — content_purge_claim_batch (FOR UPDATE SKIP LOCKED, so two
//                      concurrent runs can never process the same item).
//   2. enumerate     — content_purge_pending_objects. Paths come from SECURED
//                      DATABASE STATE captured at request time, never from a
//                      URL supplied by a caller and never re-derived here.
//   3. audit attempt — before touching Storage, so a crash mid-delete is still
//                      visible in the audit trail.
//   4. delete        — Storage removal, per bucket, per object.
//   5. record        — content_purge_record_object per object. 'not_found'
//                      CONVERGES to deleted: the goal state is "the object is
//                      gone", and it is gone.
//   6. audit outcome — success or failure, with COUNTS only.
//   7. finalize      — content_purge_finalize redacts the payload, deletes
//                      dependents and marks `purged`, all in one transaction.
//   8. failure       — content_purge_mark_failed on any storage or finalize
//                      failure: state becomes `purge_failed`, retryable by an
//                      administrator, and the content STAYS HIDDEN.
//   9. reconcile     — if the OUTCOME ITSELF cannot be persisted,
//                      content_purge_mark_reconciliation records durable work
//                      for a human. Nothing is ever silently marked complete.
//  10. report        — honest counts back to the caller.
//
// IDEMPOTENCY: every step is safe to repeat. Re-running after a lost response
// re-claims nothing already `purged`, re-deletes nothing already deleted, and
// finalize on an already-purged row is a no-op that says so.
//
// PUBLIC-BUCKET HONESTY: the `posts` bucket is PUBLIC. Deleting an object stops
// it being served from that path, but any copy already downloaded, cached by a
// CDN edge, or saved by a student is beyond this system's reach. Nothing here
// claims otherwise, and no audit row asserts more than "the object was deleted
// from the bucket".
//
// Env (Supabase function secrets):
//   PURGE_DISPATCH_SECRET — shared bearer secret with the cron job (required)

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_BATCH = 10;

// After this many claims an item stops being retried automatically and is
// parked in `purge_failed` for a human. Without a cap a permanently broken item
// would be re-claimed on every run forever, burning the batch slot that healthy
// work needs. An administrator can still retry it explicitly.
const MAX_ATTEMPTS = 5;

/** The service account identity recorded as the ACTOR for worker-side audit rows. */
const WORKER_ACTOR_EMAIL = "purge-worker@weglue.app";

type ClaimRow = {
  lifecycle_id: string;
  entity_type: "post" | "comment" | "event";
  entity_id: string;
  correlation_id: string;
  attempts: number;
};

type ObjectRow = { object_id: string; bucket: string; object_path: string };

/** Controlled vocabulary — content_purge_record_object rejects anything else. */
type ObjectFailure = "not_found" | "denied" | "unreachable" | "unknown";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("PURGE_DISPATCH_SECRET");
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!secret || !bearer || bearer !== secret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const result = await runBatch(admin);
  return json({ ok: true, ...result });
});

async function runBatch(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("content_purge_claim_batch", {
    p_limit: DEFAULT_BATCH,
  });
  if (error) {
    // Nothing was claimed, so nothing is half-done. Report it and stop.
    console.error("content_purge_claim_batch failed:", error.message);
    return { claimed: 0, purged: 0, failed: 0, reconciliation: 0 };
  }

  const rows = (data ?? []) as ClaimRow[];
  let purged = 0;
  let failed = 0;
  let reconciliation = 0;

  for (const row of rows) {
    // One item's unexpected failure must never abandon the rest of the batch,
    // and must never be swallowed either: it is logged and counted as failed,
    // which leaves that item hidden and retryable.
    let outcome: "purged" | "failed" | "reconciliation";
    try {
      outcome = await purgeOne(admin, row);
    } catch (err) {
      console.error("purge item threw:", err instanceof Error ? err.message : String(err), {
        entityType: row.entity_type,
        entityId: row.entity_id,
        correlationId: row.correlation_id,
      });
      outcome = "failed";
    }
    if (outcome === "purged") purged += 1;
    else if (outcome === "reconciliation") reconciliation += 1;
    else failed += 1;
  }

  return { claimed: rows.length, purged, failed, reconciliation };
}

async function purgeOne(
  admin: SupabaseClient,
  row: ClaimRow,
): Promise<"purged" | "failed" | "reconciliation"> {
  const actorId = await workerActorId(admin, row);

  if (row.attempts > MAX_ATTEMPTS) {
    return markFailed(admin, row, actorId, "max_attempts_exceeded");
  }

  // ── 2. Enumerate from secured database state ──────────────────────────────
  const { data: objectData, error: objectError } = await admin.rpc(
    "content_purge_pending_objects",
    { p_lifecycle_id: row.lifecycle_id },
  );
  if (objectError) {
    return markFailed(admin, row, actorId, "storage_enumerate_failed");
  }
  const objects = (objectData ?? []) as ObjectRow[];

  // ── 3. Audit the ATTEMPT before touching Storage ──────────────────────────
  await auditStorage(admin, row, actorId, "attempt", objects.length, null);

  // ── 4/5. Delete, and record each object's real outcome ────────────────────
  let anyObjectFailed = false;
  for (const object of objects) {
    const failure = await deleteObject(admin, object);
    const { error: recordError } = await admin.rpc("content_purge_record_object", {
      p_object_id: object.object_id,
      // 'not_found' converges to deleted: the object is gone, which is the goal.
      p_deleted: failure === null,
      p_failure_code: failure,
    });
    if (recordError) {
      // The DELETION may have happened but we could not write it down. That is
      // exactly the reconciliation case: never claim completion.
      console.error("content_purge_record_object failed:", recordError.message);
      return markReconciliation(admin, row, actorId, "object_outcome_persist_failed");
    }
    if (failure !== null && failure !== "not_found") anyObjectFailed = true;
  }

  // ── 6. Audit the storage outcome (COUNTS only — never a path or a URL) ────
  await auditStorage(
    admin,
    row,
    actorId,
    anyObjectFailed ? "failure" : "success",
    objects.length,
    anyObjectFailed ? "storage_delete_failed" : null,
  );

  if (anyObjectFailed) {
    return markFailed(admin, row, actorId, "storage_delete_failed");
  }

  // ── 7. Finalize: redact, delete dependents, mark purged — one transaction ─
  const { data: finalData, error: finalError } = await admin.rpc("content_purge_finalize", {
    p_actor_id: actorId,
    p_actor_email: WORKER_ACTOR_EMAIL,
    p_correlation_id: row.correlation_id,
    p_entity_type: row.entity_type,
    p_entity_id: row.entity_id,
  });

  if (finalError) {
    // Storage is already gone but the database outcome did not commit. The
    // content must NOT be reported as purged — that is a reconciliation, not a
    // retryable failure, because the two halves have diverged.
    console.error("content_purge_finalize failed:", finalError.message);
    return markReconciliation(admin, row, actorId, "finalize_failed");
  }

  const status = (finalData as { status?: string } | null)?.status;
  if (status !== "ok") {
    return markFailed(admin, row, actorId, "finalize_rejected");
  }

  return "purged";
}

/**
 * Delete ONE object. Returns null on success, or the controlled failure code.
 *
 * Supabase Storage `remove` reports a missing object as a per-file error rather
 * than throwing, so a genuinely-absent object is classified as `not_found` and
 * converges to deleted rather than blocking the purge forever.
 */
async function deleteObject(
  admin: SupabaseClient,
  object: ObjectRow,
): Promise<ObjectFailure | null> {
  try {
    const { data, error } = await admin.storage.from(object.bucket).remove([object.object_path]);
    if (error) return classifyStorageError(error.message);
    // An empty result means Storage removed nothing — the object was not there.
    if (!data || data.length === 0) return "not_found";
    return null;
  } catch (err) {
    console.error("storage remove threw:", err instanceof Error ? err.message : String(err));
    return "unreachable";
  }
}

function classifyStorageError(message: string): ObjectFailure {
  const text = message.toLowerCase();
  if (text.includes("not found") || text.includes("does not exist")) return "not_found";
  if (text.includes("unauthorized") || text.includes("forbidden") || text.includes("denied")) {
    return "denied";
  }
  if (text.includes("network") || text.includes("timeout") || text.includes("fetch")) {
    return "unreachable";
  }
  return "unknown";
}

async function auditStorage(
  admin: SupabaseClient,
  row: ClaimRow,
  actorId: string,
  phase: "attempt" | "success" | "failure",
  count: number,
  failureCode: string | null,
): Promise<void> {
  const { error } = await admin.rpc("content_purge_audit_storage", {
    p_actor_id: actorId,
    p_actor_email: WORKER_ACTOR_EMAIL,
    p_correlation_id: row.correlation_id,
    p_entity_id: row.entity_id,
    p_phase: phase,
    p_object_count: count,
    p_failure_code: failureCode,
  });
  // An audit write that fails must be LOUD in the logs, but it must not stop
  // the purge: the lifecycle row is the durable record either way, and the
  // finalize step refuses to complete if anything is genuinely unfinished.
  if (error) console.error(`content_purge_audit_storage(${phase}) failed:`, error.message);
}

async function markFailed(
  admin: SupabaseClient,
  row: ClaimRow,
  actorId: string,
  code: string,
): Promise<"failed" | "reconciliation"> {
  const { error } = await admin.rpc("content_purge_mark_failed", {
    p_actor_id: actorId,
    p_actor_email: WORKER_ACTOR_EMAIL,
    p_correlation_id: row.correlation_id,
    p_entity_type: row.entity_type,
    p_entity_id: row.entity_id,
    p_failure_code: code,
  });
  if (error) {
    console.error("content_purge_mark_failed failed:", error.message);
    return markReconciliation(admin, row, actorId, "failure_persist_failed");
  }
  return "failed";
}

async function markReconciliation(
  admin: SupabaseClient,
  row: ClaimRow,
  actorId: string,
  code: string,
): Promise<"reconciliation"> {
  const { error } = await admin.rpc("content_purge_mark_reconciliation", {
    p_actor_id: actorId,
    p_actor_email: WORKER_ACTOR_EMAIL,
    p_correlation_id: row.correlation_id,
    p_entity_type: row.entity_type,
    p_entity_id: row.entity_id,
    p_failure_code: code,
  });
  if (error) {
    // Last resort: the loudest signal available. The content is still hidden
    // and still not marked purged, which is the state that matters.
    console.error("content_purge_mark_reconciliation failed:", error.message, {
      entityType: row.entity_type,
      entityId: row.entity_id,
      correlationId: row.correlation_id,
    });
  }
  return "reconciliation";
}

/**
 * The actor recorded for worker-side audit rows is the administrator who
 * REQUESTED the purge — read from the lifecycle row, not invented here, so the
 * whole request → completion chain names one accountable human.
 */
async function workerActorId(admin: SupabaseClient, row: ClaimRow): Promise<string> {
  const { data, error } = await admin
    .from("content_lifecycle")
    .select("purge_requested_by, removed_by")
    .eq("entity_type", row.entity_type)
    .eq("entity_id", row.entity_id)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `purge worker: no lifecycle row for ${row.entity_type}:${row.entity_id} — refusing to act`,
    );
  }
  const actor = (data.purge_requested_by ?? data.removed_by) as string | null;
  if (!actor) {
    throw new Error(
      `purge worker: lifecycle row for ${row.entity_type}:${row.entity_id} names no requester`,
    );
  }
  return actor;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
