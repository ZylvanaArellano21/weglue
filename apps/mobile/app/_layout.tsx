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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { useAuthStore } from "@weglue/shared";
import { supabase } from "../lib/supabase";
import { useAuthDeepLink } from "../hooks/useAuthDeepLink";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60 * 1000, retry: 1 } },
      })
  );

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
      if (session) {
        await syncProfile(session.user.id);
      }
      setLoading(false);
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
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function syncProfile(userId: string) {
    try {
      const [profileResult, interestsResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).single(),
        supabase.from("user_interests").select("id").eq("user_id", userId).limit(1),
      ]);
      if (profileResult.data) setProfile(profileResult.data);
      setOnboarded((interestsResult.data?.length ?? 0) > 0);
    } finally {
      setLoading(false);
    }
  }

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}
