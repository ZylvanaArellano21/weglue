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
import { useEffect } from "react";
import { AppState, Platform, Text, TouchableOpacity, View } from "react-native";
import { useAuthStore } from "@weglue/shared";
import { supabase } from "../lib/supabase";
import { useAuthDeepLink } from "../hooks/useAuthDeepLink";
import { useInviteDeepLink } from "../hooks/useInviteDeepLink";
import { LeaveClubHost } from "../components/club/LeaveClubHost";
import { timedQuery } from "../lib/timedQuery";
import {
  clearCachedProfile,
  readCachedProfile,
  writeCachedProfile,
} from "../lib/profileCache";

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

  const { setSession, setProfile, setOnboarded, setLoading } = useAuthStore();

  useAuthDeepLink();
  useInviteDeepLink();

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (!session) {
        setLoading(false);
        return;
      }

      // Fast path: hydrate the last known profile from disk so navigation can
      // route to the tabs immediately, then refresh from the network in the
      // background. First launch (no cache) still waits for the real fetch.
      const cached = await readCachedProfile(session.user.id);
      if (cached) {
        setProfile(cached.profile);
        setOnboarded(cached.isOnboarded);
        setLoading(false);
        void syncProfile(session.user.id);
      } else {
        await syncProfile(session.user.id);
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
      setSession(session);
      if (session) {
        await syncProfile(session.user.id);
      } else {
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

  async function syncProfile(userId: string) {
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
        setProfile(profileResult.data);
        void writeCachedProfile(userId, {
          profile: profileResult.data,
          isOnboarded: onboarded,
        });
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
      {/* Screens are auto-registered by expo-router from the file tree.
          Declaring names that don't match real routes (e.g. "profile" when the
          routes are "profile/[userId]", "profile/own", …) makes the navigator
          re-reconcile its children on every state change — which turned the
          sign-out <Redirect> into an infinite update loop (the logout freeze). */}
      <Stack screenOptions={{ headerShown: false }} />
      {/* The single app-wide leave-club confirmation host: exactly one modal
          can exist at a time, so the sole-officer note can never stack on a
          leave confirmation (screens raise requests via requestLeaveClub). */}
      <LeaveClubHost />
    </PersistQueryClientProvider>
  );
}
