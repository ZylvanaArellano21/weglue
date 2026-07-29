"use server";

// ============================================================================
// Admin Dashboard — Day-5 Admin Settings actions  (SERVER-ONLY)
// ============================================================================
// Only SAFE, read-only operational actions. There is NO environment mutation
// here — env changes are operator procedures in Vercel, never a browser button.
// ============================================================================

import { createAdminClient } from "../supabase/admin";
import { requireSecureAdmin } from "./secureAdmin";
import type { ActionResult } from "./actions";

/** Lightweight, read-only Supabase connectivity re-test (returns no data). */
export async function testSupabaseConnection(): Promise<ActionResult<{ ok: true }>> {
  await requireSecureAdmin();
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("universities").select("id", { head: true, count: "exact" }).limit(1);
    if (error) return { ok: false, error: "Read probe failed." };
    return { ok: true, data: { ok: true } };
  } catch {
    return { ok: false, error: "Connection failed." };
  }
}
