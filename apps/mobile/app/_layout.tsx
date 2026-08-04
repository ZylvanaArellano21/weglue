import "../global.css";

import {
  Zain_400Regular,
  Zain_700Bold,
  Zain_800ExtraBold,
} from "@expo-google-fonts/zain";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState, useCallback } from "react";
import { AppState, Platform, Text, TouchableOpacity, View } from "react-native";
import { useAuthStore } from "@weglue/shared";
import { supabase } from "../lib/supabase";
import { useAuthDeepLink } from "../hooks/useAuthDeepLink";
import { useInviteDeepLink } from "../hooks/useInviteDeepLink";
import { useAccessSynchronization } from "../hooks/useAccessSynchronization";
import { LeaveClubHost } from "../components/club/LeaveClubHost";
import { SidebarHost } from "../components/sidebar/SidebarHost";
import { MediaPickerHost } from "../components/media/MediaPickerHost";
import { PushNotificationsHost } from "../components/notifications/PushNotificationsHost";
import { timedQuery } from "../lib/timedQuery";
import {
  clearCachedProfile,
  writeCachedProfile,
} from "../lib/profileCache";
import { PlatformAdminBlock } from "../components/auth/PlatformAdminBlock";
import { RestrictedAccountShell } from "../components/auth/RestrictedAccountShell";
import { getMyAccessState, looksLikeRestriction } from "../services/accessService";
import { resolveAccessRoute, isRestrictedRoute, type AccessStatePayload } from "../lib/accessState";
import {
  resolveMobileSessionRoute,
  shouldSyncStudentProfile,
} from "../lib/platformAdmin";
import { tearDownAuthenticatedSession } from "../lib/sessionCleanup";
import { StudentSynchronizationHost } from "../components/synchronization/StudentSynchronizationHost";

SplashScreen.preventAutoHideAsync();

// expo-router renders this instead of crashing when any screen throws during
// render (e.g. a malformed cached profile field reaching a component). It
// catches JS-level errors only — native crashes still surface to the OS — but
// it keeps a single bad value from turning into a blank/hard launch failure.
export function ErrorBoundary({
  error,
  retry,
}: {
  error: Error;
  retry: () => Promise<void>;
}) {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    // Keep the technical detail for debugging, but never show raw errors
    // (Supabase/Realtime internals, stack fragments…) to users.
    console.error('[ErrorBoundary]', error);
  }, [error]);
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#FEFCF0",
        padding: 24,
      }}
    >
      <Text style={{ fontSize: 20, fontWeight: "700", color: "#000", textAlign: "center" }}>
        Something went wrong
      </Text>
      <Text style={{ fontSize: 14, color: "#444", textAlign: "center", marginTop: 8 }}>
        An unexpected error occurred. Please try again.
      </Text>
      <TouchableOpacity
        onPress={() => retry()}
        activeOpacity={0.85}
        style={{
          marginTop: 24,
          height: 48,
          paddingHorizontal: 32,
          backgroundColor: "#0FA6A6",
          borderRadius: 40,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: "#FEFCF0", fontSize: 16, fontWeight: "600" }}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

// Refetch stale queries in the background when the app returns to the
// foreground (RN has no window focus events, so wire AppState manually).
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener("change", (status) => {
    if (Platform.OS !== "web") handleFocus(status === "active");
  });
  return () => subscription.remove();
});
onlineManager.setOnline(true);

// One client for the whole app. gcTime must be >= persister maxAge so cached
// screens survive a full app restart and render instantly from disk.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "weglue-query-cache-v1",
  throttleTime: 2000,
});

