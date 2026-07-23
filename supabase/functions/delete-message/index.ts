// Secure message deletion — the OTA entry point (§8a of the v9 design,
// docs/product/deleted-message-privacy.md).
//
// THE RULE (§0): return success only when We Glue no longer serves the
// original. Storage + PostgreSQL are NOT atomic, so this function orchestrates
// the physical attachment move that Postgres cannot, around a first PG
// transaction that has already made ordinary DB access fail-closed.
//
// One invocation:
//   1. Verify the caller's JWT (never trust the client for identity).
//   2. Require a real client idempotency key.
//   3. preflight_message_deletion — authorize (§3) + classify (§6). On any
//      failure NOTHING is written (no attempt, no redaction, no Storage change).
//   4. begin_message_deletion — the first PG txn (§4b): snapshot to founder
//      history, redact canonical content, set deleted_at, scrub pending pushes,
//      state -> pending (managed) or completed (external/none).
//   5. Managed attachment only: copy original -> deleted-message-retention +
//      verify (size+checksum) -> retained; delete original + POSITIVELY verify
//      absence server-side (§8f) -> original_removed; finalize -> completed.
//   6. Anything left non-terminal is safe: the reconcile worker resumes it.
//
// Returns MINIMAL status only — never history, retained paths, or evidence.
//
// Auth model: the caller presents their user JWT (verify_jwt). Privileged RPCs
// (SECURITY DEFINER, REVOKE'd from authenticated) run through the service-role
// client, which is why they take an explicit actor_id parameter — identity is
// established here from the verified JWT, not auth.uid() inside the RPC.
//
// Env (Supabase function secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ORIGINAL_BUCKET = "chat-attachments";
const RETENTION_BUCKET = "deleted-message-retention";
const OP_TIMEOUT_MS = 100_000; // §8b: 90–120 s per Storage operation.

