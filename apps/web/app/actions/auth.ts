"use server";

import { createAdminClient } from "../../lib/supabase/admin";

/**
 * Records the Terms & Conditions + age confirmations on the profile row the
 * signup trigger just created. Runs with the service role because email
 * confirmation is ON — the browser has no session yet at this point.
 *
 * Deliberately narrow: it can only flip agreed_to_terms to true (never back),
 * which is the one write the anonymous signup flow legitimately needs.
 */
export async function recordSignupConsent(userId: string): Promise<void> {
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return;
  try {
    const admin = createAdminClient();
    await admin
      .from("profiles")
      .update({ agreed_to_terms: true, agreed_at: new Date().toISOString() })
      .eq("id", userId)
      .eq("agreed_to_terms", false);
  } catch (err) {
    // Non-fatal: consent was still collected in the UI; log for observability.
    console.error("[recordSignupConsent] failed:", err);
  }
}
