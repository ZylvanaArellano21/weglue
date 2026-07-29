// Permanently deletes the calling user's account, end to end.
//
//   1. Verify the caller's JWT (service client → auth.getUser). The user id is
//      taken from the verified token, NEVER from the request body, so a caller
//      can only ever delete themself. There is no parameter to point elsewhere.
//   2. delete_own_account_atomic() — ONE transaction: scrubs the residues that
//      have no foreign key, de-identifies moderation evidence, removes rows the
//      FKs would have orphaned, hard-deletes solo-thread messages, applies every
//      SET NULL explicitly, then DELETE FROM auth.users. It returns the Storage
//      object keys, grouped by bucket, that this function must now sweep.
//   3. Remove those objects with the service role.
//
// The service-role key never leaves this function; the client never sees one.
//
// WHY IT LOOKS LIKE THIS
//
// The original version ran delete_own_user_data() and then a SEPARATE
// admin.auth.admin.deleteUser() call. Those do not share a transaction, so when
// the auth step failed the data deletion had already COMMITTED: profile,
// interests, memberships and posts gone, while auth.users survived and could
// still sign in. That is the "Unknown User" ghost account, and returning HTTP
// 500 does not undo it. Migration 044 collapsed the whole thing into one
// transaction; migration 052 completed its data coverage and fixed an ordering
// bug that made deletion fail outright for any user with a club post.
//
// The outcome is binary: the account is entirely gone, or entirely intact.
// Partial deletion is structurally impossible rather than merely unlikely, so
// retrying a failed attempt is always safe — it starts from an intact account.
//
// STORAGE IS DELIBERATELY OUTSIDE THE TRANSACTION
//
// Object storage is not transactional. If the sweep fails AFTER the account is
// gone we log it loudly and STILL report success: the account really is
// deleted, and reporting failure would trap the user in an account that no
// longer exists and make them retry forever. The cost is orphaned files — a
// recoverable cleanup task, never a ghost account.
//
// The path list now comes FROM the transaction rather than from a separate
// pre-pass. The old pre-pass read only the avatars and posts buckets, so it
// could not see club-gallery uploads or chat attachments at all, and it read
// rows a second time, racing its own deletion.

import { createClient } from "npm:@supabase/supabase-js@2";

/** Buckets the deletion RPC may return keys for. Anything else is ignored. */
const SWEEPABLE_BUCKETS = ["avatars", "posts", "club-photos", "chat-attachments"] as const;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return json({ error: "Missing authorization token" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    // Also the shape a retry takes once the account is already gone: the token
    // no longer resolves to a user. Terminal, not retryable — the client should
    // sign out rather than loop.
    return json({ error: "Invalid or expired session" }, 401);
  }

  const userId = user.id;

  // ── Delete the account atomically, AS the user (the RPC reads auth.uid()) ──
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: paths, error: rpcError } = await asUser.rpc("delete_own_account_atomic");

  if (rpcError) {
    console.error("[delete-account] delete_own_account_atomic failed:", rpcError);
    // The transaction rolled back: the account and ALL of its data are fully
    // intact and still usable. Nothing destructive has happened anywhere — the
    // client keeps its session and surfaces the error. Retry is safe.
    return json(
      { error: "Could not delete your account. Please try again." },
      500,
    );
  }

  // ── The account is gone. Storage cleanup can no longer endanger it. ───────
  let orphaned = 0;
  for (const bucket of SWEEPABLE_BUCKETS) {
    orphaned += await removeAll(admin, bucket, readPaths(paths, bucket));
  }

  if (orphaned > 0) {
    // Loud, greppable, and NOT an error to the caller: the deletion succeeded.
    console.error(
      `[delete-account] ORPHANED_STORAGE user=${userId} objects=${orphaned} ` +
        `— account deleted successfully; these objects need sweeping.`,
    );
  }

  return json(
    { success: true, dataDeleted: true, authDeleted: true, orphanedObjects: orphaned },
    200,
  );
});

/** Pulls one bucket's key list out of the RPC payload, defensively. */
function readPaths(payload: unknown, bucket: string): string[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as Record<string, unknown>)[bucket];
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/** Removes objects; returns how many could NOT be removed (orphans). */
async function removeAll(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  paths: string[],
): Promise<number> {
  if (paths.length === 0) return 0;
  try {
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) {
      console.error(`[delete-account] storage remove ${bucket} failed:`, error);
      return paths.length;
    }
    return 0;
  } catch (e) {
    console.error(`[delete-account] storage remove ${bucket} threw:`, e);
    return paths.length;
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
