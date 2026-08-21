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
import { useEffect, useRef, useState, useCallback } from "react";
import { AppState, Platform, Text, TouchableOpacity, View } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { useAuthStore } from "@weglue/shared";
import { supabase } from "../lib/supabase";
import { markGenuineSignIn } from "../lib/notifications/pendingRoute";
import { useAuthDeepLink } from "../hooks/useAuthDeepLink";
import { useInviteDeepLink } from "../hooks/useInviteDeepLink";
import { useAccessSynchronization } from "../hooks/useAccessSynchronization";
import { LeaveClubHost } from "../components/club/LeaveClubHost";
import { SidebarHost } from "../components/sidebar/SidebarHost";
import { MediaPickerHost } from "../components/media/MediaPickerHost";
import { PushNotificationsHost } from "../components/notifications/PushNotificationsHost";
import { timedQuery } from "../lib/timedQuery";
import { withTimeout } from "../lib/withTimeout";
import {
  clearCachedProfile,
  readCachedProfile,
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
import { shouldRecoverOnMobileForeground } from "../lib/studentSynchronization";

SplashScreen.preventAutoHideAsync();

// The root stack's anchor route. Kept as a declaration of intent, but note it
// is NOT on its own sufficient — see the <Stack.Screen name="index"> ordering
// note in the navigator below, which is what actually fixes the cold-launch
// destination (verified by experiment in the iOS simulator).
export const unstable_settings = {
  initialRouteName: "index",
};

// Cold-start network calls are bounded so a stalled radio/DNS/TLS handshake
// (the classic cold-start failure mode — neither resolves nor rejects) can
// never hold the navigator hostage indefinitely. Both fail open into the
// same path a real network error already takes.
const ACCESS_CHECK_TIMEOUT_MS = 5000;
const SYNC_PROFILE_TIMEOUT_MS = 4000;

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

// Refetch stale queries when the app returns to the foreground (RN has no
// window focus events, so wire AppState manually).
//
// Fix 9 — a delivered push notification's banner makes iOS briefly report
// `active -> inactive -> active` WITHOUT the app ever truly backgrounding
// (`background` is skipped entirely) — the app stays fully mounted and
// visible the whole time. The naive version of this listener treated every
// transition TO `active` as "the user came back", which called
// `handleFocus(true)` on that banner blip exactly like a real refocus:
// React Query's `refetchOnWindowFocus` then refetched every stale query
// mounted anywhere in the app at once (staleTime is only 60s, so most
// visible screens qualify), which is indistinguishable from the whole app
// reloading — and since every message/photo/event send generates a
// notification, this fired on ordinary activity from ANY other user, not
// just genuine app switches.
//
// A real return from the background always passes through `background`
// first; a banner blip never does. So only `background -> active` counts as
// a genuine refocus worth a refetch storm — `inactive -> active` (the
// banner's own transition) does not.
let lastAppState: string = AppState.currentState;
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener("change", (status) => {
    if (Platform.OS !== "web") {
      if (status === "active") {
        if (lastAppState === "background") handleFocus(true);
      } else {
        handleFocus(false);
      }
    }
    lastAppState = status;
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
      setAccess(await withTimeout(getMyAccessState(), ACCESS_CHECK_TIMEOUT_MS));
    } catch {
      // Fail OPEN: a network blip (or a stalled cold-start request that never
      // settles) must not lock a healthy student out, or hold the navigator
      // hostage. This is safe because the server is the real control —
      // migration 058 denies a restricted account regardless of what this
      // client believes.
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
      if (shouldRecoverOnMobileForeground(status)) void refreshAccess();
    });
    return () => sub.remove();
  }, [refreshAccess]);

  // This is not a broad access poll. It only recovers the one state change
  // that occurs when a timed suspension expires without a database write.
  // Every other access change converges through opaque Realtime plus the
  // focus, reconnect, navigation, auth-refresh, denial and restart paths.
  useEffect(() => {
    const suspendedUntil = access?.state === "suspended" ? access.suspended_until : null;
    const expiryMs = suspendedUntil ? new Date(suspendedUntil).getTime() : Number.NaN;
    if (!session || !shouldSyncStudentProfile(session) || !Number.isFinite(expiryMs) || expiryMs <= Date.now()) return;
    const timer = setInterval(() => void refreshAccess(), 60_000);
    return () => clearInterval(timer);
  }, [access, session, refreshAccess]);

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

  // Detects a genuine sign-in during THIS process's lifetime using only
  // observed session-value transitions — never a single Supabase auth event
  // name (SIGNED_IN can also fire while merely confirming an already-restored
  // session, not just on a real login). The very first session value
  // observed this launch — whether null or already-authenticated — becomes
  // the baseline and is never itself treated as a sign-in. Only a LATER
  // null -> non-null transition, occurring after a null baseline was already
  // established, is a genuine sign-in: a session cannot legitimately appear
  // where we already confirmed there was none without an explicit
  // authentication action. This gates pendingRoute.ts's post-login replay so
  // an ordinary cold launch with an already-persisted session can never
  // consume/replay a route parked for a later, still-pending sign-in.
  const authBaselineRef = useRef<"unset" | "signed-out" | "signed-in">("unset");
  const observeSessionForSignInDetection = useCallback((nextSession: Session | null) => {
    const cameFromSignedOutBaseline = authBaselineRef.current === "signed-out";
    if (authBaselineRef.current !== "unset" && nextSession && cameFromSignedOutBaseline) {
      markGenuineSignIn();
    }
    authBaselineRef.current = nextSession ? "signed-in" : "signed-out";
  }, []);

  // Which user id has already been through the startup access gate in THIS
  // process. Supabase emits TOKEN_REFRESHED on a timer and on every return to
  // the foreground, and it re-emits SIGNED_IN when it merely restores an
  // existing session. Treating each of those as a fresh startup checkpoint is
  // what made the app "constantly load": setLoading(true) makes
  // (tabs)/_layout.tsx render a full-screen spinner INSTEAD of the tabs, and
  // setAccess(undefined) makes accessPending true, which unmounts the entire
  // navigator and replaces it with a blank screen. Every routine token refresh
  // therefore blanked and remounted the whole app, on whatever screen the user
  // was sitting on, and every remount refetched that screen's queries.
  //
  // Gating on "have we already resolved access for this exact user" keeps the
  // real protection intact — a genuine sign-in, an account switch and a cold
  // start all still gate before the navigator renders — while a routine
  // refresh of an already-gated session no longer tears the UI down.
  // Restriction enforcement is unchanged: refreshAccess() still re-runs on
  // every one of these events (its useCallback identity changes with the new
  // session object, re-firing the effect below), and the moment it reports a
  // restriction the isRestricted branch replaces the navigator anyway.
  const accessGatedUserIdRef = useRef<string | null>(null);
  const shouldGateStartupAccess = useCallback((nextSession: Session | null): boolean => {
    const uid = nextSession?.user?.id ?? null;
    if (!uid) {
      accessGatedUserIdRef.current = null;
      return false;
    }
    if (accessGatedUserIdRef.current === uid) return false;
    accessGatedUserIdRef.current = uid;
    return true;
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      observeSessionForSignInDetection(session);
      if (session && shouldSyncStudentProfile(session) && shouldGateStartupAccess(session)) {
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
      observeSessionForSignInDetection(session);
      // A first-time gate for THIS user id (genuine login, account switch, or
      // cold start) — never a routine TOKEN_REFRESHED / re-emitted SIGNED_IN
      // for a session that has already been through it. See the note on
      // accessGatedUserIdRef above: doing this unconditionally blanked and
      // remounted the whole app every few minutes.
      const gateStartup = !!session && shouldSyncStudentProfile(session) && shouldGateStartupAccess(session);
      // For an explicit login, set isLoading=true before syncing the profile so
      // the navigation guard in index.tsx never evaluates with a partial state
      // (session set, profile still null). Without this, the guard briefly
      // routes to the profile-pic screen before syncProfile resolves — the flash.
      if (event === "SIGNED_IN" && gateStartup) setLoading(true);
      if (gateStartup) {
        // Do not reuse a cached protected navigator until the canonical access
        // check for this newly-established session has completed.
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
        // Signed out: forget which user has been gated, so the next sign-in
        // (including the same account signing back in) is gated again.
        accessGatedUserIdRef.current = null;
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

    // Cold start / reopen: hydrate instantly from the last known profile so
    // the navigator never has to block on two fresh round trips just to show
    // what it already showed last time. The network fetch below still runs
    // and quietly reconciles with the real data.
    const cached = await readCachedProfile(userId);
    if (cached) {
      setProfile(cached.profile);
      setOnboarded(cached.isOnboarded);
      setLoading(false);
    }

    try {
      const [profileResult, interestsResult] = await withTimeout(
        timedQuery(
          "startup.syncProfile",
          Promise.all([
            supabase.from("profiles").select("*").eq("id", userId).single(),
            supabase.from("user_interests").select("id").eq("user_id", userId).limit(1),
          ]),
        ),
        SYNC_PROFILE_TIMEOUT_MS,
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
        {/* THE ANCHOR MUST BE DECLARED FIRST.
            Declaring comments/[postId] as the first child made it the stack's
            initial route on a cold launch: the Comments sheet mounted with no
            postId, usePostDetail(undefined) never ran, so `post` stayed
            undefined with isLoading false and the sheet immediately rendered
            "This post is no longer available" over an empty screen — on BOTH
            platforms, which is exactly what users were seeing.
            unstable_settings.initialRouteName alone does NOT override this:
            verified in the iOS simulator, the bug reproduced with the anchor
            set and disappeared the moment this declaration stopped being
            first. Keeping a real, already-registered route (index) at the top
            of the list is what pins the launch destination.
            Only names matching REAL routes may be declared here — a name with
            no matching file makes the navigator re-reconcile its children on
            every state change (the historical logout-freeze loop). */}
        <Stack.Screen name="index" />
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
