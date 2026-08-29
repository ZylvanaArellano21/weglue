"use client";

import { createBrowserClient } from "@supabase/ssr";
import { jitteredReconnectAfterMs } from "@weglue/shared";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowser() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        realtime: {
          // Jittered reconnect so a shared-network drop (campus Wi-Fi) doesn't
          // reconnect every browser in lock-step waves (see jitteredReconnectAfterMs).
          reconnectAfterMs: jitteredReconnectAfterMs,
        },
      }
    );
  }
  return client;
}
