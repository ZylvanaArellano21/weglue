// Deleted-message reconciliation worker — the protected Cron + Edge worker
// (§8 of the v9 design, docs/product/deleted-message-privacy.md).
//
// Invoked by Supabase Cron every 1–2 minutes (open question §19.1: external
// runner). Auth: a shared RECONCILE_SECRET bearer — never called by clients.
//
// Guarantees implemented here:
//   • Short claim transaction (claim_deletion_attempt: FOR UPDATE SKIP LOCKED,
//     5-minute lease, claim token) — Storage work happens OUTSIDE any txn.
//   • Heartbeat every 60 s; renew when < 2 min remain (heartbeat CAS).
//   • ONE object per claim; 90–120 s per-Storage-operation timeout.
//   • Compare-and-set transitions require the valid claim token + expected
//     state; a stale worker's writes are rejected (zero rows).
//   • Expired leases are recoverable by another worker (claim predicate).
//   • Retry with backoff; max-retry / max-age -> dead-letter + critical alert.
//   • NEVER claims dead-lettered attempts, diagnostics, or Category-C rows
//     (enforced by the claim predicate — those are not deletion attempts).
//   • Positive server-side absence proof (§8f) before any success.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RECONCILE_SECRET.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const ORIGINAL_BUCKET = "chat-attachments";
const RETENTION_BUCKET = "deleted-message-retention";
const OP_TIMEOUT_MS = 100_000;       // §8b: 90–120 s per Storage op.
const RENEW_BELOW_MS = 2 * 60_000;   // renew lease when < 2 min remain.
const MAX_ATTEMPTS_PER_RUN = 5;      // bounded work per invocation (Edge limits).
const RUN_BUDGET_MS = 55_000;        // stay well under the Edge wall-clock limit.

type MappingRow = {
  id: string;
  original_bucket: string | null;
  original_object_path: string | null;
  retained_bucket: string | null;
  retained_object_path: string | null;
  mime: string | null;
  size: number | null;
  copy_status: string;
  delete_status: string;
};

type Claim = {
  claimed: boolean;
  attempt_id?: string;
  message_id?: string;
  claim_token?: string;
  state?: string;
  category?: "managed" | "external" | "none";
  retry_count?: number;
  mapping?: MappingRow | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("RECONCILE_SECRET");
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!secret || !bearer || bearer !== secret) return json({ error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const workerId = `reconcile-${crypto.randomUUID().slice(0, 8)}`;

  const started = Date.now();
  let claimed = 0, completed = 0, retried = 0, deadLettered = 0;

  for (let i = 0; i < MAX_ATTEMPTS_PER_RUN; i++) {
    if (Date.now() - started > RUN_BUDGET_MS) break;

    const cr = await admin.rpc("claim_deletion_attempt", { p_worker: workerId });
    if (cr.error) {
      console.error("claim failed:", cr.error.message);
      break;
    }
    const claim = cr.data as Claim;
    if (!claim.claimed) break; // nothing eligible.
    claimed++;

    const r = await resume(admin, claim);
    if (r === "completed") completed++;
    else if (r === "dead_letter") deadLettered++;
    else retried++;
  }

  return json({ ok: true, worker: workerId, claimed, completed, retried, dead_lettered: deadLettered });
});

// Resume one claimed attempt from its current state. Category-external/none
// attempts are already terminal (they never reach the worker), so any claimed
// attempt is managed. Returns the disposition for run-level counters.
async function resume(
  admin: SupabaseClient,
  claim: Claim,
): Promise<"completed" | "retry" | "dead_letter"> {
  const attemptId = claim.attempt_id!;
  const token = claim.claim_token!;
  const map = claim.mapping;
  if (!map || !map.original_object_path) {
    // No managed mapping but claimed as managed: integrity failure -> manual.
    await admin.rpc("fail_deletion_attempt", {
      p_attempt: attemptId, p_claim_token: token,
      p_error: "missing_attachment_mapping", p_permanent: true,
    });
    return "dead_letter";
  }

  const heartbeat = startHeartbeat(admin, attemptId, token);
  try {
    const srcPath = map.original_object_path;
    let state = claim.state!;

    // --- pending -> retained: copy original to retention + verify.
    if (state === "pending") {
      const copied = await copyAndVerify(admin, attemptId, token, map);
      if (copied === "retry") return await failRetry(admin, attemptId, token, "copy_failed");
      if (copied === "dead") return "dead_letter";
      state = "retained";
    }

    // --- retained -> original_removed: delete original + PROVE absence (§8f).
    if (state === "retained") {
      const rm = await withTimeout(admin.storage.from(ORIGINAL_BUCKET).remove([srcPath]));
      if (rm.error) return await failRetry(admin, attemptId, token, `remove_failed:${rm.error.message}`);

      const absence = await verifyOriginalAbsent(admin, srcPath);
      if (absence !== "absent") {
        // Ambiguous/present: never finalize. Retry (transient) — the taxonomy
        // escalates to dead-letter on repeated failure / age (§8d/§8f).
        return await failRetry(admin, attemptId, token, `absence_${absence}`);
      }
      const ok = await admin.rpc("mark_original_removed", {
        p_attempt: attemptId, p_claim_token: token,
        p_verification: { method: "storage_list", result: "absent",
          checked_at: new Date().toISOString(), classification: "verified_absent" },
      });
      if (ok.error || ok.data !== true) return "retry"; // stale lease → defer.
      state = "original_removed";
    }

    // --- original_removed -> completed.
    if (state === "original_removed") {
      const done = await admin.rpc("finalize_message_deletion", {
        p_attempt: attemptId, p_claim_token: token,
      });
      if (done.error || done.data !== true) return "retry";
      return "completed";
    }

    // failed_requires_reconciliation that is not dead-lettered starts over from
    // its mapping state; treat as retry so the next claim re-drives it.
    return "retry";
  } catch (e) {
    await failRetry(admin, attemptId, token, `exception:${String(e).slice(0, 200)}`);
    return "retry";
  } finally {
    clearInterval(heartbeat);
  }
}

