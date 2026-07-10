// Deletes the calling user's account end-to-end:
//   1. Verifies the caller's JWT (service client → auth.getUser).
//   2. Runs delete_own_user_data() AS THE USER so auth.uid() applies —
//      anonymizes shared-conversation messages, deletes owned rows.
//   3. Deletes the auth.users record with the admin API.
//
// The service-role key never leaves this function. The mobile app calls
// this via supabase.functions.invoke('delete-account') with the user's
// own access token — a user can only ever delete themself.

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

  // Phase 1: data cleanup as the user (RPC checks auth.uid() itself).
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error: rpcError } = await asUser.rpc("delete_own_user_data");
  if (rpcError) {
    console.error("[delete-account] delete_own_user_data failed:", rpcError);
    return json({ error: "Could not delete account data" }, 500);
  }

  // Phase 2: remove the auth record. Data is already gone at this point,
  // so a failure here is reported but not treated as fatal for the client —
  // the flag lets us find and clean up stragglers server-side.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("[delete-account] admin.deleteUser failed:", deleteError);
    return json({ success: true, dataDeleted: true, authDeleted: false }, 200);
  }

  return json({ success: true, dataDeleted: true, authDeleted: true }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
