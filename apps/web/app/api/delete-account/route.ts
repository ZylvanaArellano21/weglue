import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../lib/supabase/admin";

// Called by the mobile app after delete_own_user_data() RPC has already cleaned
// all data rows. This route deletes the auth.users record (requires admin client).
//
// Authorization: Bearer <supabase_access_token>
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Missing authorization token." }, { status: 401 });
  }

  // Verify the token and get the user ID
  const adminClient = createAdminClient();
  const {
    data: { user },
    error: userError,
  } = await adminClient.auth.getUser(token);

  if (userError || !user) {
    return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 });
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);

  if (deleteError) {
    console.error("[delete-account] admin.deleteUser error:", deleteError);
    return NextResponse.json(
      { error: "Failed to delete account. Please contact support." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
