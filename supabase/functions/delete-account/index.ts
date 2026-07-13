// Deletes the calling user's account end-to-end.
//
//   1. Verify the caller's JWT (service client → auth.getUser). The user id is
//      taken from the verified token, NEVER from the request body, so a caller
//      can only ever delete themself.
//   2. Collect the user's Storage object paths while the rows still exist.
//   3. delete_own_account_atomic() — ONE transaction: hard-deletes solo-thread
//      messages, then DELETE FROM auth.users, which cascades through profiles
//      to every owned table and anonymizes shared messages (SET NULL).
//   4. Only after that succeeds, remove the Storage objects (service role).
//
// The service-role key never leaves this function; the client never sees one.
//
// WHY IT LOOKS LIKE THIS
//
// The previous version ran delete_own_user_data() and then called
// admin.auth.admin.deleteUser() as a SEPARATE API call. Those do not share a
// transaction. When the auth deletion failed, the data deletion had already
// COMMITTED — profile, interests, activities, memberships and posts gone, while
// auth.users survived and could still sign in. An authenticated user with no
// profile is the "Unknown User" ghost account, and returning HTTP 500 does not
// undo it. Confirmed on the live project by forcing a failure at the auth step:
// auth.users=1, profiles=0, interests=0, login still worked.
//
// Step 3 is now a single transaction, so the outcome is binary: the account is
// entirely gone, or entirely intact. Partial deletion is structurally
// impossible, not merely unlikely. Retrying a failed attempt is therefore
// always safe — it starts from a fully intact account.
//
// STORAGE IS DELIBERATELY OUTSIDE THE TRANSACTION
//
// Object storage is not transactional. If storage cleanup fails AFTER the
// account is gone, we log it and STILL report success: the account really is
// deleted, and reporting failure would trap the user in an account that no
// longer exists (and would make them retry forever). The cost of that choice is
// orphaned files, which are a recoverable cleanup task — never a ghost account.

import { createClient } from "npm:@supabase/supabase-js@2";

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
    return json({ error: "Invalid or expired session" }, 401);
  }

  const userId = user.id;

  // ── 1. Collect Storage paths while the rows still point at them ───────────
  // Best effort: losing track of an object must not block the deletion. An
  // orphaned file is recoverable; a half-deleted account is not.
  const avatarPaths: string[] = [];
  const postPaths: string[] = [];
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("avatar_url, avatar_type")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.avatar_url && profile.avatar_type !== "text") {
      const p = storagePathFromPublicUrl(profile.avatar_url as string, "avatars");
      if (p) avatarPaths.push(p);
    }

    const { data: posts } = await admin
      .from("posts")
      .select("image_url")
      .eq("author_id", userId)
      .not("image_url", "is", null);

    for (const row of posts ?? []) {
      const p = storagePathFromPublicUrl((row as { image_url: string }).image_url, "posts");
      if (p) postPaths.push(p);
    }
  } catch (e) {
    console.error("[delete-account] storage path collection failed (continuing):", e);
  }

  // ── 2. Delete the account atomically, as the user (RPC checks auth.uid()) ──
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { error: rpcError } = await asUser.rpc("delete_own_account_atomic");
  if (rpcError) {
    console.error("[delete-account] delete_own_account_atomic failed:", rpcError);
    // The transaction rolled back: the account and ALL of its data are fully
    // intact and still usable. Nothing destructive has happened anywhere —
    // the client keeps the session and surfaces the error. Retry is safe.
    return json(
      { error: "Could not delete your account. Please try again." },
      500,
    );
  }

  // ── 3. The account is gone. Storage cleanup can no longer endanger it. ────
  const orphanedAvatars = await removeAll(admin, "avatars", avatarPaths);
  const orphanedPosts = await removeAll(admin, "posts", postPaths);
  const orphaned = orphanedAvatars + orphanedPosts;
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

/** `.../storage/v1/object/public/<bucket>/<path>` → `<path>` (null if not ours). */
function storagePathFromPublicUrl(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const path = url.slice(i + marker.length);
  return path.length > 0 ? decodeURIComponent(path) : null;
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