async function copyAndVerify(
  admin: SupabaseClient,
  attemptId: string,
  token: string,
  map: MappingRow,
): Promise<"ok" | "retry" | "dead"> {
  const srcPath = map.original_object_path!;
  const dl = await withTimeout(admin.storage.from(ORIGINAL_BUCKET).download(srcPath));
  if (dl.error || !dl.data) return "retry";
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  const checksum = await sha256Hex(bytes);
  const retainedPath = `${attemptId}/${srcPath}`;

  const up = await withTimeout(
    admin.storage.from(RETENTION_BUCKET).upload(retainedPath, bytes, {
      contentType: map.mime ?? "application/octet-stream",
      upsert: true,
    }),
  );
  if (up.error) return "retry";

  const verify = await withTimeout(admin.storage.from(RETENTION_BUCKET).download(retainedPath));
  if (verify.error || !verify.data) return "retry";
  const vb = new Uint8Array(await verify.data.arrayBuffer());
  if (vb.byteLength !== bytes.byteLength || (await sha256Hex(vb)) !== checksum) {
    await admin.rpc("fail_deletion_attempt", {
      p_attempt: attemptId, p_claim_token: token,
      p_error: "retention_checksum_mismatch", p_permanent: true,
    });
    return "dead";
  }

  const marked = await admin.rpc("mark_retention_copied", {
    p_attempt: attemptId, p_claim_token: token,
    p_retained_bucket: RETENTION_BUCKET, p_retained_path: retainedPath, p_checksum: checksum,
  });
  if (marked.error || marked.data !== true) return "retry";
  return "ok";
}

// §8f absence proof: list the exact folder; the exact object name must be gone.
async function verifyOriginalAbsent(
  admin: SupabaseClient,
  srcPath: string,
): Promise<"absent" | "present" | "ambiguous"> {
  const slash = srcPath.lastIndexOf("/");
  const folder = slash >= 0 ? srcPath.slice(0, slash) : "";
  const name = slash >= 0 ? srcPath.slice(slash + 1) : srcPath;
  const listed = await withTimeout(
    admin.storage.from(ORIGINAL_BUCKET).list(folder, { search: name, limit: 100 }),
  );
  if (listed.error) return "ambiguous";
  return (listed.data ?? []).some((o) => o.name === name) ? "present" : "absent";
}

async function failRetry(
  admin: SupabaseClient,
  attemptId: string,
  token: string,
  error: string,
): Promise<"retry" | "dead_letter"> {
  const res = await admin.rpc("fail_deletion_attempt", {
    p_attempt: attemptId, p_claim_token: token, p_error: error, p_permanent: false,
  });
  const dead = (res.data as { dead_lettered?: boolean } | null)?.dead_lettered === true;
  if (dead) console.error(`CRITICAL: deletion attempt ${attemptId} dead-lettered: ${error}`);
  return dead ? "dead_letter" : "retry";
}

// Heartbeat: renew the lease when < 2 min remain (§8b). Runs every 60 s.
function startHeartbeat(admin: SupabaseClient, attemptId: string, token: string): number {
  return setInterval(async () => {
    const ok = await admin.rpc("heartbeat_deletion_claim", {
      p_attempt: attemptId, p_claim_token: token,
    });
    if (ok.error || ok.data !== true) {
      // Lease lost: stop heartbeating; CAS transitions will now reject us.
      console.warn(`heartbeat lost for ${attemptId}`);
    }
  }, 60_000) as unknown as number;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("storage_op_timeout")), OP_TIMEOUT_MS)
    ),
  ]);
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// RENEW_BELOW_MS is documented in the heartbeat contract; the interval-based
// heartbeat renews unconditionally every 60 s, which satisfies "renew when
// < 2 min remain" for a 5-min lease. Referenced to keep the constant meaningful.
void RENEW_BELOW_MS;