// Private Broadcast channels need an explicit, current JWT. This bridge is
// deliberately separate from the Day 10E event handlers: refreshing a token
// only re-authorizes the socket; every access/content decision still refetches
// canonical data through normal RPCs and RLS-backed queries.
function useRealtimeAuthBridge(): void {
  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) void supabase.realtime.setAuth(session.access_token);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        void supabase.realtime.setAuth(session.access_token);
      } else {
        void supabase.realtime.setAuth(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Zain_400Regular,
    Zain_700Bold,
    Zain_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const { session, setSession, setProfile, setOnboarded, setLoading } =
    useAuthStore();

  useRealtimeAuthBridge();

  // ONE decision, identical on iOS and Android (no Platform.OS branch anywhere
  // in this path). A platform-admin Auth identity is not a student: the whole
  // navigator below is replaced by a blocking screen, so no student route ever
  // mounts and no student query ever runs.
  const sessionRoute = resolveMobileSessionRoute(session);
  const isPlatformAdmin = sessionRoute === "platform-admin-blocked";

  // ── Administrator restriction (Day 10B2) ────────────────────────────────
  //
  // Unlike the platform-admin check above, a restriction lives in the DATABASE,
  // so it must be fetched. It is resolved BEFORE the navigator renders, and
  // re-resolved whenever the app returns to the foreground, so a student who is
  // restricted mid-session lands on the shell without needing to relaunch.
  //
  // `access === undefined` means "not yet known". The navigator is held back
  // only while a session exists and the first check is still in flight — a
  // signed-out user is never delayed by it.
  const [access, setAccess] = useState<AccessStatePayload | null | undefined>(undefined);

  const refreshAccess = useCallback(async () => {
    if (!session || !shouldSyncStudentProfile(session)) {
      setAccess(null);
      return;
    }
    try {
      setAccess(await getMyAccessState());
    } catch {
      // Fail OPEN: a network blip must not lock a healthy student out. This is
      // safe because the server is the real control — migration 058 denies a
      // restricted account regardless of what this client believes.
      setAccess(null);
    }
  }, [session]);

  useEffect(() => {
    void refreshAccess();
  }, [refreshAccess]);

  useAccessSynchronization(
    session?.user.id,
    !!session && shouldSyncStudentProfile(session),
    refreshAccess,
  );

  // Fresh check on every foreground, so a restriction applied while the app was
  // backgrounded takes effect on the next resume rather than the next launch.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") void refreshAccess();
    });
    return () => sub.remove();
  }, [refreshAccess]);

  // A live foreground session checks at a bounded interval as well as on
  // resume/auth changes. Realtime is intentionally not a security dependency.
  useEffect(() => {
    if (!session || !shouldSyncStudentProfile(session)) return;
    const timer = setInterval(() => void refreshAccess(), 60_000);
    return () => clearInterval(timer);
  }, [session, refreshAccess]);

  // A database guard denial while a protected React Query request is in flight
  // is an immediate convergence signal, not merely an empty-state response.
  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "error" && looksLikeRestriction(event.query.state.error)) {
      void refreshAccess();
    }
  }), [refreshAccess]);

  const accessRoute = resolveAccessRoute(access ?? null);
  const isRestricted = !!session && !isPlatformAdmin && isRestrictedRoute(accessRoute);
  const accessPending = !!session && !isPlatformAdmin && access === undefined;

  useEffect(() => {
    if (!isRestricted) return;
    // Do not destroy auth here: the limited restricted shell still needs it.
    // Remove every cached protected screen before the navigator is replaced.
    // Do not remove all realtime channels: the account-scoped opaque channel
    // stays mounted so a later canonical restore can reopen this shell.
    void queryClient.cancelQueries();
    void queryClient.clear();
    void AsyncStorage.removeItem("weglue-query-cache-v1");
  }, [isRestricted]);

  // A restricted or not-yet-checked authenticated account must not process a
  // student deep link before the canonical access decision has selected its
  // shell. Public auth links still work while signed out.
  useAuthDeepLink(!accessPending && !isRestricted);
  useInviteDeepLink(!accessPending && !isRestricted);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session && shouldSyncStudentProfile(session)) {
        // Close the navigator before profile hydration on every authenticated
        // startup. The access RPC is the only path that reopens it.
        setAccess(undefined);
        setLoading(true);
      }
      setSession(session);
      if (!session) {
        setLoading(false);
        return;
      }

      // A platform-admin identity has no student profile and must never get
      // one. Skip the disk cache, the profiles fetch and the ensure_profile()
      // repair entirely — the blocking screen renders from the session alone.
      if (!shouldSyncStudentProfile(session)) {
        setProfile(null);
        setOnboarded(false);
        setLoading(false);
        return;
      }

    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // For an explicit login (SIGNED_IN), set isLoading=true before syncing the
      // profile so the navigation guard in index.tsx never evaluates with a partial
      // state (session set, profile still null). Without this, the guard briefly
      // routes to the profile-pic screen before syncProfile resolves — the flash.
      if (event === "SIGNED_IN") setLoading(true);
      if (session && shouldSyncStudentProfile(session)) {
        // TOKEN_REFRESHED is also an access-state checkpoint. Do not reuse a
        // cached protected navigator until it has completed.
        setAccess(undefined);
        setLoading(true);
      }
      setSession(session);
      if (session && !shouldSyncStudentProfile(session)) {
        // Same guard on the live auth-state path (an admin signing in on a
        // device that previously held a student session).
        setProfile(null);
        setOnboarded(false);
        setLoading(false);
        void queryClient.clear();
        void AsyncStorage.removeItem("weglue-query-cache-v1");
      } else if (session) {
        // Profile hydration is deliberately deferred to the access-gated
        // effect below.
      } else {
        setAccess(null);
        setProfile(null);
        setOnboarded(false);
        setLoading(false);
        // Wipe caches so the next account never sees this one's data
        void queryClient.clear();
        void AsyncStorage.removeItem("weglue-query-cache-v1");
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Student profile work begins only after the canonical access decision. This
  // prevents cached Home/Profile data, ordinary profile queries, and any
  // follow-on routing from starting during a restricted-account startup.
  useEffect(() => {
    if (!session || !shouldSyncStudentProfile(session) || access === undefined || isRestricted) return;
    void syncProfile(session.user.id);
  }, [session?.user?.id, access?.state, isRestricted]);

  async function syncProfile(userId: string) {
    // Defense in depth: even if a future caller forgets the guard above, the
    // profiles fetch and the ensure_profile() repair below must never run for
    // a platform-admin identity.
    if (!shouldSyncStudentProfile(useAuthStore.getState().session)) {
      setLoading(false);
      return;
    }
    try {
      const [profileResult, interestsResult] = await timedQuery(
        "startup.syncProfile",
        Promise.all([
          supabase.from("profiles").select("*").eq("id", userId).single(),
          supabase.from("user_interests").select("id").eq("user_id", userId).limit(1),
        ]),
      );
      const onboarded = (interestsResult.data?.length ?? 0) > 0;
      if (profileResult.data) {
        // Onboarding completion is monotonic (it only ever flips to true).
        // A fetch that started BEFORE the completion write can resolve AFTER
        // it — never let that stale snapshot un-complete the profile and
        // bounce the user back into the onboarding flow.
        const current = useAuthStore.getState().profile;
        const staleOnboardingSnapshot =
          current?.id === profileResult.data.id &&
          current?.onboarding_completed === true &&
          profileResult.data.onboarding_completed === false;
        if (!staleOnboardingSnapshot) {
          setProfile(profileResult.data);
          void writeCachedProfile(userId, {
            profile: profileResult.data,
            isOnboarded: onboarded,
          });
        }
      } else if (profileResult.error?.code === "PGRST116") {
        // Profile row missing (e.g. the signup trigger hit a username
        // collision) — repair it server-side instead of stranding the user.
        void clearCachedProfile(userId);
        const { data: repaired } = await supabase.rpc("ensure_profile");
        if (repaired) {
          setProfile(repaired);
          void writeCachedProfile(userId, {
            profile: repaired,
            isOnboarded: onboarded,
          });
        }
      }
      setOnboarded(onboarded);
    } catch {
      // Network failure on background sync — keep showing cached state.
    } finally {
      setLoading(false);
    }
  }

  if (!fontsLoaded) return null;

  // Never restore a cached authenticated navigator until the canonical access
  // state has resolved. A database outage can still fail open after the check,
  // but a normal restricted startup cannot flash Home, Messages, or Profile.
  if (accessPending) {
    return <View style={{ flex: 1, backgroundColor: "#FEFCF0" }} />;
  }

  // Platform-admin identities stop here. Returning the blocking screen INSTEAD
  // of the navigator (not over it) is what guarantees the rest of the
  // requirement: with no <Stack> mounted, index.tsx never runs its routing, no
  // tab/Home/onboarding screen mounts, no recommendation or feed query fires,
  // and the push/realtime hosts below are never created. The only affordance
  // is Sign out; there is no dashboard link of any kind.
  // Restricted accounts stop here, for exactly the reason platform admins do:
  // returning the shell INSTEAD of the navigator means no student route ever
  // mounts, no cached student screen is reachable, and no feed, recommendation
  // or realtime query fires.
  if (isRestricted) {
    return (
      <RestrictedAccountShell
        payload={access ?? null}
        onSignOut={() => tearDownAuthenticatedSession(queryClient, session?.user?.id)}
        onDeleted={async () => {
          await AsyncStorage.setItem("weglue-account-deletion-success", "1");
          await tearDownAuthenticatedSession(queryClient, session?.user?.id);
        }}
      />
    );
  }

  if (isPlatformAdmin) {
    return (
      <PlatformAdminBlock
        email={session?.user?.email ?? null}
        onSignOut={() =>
          tearDownAuthenticatedSession(queryClient, session?.user?.id)
        }
      />
    );
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: 24 * 60 * 60 * 1000,
        // Bumped whenever a persisted query's shape changes: v2 added
        // clubProfile.past_events — a v1 cache entry would crash the Past
        // Events section on first render before refetch.
        buster: "v2",
      }}
    >
      <StudentSynchronizationHost userId={session?.user.id} />
      {/* Screens are auto-registered by expo-router from the file tree.
          Declaring names that don't match real routes (e.g. "profile" when the
          routes are "profile/[userId]", "profile/own", …) makes the navigator
          re-reconcile its children on every state change — which turned the
          sign-out <Redirect> into an infinite update loop (the logout freeze). */}
      <Stack screenOptions={{ headerShown: false }}>
        {/* Intentional sheets — genuinely presented OVER the current screen and
            never used as a navigation container for further destinations.
            Names match real files, so the navigator does not re-reconcile (the
            historical logout-freeze).

            The sidebar is deliberately NOT here any more. It used to be a
            transparentModal route, which made every destination opened from it a
            child of that modal — the partial sheets, the rounded Welcome after
            logout/deletion, the strip of the previous screen. It is now a pure
            overlay (SidebarHost below), so its destinations are ordinary
            full-screen pushes on this opaque stack. */}
        <Stack.Screen
          name="comments/[postId]"
          options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', gestureEnabled: true }}
        />
        <Stack.Screen
          name="share"
          options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', gestureEnabled: true }}
        />
      </Stack>
      {/* Sidebar overlay: layered ABOVE the navigator (tab bar included) but a
          sibling of it, so nothing opened from it is ever nested inside it. */}
      <SidebarHost />
      {/* The single app-wide leave-club confirmation host: exactly one modal
          can exist at a time, so the sole-officer note can never stack on a
          leave confirmation (screens raise requests via requestLeaveClub). */}
      <LeaveClubHost />
      {/* The single app-wide Android camera / photo-preview host. One camera
          implementation for every image entry point; renders nothing on iOS,
          which keeps its existing expo-image-picker flow (screens raise
          requests via pickMedia). */}
      <MediaPickerHost />
      {/* App-wide push + unread-badge wiring. Must live inside the query
          provider; renders nothing. */}
      <PushNotificationsHost />
    </PersistQueryClientProvider>
  );
}
