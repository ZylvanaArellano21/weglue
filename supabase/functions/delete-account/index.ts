// Deletes the calling user's account end-to-end:
//   1. Verifies the caller's JWT (service client → auth.getUser).
//   2. Collects the user's Storage objects (avatar, post images) BEFORE the
//      rows that point at them are deleted.
//   3. Runs delete_own_user_data() AS THE USER so auth.uid() applies —
//      anonymizes shared-conversation messages, deletes owned rows.
//   4. Removes those Storage objects with the service-role client.
//   5. Deletes the auth.users record with the admin API.
//
// The service-role key never leaves this function. The mobile app calls this
// via supabase.functions.invoke('delete-account') with the user's own access
// token — the user id comes from the verified JWT, never from the request body,
// so a user can only ever delete themself.
//
// IDEMPOTENT: every step is a delete. Retrying after a partial failure
// re-runs cleanly rather than wedging the account in a half-deleted state.
//
// Storage cleanup used to run on the CLIENT, before this function was even
// called — so a failure here left the account alive with its images already
// destroyed (the "ghost account": empty profile, Unknown User in the sidebar,
// still signed in). It is server-side now, and only runs once the data
// deletion has actually succeeded.

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

  // ── Phase 1: gather Storage paths while the rows still exist ──────────────
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
    // Non-fatal: losing track of a few objects must not block the deletion of
    // the account itself. Orphaned objects are recoverable; a ghost account is
    // not.
    console.error("[delete-account] storage path collection failed:", e);
  }

  // ── Phase 2: delete the user's data AS the user (RPC checks auth.uid()) ───
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error: rpcError } = await asUser.rpc("delete_own_user_data");
  if (rpcError) {
    console.error("[delete-account] delete_own_user_data failed:", rpcError);
    // Nothing destructive has happened yet on the client, and the account is
    // still fully intact and usable. Report the failure honestly.
    return json({ error: "Could not delete account data" }, 500);
  }

  // ── Phase 3: remove Storage objects (service role, best effort) ───────────
  await removeAll(admin, "avatars", avatarPaths);
  await removeAll(admin, "posts", postPaths);

  // ── Phase 4: remove the auth record ───────────────────────────────────────
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error("[delete-account] admin.deleteUser failed:", deleteError);
    // The account is NOT deleted — the auth record still exists and can still
    // sign in. Previously this returned success:true, so the app signed the
    // user out believing the account was gone while it was very much alive.
    // It is an error, and the client must keep the session and surface it.
    // Retrying is safe: the data deletion above is idempotent.
    return json(
      { error: "Could not complete account deletion. Please try again." },
      500,
    );
  }

  return json({ success: true, dataDeleted: true, authDeleted: true }, 200);
});

/** `.../storage/v1/object/public/<bucket>/<path>` → `<path>` (null if not ours). */
function storagePathFromPublicUrl(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const path = url.slice(i + marker.length);
  return path.length > 0 ? decodeURIComponent(path) : null;
}

async function removeAll(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) console.error(`[delete-account] storage remove ${bucket}:`, error);
  } catch (e) {
    console.error(`[delete-account] storage remove ${bucket} threw:`, e);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
