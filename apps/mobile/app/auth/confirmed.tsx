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
  const handledRef = useRef(false);

  // Fallback: if no session arrives within SESSION_TIMEOUT_MS the tokens
  // couldn't be parsed (bad link, expired, etc.) — send the user to login.
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      if (handledRef.current) return;
      show("Couldn't sign you in. Please log in.", "error");
      router.replace("/auth/login");
    }, SESSION_TIMEOUT_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Fired by onAuthStateChange in _layout.tsx once useAuthDeepLink calls
  // setSession() with the tokens from the deep link fragment.
  // We do NOT check email_confirmed_at here — it is a DB column, not a JWT
  // claim, so it is always null right after setSession fires onAuthStateChange.
  // Valid tokens from the email confirmation flow mean the user is confirmed.
  useEffect(() => {
    if (!session || handledRef.current) return;

    handledRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
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
