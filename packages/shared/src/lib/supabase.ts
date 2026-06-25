import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Resolved at runtime so both Next.js (NEXT_PUBLIC_) and Expo (EXPO_PUBLIC_)
// prefixes work — whichever is set wins.
function getEnv(key: string, prefixes: string[]): string {
  for (const prefix of prefixes) {
    const value =
      typeof process !== "undefined" ? (process.env as Record<string, string | undefined>)[`${prefix}${key}`] : undefined;
    if (value) return value;
  }
  throw new Error(
    `Missing environment variable: one of ${prefixes.map((p) => `${p}${key}`).join(", ")}`
  );
}

let _client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = getEnv("SUPABASE_URL", ["NEXT_PUBLIC_", "EXPO_PUBLIC_", ""]);
  const anonKey = getEnv("SUPABASE_ANON_KEY", ["NEXT_PUBLIC_", "EXPO_PUBLIC_", ""]);

  _client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  return _client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
