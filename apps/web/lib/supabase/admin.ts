import { createClient } from "@supabase/supabase-js";

// Defense-in-depth: this module wields the service-role key and must never run
// in a browser. The key has no NEXT_PUBLIC_ prefix so it is never bundled to the
// client, and no client component imports this file — but if either ever changed,
// fail loudly at module load rather than silently shipping the guard's absence.
if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase/admin.ts is server-only and must not be imported in the browser."
  );
}

/**
 * Admin Supabase client using the service role key.
 * NEVER import this on the client side or expose to the browser.
 * Only use inside server actions and route handlers.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
