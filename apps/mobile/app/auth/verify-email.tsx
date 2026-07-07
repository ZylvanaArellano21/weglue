import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
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
import { supabase } from "../../lib/supabase";
import { RESEND_COOLDOWN_SECONDS } from "../../constants/auth";
import {
  CONFIRM_EMAIL_REDIRECT,
  checkSignupStatus,
  clearPendingSignup,
  friendlyEmailSendError,
  getPendingSignupEmail,
  setPendingSignupEmail,
} from "../../lib/authFlow";

const SUCCESS_MESSAGE_DURATION_MS = 5000;
const RESEND_SUCCESS_MESSAGE =
  "Confirmation email resent. Check your inbox and spam folder.";
const NOT_VERIFIED_MESSAGE =
  "Your email is not verified yet. Please check your email or resend the link.";

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { email: emailParam, expired } = useLocalSearchParams<{
    email?: string;
    expired?: string;
  }>();
  const { pendingEmail, pendingPassword } = useOnboardingStore();

  const [email, setEmail] = useState(emailParam ?? "");
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resendStatus, setResendStatus] = useState<"success" | "error" | null>(null);
  const [resendErrorMessage, setResendErrorMessage] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notVerifiedError, setNotVerifiedError] = useState(false);
  const [expiredNotice, setExpiredNotice] = useState(expired === "1");

  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkingRef = useRef(false);

  // Load persisted email if not passed as param
  useEffect(() => {
    const paramEmail = emailParam?.trim().toLowerCase();
    if (paramEmail) {
      setEmail(paramEmail);
      setPendingSignupEmail(paramEmail);
      return;
    }

    getPendingSignupEmail().then((stored) => {
      const fallbackEmail = stored || pendingEmail.trim().toLowerCase() || "";
      if (fallbackEmail) {
        setEmail(fallbackEmail);
        setPendingSignupEmail(fallbackEmail);
      }
    });
  }, [emailParam, pendingEmail]);

  /**
   * Detects whether the email is verified. With email confirmations ON,
   * signUp() returns NO session, so a session-refresh alone can never see the
   * confirmation. Detection order:
   *   1. An existing session (deep-link / already logged in) — refresh it and
   *      read email_confirmed_at.
   *   2. Silent sign-in with the password from this signup session — succeeds
   *      only once the email is confirmed ("email_not_confirmed" otherwise).
   *   3. Backend status probe (cold start, password no longer in memory).
   * Returns "verified" | "not_verified" | "verified_login_required".
   */
  const detectVerification = useCallback(async (): Promise<
    "verified" | "not_verified" | "verified_login_required" | "unknown"
  > => {
    // 1. Session path (user verified via a deep link that logged them in)
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      if (session.user.email_confirmed_at) return "verified";
      await supabase.auth.refreshSession();
      const { data: { session: fresh } } = await supabase.auth.getSession();
      if (fresh?.user.email_confirmed_at) return "verified";
    }

    const userEmail = email.trim().toLowerCase();
    if (!userEmail) return "unknown";

    // 2. Silent sign-in with the in-memory signup password
    if (pendingPassword) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: pendingPassword,
      });
      if (data?.session) return "verified";
      const code = (error?.code ?? "").toLowerCase();
      const msg = (error?.message ?? "").toLowerCase();
      if (code === "email_not_confirmed" || msg.includes("email not confirmed")) {
        return "not_verified";
      }
      // invalid_credentials etc. — fall through to the status probe.
    }

    // 3. Backend probe — knows verified state but cannot create a session
    const status = await checkSignupStatus(userEmail);
    if (status.kind === "ok") {
      if (status.emailStatus === "exists_verified") {
        return pendingPassword ? "verified" : "verified_login_required";
      }
      if (status.emailStatus === "exists_unverified") return "not_verified";
    }
    return "unknown";
  }, [email, pendingPassword]);

  const runCheck = useCallback(
    async (fromUserTap: boolean) => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      if (fromUserTap) {
        setChecking(true);
        setNotVerifiedError(false);
      }
      try {
        const result = await detectVerification();
        if (result === "verified") {
          setIsVerified(true);
          setNotVerifiedError(false);
          if (fromUserTap) {
            await clearPendingSignup();
            // "/" routes by real state: confirmed + no avatar → profile-pic.
            router.replace("/");
          }
        } else if (result === "verified_login_required") {
          // Verified, but we can't create a session (no password in memory
          // after a cold start) — send them to log in with the email ready.
          await clearPendingSignup();
          router.replace({
            pathname: "/auth/login",
            params: { prefillEmail: email, verified: "1" },
          });
        } else if (fromUserTap) {
          setNotVerifiedError(true);
        }
      } finally {
        checkingRef.current = false;
        if (fromUserTap) setChecking(false);
      }
    },
    [detectVerification, email, router],
  );

  // Check on mount in case they return to this screen after already verifying
  useEffect(() => {
    runCheck(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  // On foreground return (user comes back from their mail app / browser):
  // re-check automatically — this is what turns the Next button teal.
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;
      await runCheck(false);
    });
    return () => {
      sub.remove();
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, [runCheck]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      handleBack();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleBack() {
    // Back returns to the signup form when it's in the stack (normal flow);
    // after a cold-start resume there is no stack, so exit to Welcome. The
    // pending marker is cleared so Welcome doesn't bounce straight back here —
    // the signup flow safely resumes the pending account by email anyway.
    if (router.canGoBack()) {
      router.back();
    } else {
      clearPendingSignup().finally(() => router.replace("/"));
    }
  }

  async function handleNext() {
    if (checking) return;
    if (isVerified) {
      await clearPendingSignup();
      router.replace("/");
      return;
    }
    await runCheck(true);
  }

  async function handleResend() {
    if (!email || cooldown > 0 || resending) return;
    const userEmail = email.trim().toLowerCase();
    if (!userEmail) return;

    setResending(true);
    setResendStatus(null);
    setExpiredNotice(false);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }
    startCooldown(RESEND_COOLDOWN_SECONDS);

    try {
      setEmail(userEmail);
      await setPendingSignupEmail(userEmail);
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: userEmail,
        options: { emailRedirectTo: CONFIRM_EMAIL_REDIRECT },
      });

      if (error) {
        setResendErrorMessage(friendlyEmailSendError(error));
        setResendStatus("error");
        return;
      }

      setResendStatus("success");
      feedbackTimeoutRef.current = setTimeout(() => {
        setResendStatus(null);
        feedbackTimeoutRef.current = null;
      }, SUCCESS_MESSAGE_DURATION_MS);
    } catch {
      setResendErrorMessage(
        `We couldn't resend the email. Wait ${RESEND_COOLDOWN_SECONDS} seconds and try again.`,
      );
      setResendStatus("error");
    } finally {
      setResending(false);
    }
  }

  function startCooldown(seconds: number) {
    setCooldown(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  const resendLabel =
    cooldown > 0 ? `Resend Email (${cooldown}s)` : "Resend Email";

  return (
    <SafeAreaView style={styles.container}>
      {/* Header row */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.nextRow}>
          <Text style={styles.alreadyText}>Already verified it?</Text>
          <TouchableOpacity
            style={[styles.nextBtn, !isVerified && styles.nextBtnDisabled]}
            onPress={handleNext}
            disabled={checking}
            activeOpacity={0.85}
          >
            {checking ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.nextBtnText}>Next</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

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
          Tap the link in the email to verify your account. Once verified, you
          will be taken to the next step automatically.
        </Text>

        {expiredNotice && (
          <Text style={styles.feedbackError}>
            That confirmation link expired. Tap Resend Email to get a new one.
          </Text>
        )}

        <TouchableOpacity
          style={[
            styles.resendBtn,
            (!email || resending || cooldown > 0) && styles.resendBtnDisabled,
          ]}
          onPress={handleResend}
          disabled={!email || resending || cooldown > 0}
          activeOpacity={0.85}
        >
          {resending ? (
            <ActivityIndicator color="#FEFCF0" />
          ) : (
            <Text
              style={[
                styles.resendText,
                cooldown > 0 && styles.resendTextMuted,
              ]}
            >
              {resendLabel}
            </Text>
          )}
        </TouchableOpacity>

        {notVerifiedError && (
          <Text style={styles.feedbackError}>{NOT_VERIFIED_MESSAGE}</Text>
        )}
        {resendStatus === "success" && (
          <Text style={styles.feedbackSuccess}>{RESEND_SUCCESS_MESSAGE}</Text>
        )}
        {resendStatus === "error" && (
          <Text style={styles.feedbackError}>{resendErrorMessage}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FEFCF0" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  backArrow: { fontSize: 30, color: "#000", lineHeight: 36 },
  nextRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  alreadyText: { fontSize: 13, color: "#5F5D5D", fontWeight: "500" },
  nextBtn: {
    backgroundColor: "#0FA6A6",
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  nextBtnDisabled: { backgroundColor: "#CCCCCC" },
  nextBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logo: { width: 80, height: 72, marginBottom: 28 },
  title: {
    fontSize: 28,
    fontFamily: "Zain_700Bold",
    color: "#1a1a1a",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: { fontSize: 15, color: "#5F5D5D", textAlign: "center" },
  email: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0FA6A6",
    textAlign: "center",
    marginBottom: 16,
  },
  instruction: {
    fontSize: 13,
    color: "#5F5D5D",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 36,
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
  resendTextMuted: { color: "#FEFCF0" },
  feedbackSuccess: {
    marginTop: 14,
    fontSize: 13,
    color: "#0FA6A6",
    textAlign: "center",
    fontWeight: "500",
  },
  feedbackError: {
    marginTop: 14,
    marginBottom: 14,
    fontSize: 13,
    color: "#F02719",
    textAlign: "center",
    fontWeight: "500",
  },
});
