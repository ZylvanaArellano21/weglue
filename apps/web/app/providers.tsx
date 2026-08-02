"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "../lib/supabase-browser";

function useApplicationAccessGate(queryClient: QueryClient): void {
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let checking = false;
    const check = async () => {
      if (checking || window.location.pathname === "/restricted") return;
      checking = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data, error } = await supabase.rpc("my_access_state");
        const state = (data as { state?: string } | null)?.state;
        if (!error && state && state !== "active") {
          await queryClient.cancelQueries();
          queryClient.clear();
          await supabase.removeAllChannels();
          // replace prevents Back from restoring a protected client route.
          window.location.replace("/restricted");
        }
      } finally { checking = false; }
    };
    void check();
    const interval = window.setInterval(() => void check(), 60_000);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") void check();
    });
    const queryUnsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      const error = event.query.state.error as { code?: string; message?: string } | null;
      if (error?.code === "42501" || error?.message?.includes("account_restricted")) void check();
    });
    return () => { window.clearInterval(interval); subscription.unsubscribe(); queryUnsubscribe(); };
  }, [queryClient]);
}

// Single, centralized auth → Realtime bridge (mounted once at the app root).
// Private Broadcast channels (event:/post: interaction realtime) are only
// authorized while the Realtime socket carries the user's current access token,
// so this keeps that token in sync for the WHOLE session — including long-open
// overlays across a token refresh:
//   • initial session         → push the current token to Realtime
//   • SIGNED_IN / INITIAL_SESSION / TOKEN_REFRESHED / USER_UPDATED
//                             → re-authorize the socket + every open channel
//   • SIGNED_OUT              → clear Realtime auth and close all channels
// Exactly ONE listener: the effect has no deps and its cleanup unsubscribes, so
// React Strict Mode's mount→cleanup→mount leaves a single active subscription;
// the subscription is also torn down if the provider ever unmounts.
function useRealtimeAuthBridge(): void {
  useEffect(() => {
    const supabase = getSupabaseBrowser();

    // Push the current token immediately so a channel opened before the first
    // auth event still authorizes.
    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (data.session?.access_token) void supabase.realtime.setAuth(data.session.access_token);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === "SIGNED_OUT") {
        void supabase.realtime.setAuth(null);
        void supabase.removeAllChannels();
        return;
      }
      if (session?.access_token) {
        void supabase.realtime.setAuth(session.access_token);
      }
    });

    return () => subscription.unsubscribe();
  }, []);
}

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  useRealtimeAuthBridge();
  useApplicationAccessGate(queryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
