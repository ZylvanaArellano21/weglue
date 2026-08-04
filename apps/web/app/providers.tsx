"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { usePathname } from "next/navigation";
import { getSupabaseBrowser } from "../lib/supabase-browser";
import { subscribeBroadcast } from "../lib/realtime";
import { invalidateStudentContentQueries, subscribeBrowserCanonicalRecovery } from "../lib/studentSynchronization";

function useApplicationAccessGate(queryClient: QueryClient): void {
  const pathname = usePathname();
  const checkRef = useRef<() => void>(() => {});
  const [timedSuspensionFallback, setTimedSuspensionFallback] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let checking = false;
    let removeAccessSync: (() => void) | null = null;
    let accessSyncUserId: string | null = null;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setTimedSuspensionFallback(false);
          return;
        }
        const { data, error } = await supabase.rpc("my_access_state");
        const accessState = data as { state?: string; suspended_until?: string | null } | null;
        const state = accessState?.state;
        if (!error && state) {
          const suspensionEnd = accessState?.suspended_until ? new Date(accessState.suspended_until).getTime() : Number.NaN;
          setTimedSuspensionFallback(
            state === "suspended" && Number.isFinite(suspensionEnd) && suspensionEnd > Date.now()
          );
        }
        if (!error && state && state !== "active") {
          await queryClient.cancelQueries();
          queryClient.clear();
          // Keep the account-scoped opaque channel alive. It is the only
          // signal a restricted shell needs to learn that the backend restored
          // access; protected child channels unmount with the protected route.
          // replace prevents Back from restoring a protected client route.
          window.location.replace("/restricted");
        } else if (!error && state === "active" && window.location.pathname === "/restricted") {
          // A restore/cancel-deletion ping never contains permission data. The
          // fresh RPC above is the sole reason this route can reopen.
          window.location.replace("/home");
        }
      } finally { checking = false; }
    };
    checkRef.current = () => void check();
    const subscribeAccessSync = (session: Session | null) => {
      const nextUserId = session?.user.id ?? null;
      if (nextUserId === accessSyncUserId) return;
      removeAccessSync?.();
      removeAccessSync = null;
      accessSyncUserId = nextUserId;
      if (!nextUserId) return;
      removeAccessSync = subscribeBroadcast(
        `sync:access:${nextUserId}`,
        "invalidate",
        () => void check(),
        () => void check(),
      );
    };

    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      void check();
      subscribeAccessSync(data.session);
    });
    const recover = () => void check();
    const removeBrowserRecovery = subscribeBrowserCanonicalRecovery(recover);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === "SIGNED_OUT") {
        removeAccessSync?.();
        removeAccessSync = null;
        accessSyncUserId = null;
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void check();
        subscribeAccessSync(session);
      }
    });
    const queryUnsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      const error = event.query.state.error as { code?: string; message?: string } | null;
      if (error?.code === "42501" || error?.message?.includes("account_restricted")) void check();
    });
    return () => {
      checkRef.current = () => {};
      removeBrowserRecovery();
      removeAccessSync?.();
      subscription.unsubscribe();
      queryUnsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!timedSuspensionFallback) return;
    // This is not a broad access poll. It only recovers the one state change
    // that occurs when a timed suspension expires without a database write.
    const interval = window.setInterval(() => checkRef.current(), 60_000);
    return () => window.clearInterval(interval);
  }, [timedSuspensionFallback]);

  useEffect(() => {
    // Navigation is a canonical recovery point: a direct client transition
    // cannot inherit an older access decision from the prior route.
    checkRef.current();
  }, [pathname]);
}

function useStudentContentSynchronization(queryClient: QueryClient): void {
  const pathname = usePathname();

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let removeContentSync: (() => void) | null = null;
    let cancelled = false;
    let contentSyncUserId: string | null = null;
    let contentSyncRequest = 0;

    const subscribeForUser = async (userId: string | undefined) => {
      const nextUserId = userId ?? null;
      if (nextUserId === contentSyncUserId) return;
      const request = ++contentSyncRequest;
      removeContentSync?.();
      removeContentSync = null;
      contentSyncUserId = nextUserId;
      if (!nextUserId) return;
      const { data: universityId, error } = await supabase.rpc("my_sync_university_id");
      if (cancelled || request !== contentSyncRequest || error || typeof universityId !== "string") return;
      removeContentSync = subscribeBroadcast(
        `sync:university:${universityId}`,
        "invalidate",
        () => invalidateStudentContentQueries(queryClient),
        () => invalidateStudentContentQueries(queryClient),
      );
    };

    void supabase.auth.getSession().then(
      ({ data }: { data: { session: Session | null } }) => void subscribeForUser(data.session?.user.id)
    );
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      void subscribeForUser(session?.user.id);
    });

    return () => {
      cancelled = true;
      removeContentSync?.();
      subscription.unsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    // A route transition can reveal an inactive cached query. Mark all relevant
    // surfaces stale first so it cannot render an earlier lifecycle state.
    invalidateStudentContentQueries(queryClient);
  }, [pathname, queryClient]);

  useEffect(() => {
    const recover = () => invalidateStudentContentQueries(queryClient);
    return subscribeBrowserCanonicalRecovery(recover);
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
  useStudentContentSynchronization(queryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
