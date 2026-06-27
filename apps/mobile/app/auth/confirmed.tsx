import { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "@weglue/shared";
import { useToast } from "../../components/Toast";

const SESSION_TIMEOUT_MS = 12_000;

export default function AuthConfirmedScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const { show, ToastComponent } = useToast();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fallback: if no session is established within SESSION_TIMEOUT_MS,
  // send the user to login with an error message.
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      show("Couldn't restore your session. Please log in.", "error");
      router.replace("/auth/login");
    }, SESSION_TIMEOUT_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Fired by onAuthStateChange in _layout.tsx after useAuthDeepLink
  // calls supabase.auth.setSession() with the tokens from the deep link.
  useEffect(() => {
    if (!session) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!session.user.email_confirmed_at) {
      show("Email confirmed! Please log in to continue.", "success");
      router.replace("/auth/login");
      return;
    }

    supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (!data?.avatar_url) {
          router.replace("/onboarding/profile-pic");
        } else {
          router.replace("/(tabs)");
        }
      });
  }, [session]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#FEFCF0",
      }}
    >
      {ToastComponent}
      <ActivityIndicator size="large" color="#0FA6A6" />
    </View>
  );
}
