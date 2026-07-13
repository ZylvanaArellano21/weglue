import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useOnboardingStore } from "@weglue/shared";
import { RESEND_COOLDOWN_SECONDS } from "../../constants/auth";
import {
  getPendingSignupEmail,
  getResendCooldownRemaining,
  sendVerificationEmail,
  setPendingSignupEmail,
} from "../../lib/authFlow";

const SUCCESS_MESSAGE_DURATION_MS = 8000;
const RESEND_SUCCESS_MESSAGE =
  "Verification email sent. Check your inbox — and your spam/junk folder.";

/**
 * Confirm Email — the last step of signup.
 *
 * There is deliberately NO way back from here into the signup flow: no back
 * arrow, no iOS swipe-back (gestureEnabled: false in auth/_layout), and Android
 * hardware Back is swallowed. Going "back" could only lead to a half-finished
 * account-creation form or one of the deleted onboarding screens.
 *
 * The screen also makes no promise about being moved along automatically —
 * after verifying, the user comes back and taps Log in.
 */
export default function VerifyEmailScreen() {
  const router = useRouter();
  const { email: emailParam, expired } = useLocalSearchParams<{
    email?: string;
    expired?: string;
  }>();
  const { pendingEmail } = useOnboardingStore();

  const [email, setEmail] = useState(emailParam ?? "");
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resendStatus, setResendStatus] = useState<"success" | "error" | null>(null);
  const [resendErrorMessage, setResendErrorMessage] = useState("");
  const [expiredNotice, setExpiredNotice] = useState(expired === "1");

  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards the gap between the tap and `resending` actually rendering, so a
  // fast double tap can't fire two sends.
  const sendingRef = useRef(false);

  // Resolve which email this screen is for.
  useEffect(() => {
    const paramEmail = emailParam?.trim().toLowerCase();
    if (paramEmail) {
      setEmail(paramEmail);
      void setPendingSignupEmail(paramEmail);
      return;
    }

    void getPendingSignupEmail().then((stored) => {
      const fallbackEmail = stored || pendingEmail.trim().toLowerCase() || "";
      if (fallbackEmail) {
        setEmail(fallbackEmail);
        void setPendingSignupEmail(fallbackEmail);
      }
    });
  }, [emailParam, pendingEmail]);

  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Adopt any cooldown already running — e.g. "Verify now" on the Login screen
  // just sent an email and navigated here. The countdown continues; it does not
  // restart, and the user is not handed a second send.
  useEffect(() => {
    if (!email) return;
    void getResendCooldownRemaining(email).then((remaining) => {
      if (remaining > 0) {
        startCooldown(remaining);
        // Arriving mid-cooldown means an email was just sent for this address.
        setResendStatus("success");
      }
    });
  }, [email, startCooldown]);

  useEffect(
    () => () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    },
    [],
  );

  // Android hardware Back must not expose the signup form or any deleted
  // onboarding screen. Swallow it entirely (iOS swipe-back is disabled in the
  // auth layout).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  async function handleResend() {
    if (sendingRef.current || resending || cooldown > 0 || !email) return;
    sendingRef.current = true;
    setResending(true);
    setResendStatus(null);
    setExpiredNotice(false);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }

    try {
      const result = await sendVerificationEmail(email);

      if (result.ok) {
        startCooldown(RESEND_COOLDOWN_SECONDS);
        setResendStatus("success");
        feedbackTimeoutRef.current = setTimeout(() => {
          setResendStatus(null);
          feedbackTimeoutRef.current = null;
        }, SUCCESS_MESSAGE_DURATION_MS);
        return;
      }

      if ("cooldown" in result) {
        // Something already sent an email for this address very recently.
        startCooldown(result.cooldown);
        return;
      }

      setResendErrorMessage(result.message);
      setResendStatus("error");
    } finally {
      sendingRef.current = false;
      setResending(false);
    }
  }

  const resendLabel =
    cooldown > 0 ? `Resend again in ${cooldown}s` : "Resend Email";
  const resendDisabled = !email || resending || cooldown > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Image
          source={require("../../assets/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.title}>Confirm your email</Text>

        <Text style={styles.subtitle}>We sent a verification link to</Text>
        <Text style={styles.email}>{email}</Text>

        <Text style={styles.instruction}>
          Tap the link in the email to verify your account. Once verified, return
          here and tap Log in.
        </Text>

        {expiredNotice && (
          <Text style={styles.feedbackError}>
            That confirmation link expired. Tap Resend Email to get a new one.
          </Text>
        )}

        <TouchableOpacity
          style={[styles.resendBtn, resendDisabled && styles.resendBtnDisabled]}
          onPress={handleResend}
          disabled={resendDisabled}
          activeOpacity={0.85}
        >
          {resending ? (
            <ActivityIndicator color="#FEFCF0" />
          ) : (
            <Text style={styles.resendText}>{resendLabel}</Text>
          )}
        </TouchableOpacity>

        {resendStatus === "success" && (
          <Text style={styles.feedbackSuccess}>{RESEND_SUCCESS_MESSAGE}</Text>
        )}
        {resendStatus === "error" && (
          <Text style={styles.feedbackError}>{resendErrorMessage}</Text>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.alreadyText}>
          Already verified it?{" "}
          <Text
            style={styles.loginLink}
            onPress={() =>
              router.replace({
                pathname: "/auth/login",
                params: { prefillEmail: email },
              })
            }
          >
            Log In
          </Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FEFCF0" },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logo: { width: 80, height: 72, marginBottom: 20 },
  title: {
    fontSize: 28,
    fontFamily: "Zain_700Bold",
    color: "#1a1a1a",
    marginBottom: 28,
    textAlign: "center",
  },
  subtitle: { fontSize: 15, color: "#5F5D5D", textAlign: "center" },
  email: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0FA6A6",
    textAlign: "center",
    marginBottom: 20,
  },
  instruction: {
    fontSize: 13,
    color: "#5F5D5D",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 32,
  },
  resendBtn: {
    width: "100%",
    height: 52,
    borderRadius: 40,
    backgroundColor: "#0FA6A6",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  resendBtnDisabled: { backgroundColor: "#CCCCCC", shadowOpacity: 0, elevation: 0 },
  resendText: { fontSize: 16, fontWeight: "600", color: "#FEFCF0" },
  feedbackSuccess: {
    marginTop: 14,
    fontSize: 13,
    color: "#0FA6A6",
    textAlign: "center",
    fontWeight: "500",
    lineHeight: 18,
  },
  feedbackError: {
    marginTop: 14,
    fontSize: 13,
    color: "#F02719",
    textAlign: "center",
    fontWeight: "500",
    lineHeight: 18,
  },
  footer: { paddingBottom: 32, paddingHorizontal: 32, alignItems: "center" },
  alreadyText: { fontSize: 14, fontWeight: "700", color: "#000", textAlign: "center" },
  loginLink: { fontSize: 14, fontWeight: "700", color: "#0FA6A6" },
});