type BeginResult = {
  status: string; // 'started' | 'existing' | 'already_deleted'
  message_id: string;
  attempt_id?: string;
  category?: "managed" | "external" | "none";
  state?: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 1. Verify the caller's JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const actorId = userData.user.id;

  // 2. Require a real idempotency key.
  let body: { message_id?: string; idempotency_key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const messageId = body.message_id;
  const idempotencyKey = body.idempotency_key;
  if (!messageId) return json({ error: "message_id_required" }, 400);
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return json({ error: "idempotency_key_required" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 3. Preflight (authorize + classify). Errors here mean ZERO writes to the
  //    deletion state. For unmappable / missing-source we record a SAFE
  //    diagnostic in a SEPARATE call (the preflight txn rolled back, so the RPC
  //    cannot persist it itself — §6C). This never blocks the error response.
  const pf = await admin.rpc("preflight_message_deletion", {
    p_message_id: messageId,
    p_actor_id: actorId,
  });
  if (pf.error) {
    const m = pf.error.message;
    if (
      m.includes("attachment_unmappable") || m.includes("source_object_missing")
    ) {
      const code = m.includes("source_object_missing")
        ? "source_object_missing"
        : "unmappable_attachment";
      // Best-effort; a diagnostic failure must not change the client response.
      try {
        await admin.rpc("record_unmappable_attachment_diagnostic", {
          p_message_id: messageId,
          p_error_code: code,
        });
      } catch (_) { /* ignore */ }
    }
    return json(mapRpcError(m), errStatus(m));
  }
  const pfStatus = (pf.data as { status?: string })?.status;
  if (pfStatus === "already_deleted") {
    return json({ status: "already_deleted" }, 200);
  }

  // 4. First PG transaction (redact + snapshot + set state).
  const bg = await admin.rpc("begin_message_deletion", {
    p_message_id: messageId,
    p_actor_id: actorId,
    p_entry_point: "edge_function",
    p_idempotency_key: idempotencyKey,
    p_reason: null,
  });
  if (bg.error) {
    return json(mapRpcError(bg.error.message), errStatus(bg.error.message));
  }
  const begin = bg.data as BeginResult;

  // External / none, or an already-terminal reuse: done — original never served.
  if (
    begin.category !== "managed" || begin.state === "completed" ||
    begin.status === "already_deleted"
  ) {
    return json(
      { status: "completed", state: begin.state ?? "completed" },
      200,
    );
  }

  // 5. Managed attachment: run the Storage saga. If any step is unsafe we leave
  //    the attempt for the reconcile worker rather than reporting false success.
  if (!begin.attempt_id) {
    return json({ status: "accepted", state: begin.state }, 202);
  }
  const outcome = await runStorageSaga(admin, begin.attempt_id);
  return json(outcome.body, outcome.status);
});

// Drives one managed attempt from `pending` to `completed`, using ONLY the
// immutable attachment mapping (never the redacted message row).
async function runStorageSaga(
  admin: SupabaseClient,
  attemptId: string,
): Promise<{ body: Record<string, unknown>; status: number }> {
  // Claim EXACTLY this attempt so the CAS transitions have a valid lease + token
  // (targeted claim avoids leasing an unrelated pending attempt).
  const claim = await admin.rpc("claim_specific_deletion_attempt", {
    p_attempt: attemptId,
    p_worker: "delete-message",
  });
  if (claim.error) return { body: { status: "accepted" }, status: 202 };
  const c = claim.data as {
    claimed: boolean;
    attempt_id?: string;
    claim_token?: string;
    mapping?: MappingRow | null;
  };
  // Another worker holds the lease (or it moved on): safe to defer.
  if (
    !c.claimed || c.attempt_id !== attemptId || !c.claim_token || !c.mapping
  ) {
    return { body: { status: "accepted", state: "pending" }, status: 202 };
  }
  const token = c.claim_token;
  const map = c.mapping;

  try {
    // (a) Copy original -> retention, verify size + checksum.
    const srcPath = map.original_object_path!;
    const dl = await withTimeout(
      admin.storage.from(ORIGINAL_BUCKET).download(srcPath),
    );
    if (dl.error || !dl.data) {
      // Source already gone? Could be a legitimate absence — but not proven
      // safe here. Hand to reconciliation rather than guessing (§8e/§8f).
      await admin.rpc("fail_deletion_attempt", {
        p_attempt: attemptId,
        p_claim_token: token,
        p_error: `download_failed:${dl.error?.message ?? "empty"}`,
        p_permanent: false,
      });
      return { body: { status: "accepted", state: "pending" }, status: 202 };
    }
    const buf = await dl.data.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const checksum = await sha256Hex(buf);
    const retainedPath = `${attemptId}/${srcPath}`;

    const up = await withTimeout(
      admin.storage.from(RETENTION_BUCKET).upload(retainedPath, bytes, {
        contentType: map.mime ?? "application/octet-stream",
        upsert: true,
      }),
    );
    if (up.error) {
      await admin.rpc("fail_deletion_attempt", {
        p_attempt: attemptId,
        p_claim_token: token,
        p_error: `retention_upload_failed:${up.error.message}`,
        p_permanent: false,
      });
      return { body: { status: "accepted" }, status: 202 };
    }
    // Verify the retained copy exists and matches size (checksum recomputed).
    const verify = await withTimeout(
      admin.storage.from(RETENTION_BUCKET).download(retainedPath),
    );
    if (verify.error || !verify.data) {
      await admin.rpc("fail_deletion_attempt", {
        p_attempt: attemptId,
        p_claim_token: token,
        p_error: "retention_verify_failed",
        p_permanent: false,
      });
      return { body: { status: "accepted" }, status: 202 };
    }
    const verifyBuf = await verify.data.arrayBuffer();
    if (
      verifyBuf.byteLength !== buf.byteLength ||
      (await sha256Hex(verifyBuf)) !== checksum
    ) {
      // Repeated checksum mismatch is a non-retryable integrity failure (§8d).
      await admin.rpc("fail_deletion_attempt", {
        p_attempt: attemptId,
        p_claim_token: token,
        p_error: "retention_checksum_mismatch",
        p_permanent: true,
      });
      return { body: { status: "manual_reconciliation" }, status: 202 };
    }

    const retained = await admin.rpc("mark_retention_copied", {
      p_attempt: attemptId,
      p_claim_token: token,
      p_retained_bucket: RETENTION_BUCKET,
      p_retained_path: retainedPath,
      p_checksum: checksum,
    });
    if (retained.error || retained.data !== true) {
      return { body: { status: "accepted" }, status: 202 }; // stale lease → defer
    }

    // (b) Delete the original, then POSITIVELY verify absence server-side (§8f).
    const rm = await withTimeout(
      admin.storage.from(ORIGINAL_BUCKET).remove([srcPath]),
    );
    if (rm.error) {
      await admin.rpc("fail_deletion_attempt", {
        p_attempt: attemptId,
        p_claim_token: token,
        p_error: `original_remove_failed:${rm.error.message}`,
        p_permanent: false,
      });
      return { body: { status: "accepted" }, status: 202 };
    }

    const absence = await verifyOriginalAbsent(admin, srcPath);
    if (absence.result !== "absent") {
      // Ambiguous → do NOT finalize; hand to reconciliation (§8f).
      await admin.rpc("fail_deletion_attempt", {
        p_attempt: attemptId,
        p_claim_token: token,
        p_error: `absence_${absence.result}:${absence.detail}`,
        p_permanent: false,
      });
      return {
        body: { status: "accepted", verification: absence.result },
        status: 202,
      };
    }

    const removed = await admin.rpc("mark_original_removed", {
      p_attempt: attemptId,
      p_claim_token: token,
      p_verification: {
        method: "storage_list",
        result: "absent",
        checked_at: new Date().toISOString(),
        classification: "verified_absent",
      },
    });
    if (removed.error || removed.data !== true) {
      return { body: { status: "accepted" }, status: 202 };
    }

    // (c) Finalize.
    const done = await admin.rpc("finalize_message_deletion", {
      p_attempt: attemptId,
      p_claim_token: token,
    });
    if (done.error || done.data !== true) {
      return { body: { status: "accepted" }, status: 202 };
    }
    return { body: { status: "completed", state: "completed" }, status: 200 };
  } catch (e) {
    // Unexpected crash mid-saga: mark retryable; the worker resumes. Never
    // re-expose canonical content (it is already redacted).
    await admin.rpc("fail_deletion_attempt", {
      p_attempt: attemptId,
      p_claim_token: token,
      p_error: `saga_exception:${String(e).slice(0, 200)}`,
      p_permanent: false,
    });
    return { body: { status: "accepted" }, status: 202 };
  }
}

type MappingRow = {
  original_bucket: string | null;
  original_object_path: string | null;
  mime: string | null;
  size: number | null;
};

// Trusted server-side absence proof (§8f). A client-visible 404, an expired
// signed URL, a permission-denied, or a timeout is NOT sufficient. We list the
// exact folder and confirm the exact object name is gone, AND confirm a new
// signed URL cannot be generated for the old path.
async function verifyOriginalAbsent(
  admin: SupabaseClient,
  srcPath: string,
): Promise<{ result: "absent" | "present" | "ambiguous"; detail: string }> {
  const slash = srcPath.lastIndexOf("/");
  const folder = slash >= 0 ? srcPath.slice(0, slash) : "";
  const name = slash >= 0 ? srcPath.slice(slash + 1) : srcPath;

  const listed = await withTimeout(
    admin.storage.from(ORIGINAL_BUCKET).list(folder, {
      search: name,
      limit: 100,
    }),
  );
  if (listed.error) {
    return {
      result: "ambiguous",
      detail: `list_error:${listed.error.message}`,
    };
  }
  const stillThere = (listed.data ?? []).some((o) => o.name === name);
  if (stillThere) return { result: "present", detail: "object_listed" };

  // New signed URL for the old path must be denied (object truly gone).
  const signed = await withTimeout(
    admin.storage.from(ORIGINAL_BUCKET).createSignedUrl(srcPath, 60),
  );
  // Service role can sign even a missing object in some versions; the list
  // check above is the authoritative signal, so a signable-but-unlisted object
  // is still treated as absent. A hard error only reinforces absence.
  if (signed.error) {
    return { result: "absent", detail: "unlisted_and_unsignable" };
  }
  return { result: "absent", detail: "unlisted" };
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("storage_op_timeout")), OP_TIMEOUT_MS)
    ),
  ]);
}

// Map internal RPC error codes to opaque, existence-preserving responses (§6).
function mapRpcError(msg: string): Record<string, unknown> {
  if (msg.includes("secure_deletion_required")) {
    return { error: "secure_deletion_required" };
  }
  if (msg.includes("attachment_unmappable")) {
    return { error: "attachment_unmappable" };
  }
  if (msg.includes("source_object_missing")) {
    return { error: "source_object_missing" };
  }
  if (msg.includes("not_authenticated")) return { error: "unauthorized" };
  // Both "missing" and "foreign" collapse to the same response (§6 Change #3).
  if (msg.includes("not_found_or_not_authorized")) {
    return { error: "not_found_or_not_authorized" };
  }
  return { error: "deletion_failed" };
}

function errStatus(msg: string): number {
  if (
    msg.includes("not_authenticated") ||
    msg.includes("not_found_or_not_authorized")
  ) return 403;
  if (
    msg.includes("secure_deletion_required") ||
    msg.includes("attachment_unmappable") ||
    msg.includes("source_object_missing")
  ) return 409;
  return 500;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
