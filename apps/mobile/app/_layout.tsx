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
import { AppState, Platform } from "react-native";
import { useAuthStore } from "@weglue/shared";
import { supabase } from "../lib/supabase";
import { useAuthDeepLink } from "../hooks/useAuthDeepLink";
import { timedQuery } from "../lib/timedQuery";
import {
  clearCachedProfile,
  readCachedProfile,
  writeCachedProfile,
} from "../lib/profileCache";

SplashScreen.preventAutoHideAsync();

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
        // Profile row definitively gone — drop the stale disk cache. On any
        // other error keep the cached/previous profile instead of wiping it
        // and bouncing the user back to onboarding.
        void clearCachedProfile(userId);
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
        buster: "v1",
      }}
    >
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="home" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="saved-events" />
        <Stack.Screen name="account-center" />
        <Stack.Screen name="privacy-center" />
      </Stack>
    </PersistQueryClientProvider>
  );
}
