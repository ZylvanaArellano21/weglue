import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuthStore } from "@weglue/shared";
import { useToast } from "../../components/Toast";
import { clearPendingSignup } from "../../lib/authFlow";
import { authLinkRecentlyConsumed } from "../../hooks/useAuthDeepLink";

const SESSION_TIMEOUT_MS = 12_000;

export default function AuthConfirmedScreen() {
  const router = useRouter();
  const { session } = useAuthStore();
  const { show, ToastComponent } = useToast();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledRef = useRef(false);

  // Our own marker on the redirect URL (mirrors the web /auth/confirm page),
  // not Supabase's own `type` — set by accountService.ts's changeEmail() so
  // this screen never has to guess whether the deep link that opened it came
  // from Account Center or from signup.
  const { flow } = useLocalSearchParams<{ flow?: string }>();
  const isEmailChange = flow === "email_change";
  const [emailChangeState, setEmailChangeState] = useState<
    "pending" | "confirmed" | "timeout"
  >("pending");

  // Fallback: if no session arrives within SESSION_TIMEOUT_MS the tokens
  // couldn't be parsed (bad link, expired, etc.). Signup sends the user to
  // the confirm-email screen to resend; that screen is signup-specific, so an
  // email-change link instead shows an inline message with no navigation.
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      if (handledRef.current) return;
      if (isEmailChange) {
        setEmailChangeState("timeout");
        return;
      }
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

    // Stale / already-consumed SIGNUP link opened while the user is already
    // signed in: useAuthDeepLink did not consume any credential (no
    // `authLinkRecentlyConsumed`), so this session is the user's own
    // pre-existing one, not a throwaway verification session. Signing it out
    // here is the unexpected-logout path — instead just send them into the
    // app. A genuine first-time verification always consumes a credential,
    // and email-change is handled below, so neither is affected.
    if (!isEmailChange && !authLinkRecentlyConsumed()) {
      router.replace("/(tabs)");
      return;
    }

    // Email-change (Account Center): the user is presumably already using
    // the app under their existing session — never sign them out or bounce
    // them to Login for this. Just show the confirmed state in place.
    if (isEmailChange) {
      setEmailChangeState("confirmed");
      return;
    }

    // Signup: this session exists ONLY to consume the verification token —
    // it must never itself log the user in (see the notification-permission
    // gating note this screen has always followed). Sign it back out and
    // hand off to Login, prefilled, exactly as before.
    clearPendingSignup();
    const email = session.user.email ?? "";

    // Local scope only (task 7): this is a throwaway verification session on
    // THIS device. The default (no scope = 'global') signOut revokes the
    // refresh token for every OTHER signed-in device/browser on this account
    // too — a plain signup-confirmation tap would silently log the user out
    // of a session they already had open elsewhere.
    void supabase.auth.signOut({ scope: "local" }).finally(() => {
      router.replace({
        pathname: "/auth/login",
        params: { prefillEmail: email, verified: "1" },
      });
    });
  }, [session, isEmailChange]);

  if (isEmailChange && emailChangeState !== "pending") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#FEFCF0",
          paddingHorizontal: 32,
        }}
      >
        {ToastComponent}
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            borderWidth: 2,
            borderColor: emailChangeState === "confirmed" ? "#0FA6A6" : "#F02719",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
          }}
        >
          <Text
            style={{
              fontSize: 32,
              color: emailChangeState === "confirmed" ? "#0FA6A6" : "#F02719",
              fontWeight: "700",
            }}
          >
            {emailChangeState === "confirmed" ? "✓" : "!"}
          </Text>
        </View>
        <Text
          style={{
            fontSize: 22,
            fontWeight: "700",
            color: "#000",
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          {emailChangeState === "confirmed"
            ? "Your email has been confirmed"
            : "Couldn't confirm from this link"}
        </Text>
        <Text style={{ fontSize: 14, color: "#5F5D5D", textAlign: "center" }}>
          {emailChangeState === "confirmed"
            ? "You can go back to We Glue now."
            : "Go back to We Glue and try changing your email again from Account Center."}
        </Text>
      </View>
    );
  }

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
