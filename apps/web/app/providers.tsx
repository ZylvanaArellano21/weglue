"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { usePathname } from "next/navigation";
import { getSupabaseBrowser } from "../lib/supabase-browser";
import { subscribeBroadcast } from "../lib/realtime";
import {
  invalidateStudentContentQueries,
  refreshPermissionSensitiveStudentContent,
  subscribeBrowserCanonicalRecovery,
} from "../lib/studentSynchronization";
import { useUnreadSummary } from "../lib/hooks/useUnreadSummary";
import { useRealtimeNotifications } from "../lib/hooks/useNotifications";
import { useMyClubsRealtime } from "../lib/hooks/useClubRealtime";
import { useRealtimeMessageBanners } from "../lib/hooks/useRealtimeMessageBanners";
import { ForegroundNotificationBanner } from "../components/notifications/ForegroundNotificationBanner";

// The current session's user id, tracked once at the app root. Backs the
// session-wide realtime hub below — each of these hooks documents that it
// should mount ONCE per session, but was previously called from every
// page-level client component (Home, Messages, Clubs, Club profile), so
// navigating between them tore down and recreated the same three Realtime
// channels on every route change.
function useCurrentUserId(): string | undefined {
  const [userId, setUserId] = useState<string | undefined>(undefined);
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setUserId(data.session?.user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        setUserId(session?.user.id);
      }
    );
    return () => subscription.unsubscribe();
  }, []);
  return userId;
}

// Owns the single unread-summary, notifications, and my-clubs realtime
// subscriptions for the whole session, instead of each page remounting them.
function useSessionRealtimeHub(): string | undefined {
  const userId = useCurrentUserId();
  useUnreadSummary(userId);
  useRealtimeNotifications(userId);
  useMyClubsRealtime(userId);
  // Push-only message types never reach the notifications-table-driven
  // banner feed — their own realtime source (see the hook for why it can't
  // reuse the existing per-conversation thread sync).
  useRealtimeMessageBanners(userId);
  return userId;
}

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
        () => refreshPermissionSensitiveStudentContent(queryClient),
        () => refreshPermissionSensitiveStudentContent(queryClient),
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

  const firstPathRef = useRef(true);
  useEffect(() => {
    // A route TRANSITION can reveal an inactive cached query. Mark all relevant
    // surfaces stale so it cannot keep serving an earlier lifecycle state.
    //
    // INVALIDATE, not reset (Bug 8). Both mark the surface stale and both
    // refetch every active observer under current RLS, so the guarantee that
    // matters — nothing stays on screen that the database no longer returns —
    // is identical. The difference is what happens DURING the refetch:
    // `resetQueries` first discards the cached payload, which puts every
    // observer back into `status: "pending"`, and `isLoading` is what the
    // Messages, Home and profile surfaces render their full-page skeletons
    // from. Navigating between tabs therefore blanked content the viewer was
    // still entitled to see and re-fetched it from scratch.
    //
    // Clearing is retained where it is actually a privacy control: the opaque
    // university broadcast above, which is the signal that permissions may have
    // genuinely changed. A route change is not that signal.
    //
    // The first run is deliberately skipped. `Providers` mounts once per
    // document load with a brand-new QueryClient, so on that pass there is no
    // cached query to reveal — only the queries the page just started. Marking
    // them stale is not a stale-data guard, it is a guaranteed double fetch of
    // every student surface on every page load, and it is what made a freshly
    // opened conversation take a second round trip to appear.
    if (firstPathRef.current) {
      firstPathRef.current = false;
      return;
    }
    invalidateStudentContentQueries(queryClient);
  }, [pathname, queryClient]);

  useEffect(() => {
    // Returning to the tab must REFRESH, never blank (Bug 8, and the direct
    // cause of Bug 4).
    //
    // This fires on window focus, `online`, and visibilitychange→visible. It
    // used to clear every student payload first, so simply switching back to an
    // already-open We Glue tab replaced the whole of Messages with skeletons and
    // refetched it. It also fired mid-send: opening the native file picker blurs
    // the window and dismissing it focuses the window again, which reset the
    // messages cache underneath the composer — the attachment appeared to
    // "reload the screen and then send nothing".
    //
    // A refocus is not evidence that anything changed, so recovery is a
    // background invalidation: cached content keeps rendering, every active
    // query refetches under current RLS, and anything the database no longer
    // returns disappears when that refetch lands.
    const recover = () => invalidateStudentContentQueries(queryClient);
    return subscribeBrowserCanonicalRecovery(recover);
  }, [queryClient]);
}

// This codebase has never registered a service worker — yet a real device
// tested during this engagement had one active at the root scope (`/sw.js`,
// which now 404s) with a Workbox cache holding ~400 stale static assets.
// It's a leftover from something that used to be hosted at this domain
// before it pointed here; nothing in this app can prevent it from
// installing, only clean it up after the fact. Deploy after deploy, a
// returning browser with this registration can keep serving that old cache
// indefinitely instead of ever fetching the new build — which is why real
// devices reported seeing no changes while the deployed code was already
// correct. No-op for anyone who never had one. The one-time reload (guarded
// by a session flag, so it can't loop) is needed because unregistering does
// not stop a service worker from controlling the page that is ALREADY open —
// only the next navigation. Without it, this exact visit still renders stale
// content once and the fix would only become visible on the visit after.
function useLegacyServiceWorkerCleanup(): void {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      if (regs.length === 0) return;
      regs.forEach((reg) => void reg.unregister());
      if (!("caches" in window)) return;
      void caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => {
          const flag = "weglue-legacy-sw-cleanup-reloaded";
          if (sessionStorage.getItem(flag)) return;
          sessionStorage.setItem(flag, "1");
          window.location.reload();
        });
    });
  }, []);
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
            // Cached pages survive long enough that leaving a conversation,
            // a profile or a post and coming straight back renders from cache
            // instead of re-running the whole query chain (Bug 8).
            gcTime: 10 * 60 * 1000,
            retry: 1,
            // Focus refresh is owned by `subscribeBrowserCanonicalRecovery`
            // above, which is also wired to `online` and visibilitychange.
            // Leaving React Query's own focus refetch on as well meant every
            // return to the tab fired TWO refetch passes over every active
            // query — the duplicate Supabase requests behind Bug 8.
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  useLegacyServiceWorkerCleanup();
  useRealtimeAuthBridge();
  useApplicationAccessGate(queryClient);
  useStudentContentSynchronization(queryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {/* useUnreadSummary/useRealtimeNotifications/useMyClubsRealtime use
          useQuery/useQueryClient internally, so this must render INSIDE
          QueryClientProvider, not in Providers' own body above. */}
      <SessionRealtimeHub />
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

function SessionRealtimeHub(): JSX.Element {
  const userId = useSessionRealtimeHub();
  // Correction 3: the foreground banner overlay, layered above every page —
  // renders nothing until a notification actually arrives for this user.
  // Suspense is required here: ForegroundNotificationBanner reads
  // useSearchParams(), and this hub is mounted at the root layout for every
  // page — without it, static prerendering fails build-wide.
  return (
    <Suspense fallback={null}>
      <ForegroundNotificationBanner userId={userId} />
    </Suspense>
  );
}
