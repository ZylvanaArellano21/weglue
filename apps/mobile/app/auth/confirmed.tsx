import { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "@weglue/shared";
import { useToast } from "../../components/Toast";
import { clearPendingSignup } from "../../lib/authFlow";

const SESSION_TIMEOUT_MS = 12_000;

export default function AuthConfirmedScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const { show, ToastComponent } = useToast();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledRef = useRef(false);

  // Fallback: if no session arrives within SESSION_TIMEOUT_MS the tokens
  // couldn't be parsed (bad link, expired, etc.) — send the user to the
  // confirm-email screen where they can resend a fresh link.
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      if (handledRef.current) return;
      show("Couldn't verify from this link. You can resend a new one.", "error");
      router.replace({ pathname: "/auth/verify-email", params: { expired: "1" } });
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
  //
  // Correction 1: this session exists ONLY to consume the verification token
  // (that exchange is what marks email_confirmed_at server-side — the part
  // that must happen here). It must never itself become the user's route into
  // Home: the native notification-permission box may only appear immediately
  // after an explicit email+password Log In, and any auto-authenticated path
  // straight into the tabs would let it fire before that. So we sign the
  // session back out immediately and hand off to Login, prefilled, with the
  // verified banner — the user must type their password and tap Log In to
  // reach Home, exactly once, the same as every other returning session.
  useEffect(() => {
    if (!session || handledRef.current) return;

    handledRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    clearPendingSignup();
    const email = session.user.email ?? "";

    void supabase.auth.signOut().finally(() => {
      router.replace({
        pathname: "/auth/login",
        params: { prefillEmail: email, verified: "1" },
      });
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
