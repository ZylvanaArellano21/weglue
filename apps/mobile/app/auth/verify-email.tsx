import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useOnboardingStore } from "@weglue/shared";
import { supabase } from "../../lib/supabase";

const PENDING_EMAIL_KEY = "@weglue/pending_confirmation_email";
const RESEND_COOLDOWN_SECONDS = 60;
const SUCCESS_MESSAGE_DURATION_MS = 5000;
const RESEND_SUCCESS_MESSAGE =
  "Confirmation email resent. Check your inbox and spam folder.";
const RESEND_ERROR_MESSAGE =
  "We couldn't resend the email. Wait a moment and try again.";

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const { pendingEmail } = useOnboardingStore();

  const [email, setEmail] = useState(emailParam ?? "");
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resendStatus, setResendStatus] = useState<"success" | "error" | null>(null);
  const [isVerified, setIsVerified] = useState(false);

  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted email if not passed as param
  useEffect(() => {
    const paramEmail = emailParam?.trim().toLowerCase();
    if (paramEmail) {
      setEmail(paramEmail);
      AsyncStorage.setItem(PENDING_EMAIL_KEY, paramEmail);
      return;
    }

    AsyncStorage.getItem(PENDING_EMAIL_KEY).then((stored) => {
      const storedEmail = stored?.trim().toLowerCase();
      const fallbackEmail =
        storedEmail || pendingEmail.trim().toLowerCase() || "";

      if (fallbackEmail) {
        setEmail(fallbackEmail);
        AsyncStorage.setItem(PENDING_EMAIL_KEY, fallbackEmail);
      }
    });
  }, [emailParam, pendingEmail]);

  const checkVerification = useCallback(async () => {
    // refreshSession fetches current state from Supabase servers — necessary
    // for cold-start after the user verified in a browser while the app was
    // closed, so the locally cached session's email_confirmed_at is stale.
    await supabase.auth.refreshSession();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user.email_confirmed_at) {
      setIsVerified(true);
    }
  }, []);

  // Check on mount in case they return to this screen after already verifying
  useEffect(() => {
    checkVerification();
  }, [checkVerification]);

  // On foreground return: refresh session then check verification — this is
  // what enables the Next button automatically after they tap the email link.
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;
      await supabase.auth.refreshSession();
      await checkVerification();
    });
    return () => {
      sub.remove();
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, [checkVerification]);

  async function handleResend() {
    if (!email || cooldown > 0 || resending) return;
    const userEmail = email.trim().toLowerCase();
    if (!userEmail) return;

    setResending(true);
    setResendStatus(null);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }
    startCooldown(RESEND_COOLDOWN_SECONDS);

    try {
      setEmail(userEmail);
      await AsyncStorage.setItem(PENDING_EMAIL_KEY, userEmail);
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: userEmail,
        options: { emailRedirectTo: "weglue://auth/confirmed" },
      });

      if (error) throw error;

      setResendStatus("success");
      feedbackTimeoutRef.current = setTimeout(() => {
        setResendStatus(null);
        feedbackTimeoutRef.current = null;
      }, SUCCESS_MESSAGE_DURATION_MS);
    } catch {
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
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.nextRow}>
          <Text style={styles.alreadyText}>Already verified it?</Text>
          <TouchableOpacity
            style={[styles.nextBtn, !isVerified && styles.nextBtnDisabled]}
            onPress={() => router.replace("/onboarding/profile-pic")}
            disabled={!isVerified}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>Next</Text>
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

        {resendStatus === "success" && (
          <Text style={styles.feedbackSuccess}>{RESEND_SUCCESS_MESSAGE}</Text>
        )}
        {resendStatus === "error" && (
          <Text style={styles.feedbackError}>{RESEND_ERROR_MESSAGE}</Text>
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
    fontSize: 13,
    color: "#F02719",
    textAlign: "center",
    fontWeight: "500",
  },
});
