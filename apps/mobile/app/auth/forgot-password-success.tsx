import { useEffect, useRef, useState } from "react";
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
import { supabase } from "../../lib/supabase";
import { RESET_PASSWORD_REDIRECT } from "../../lib/authFlow";

export default function ForgotPasswordSuccessScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleResend() {
    if (resendLoading || !email) return;

    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }

    setResendLoading(true);
    setResendSuccess(false);
    setResendError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: RESET_PASSWORD_REDIRECT }
    );

    setResendLoading(false);

    if (error) {
      setResendError("Couldn't resend. Try again.");
      return;
    }

    setResendSuccess(true);
    // Reset after 5 s so the user can resend again if needed
    successTimerRef.current = setTimeout(() => {
      setResendSuccess(false);
      successTimerRef.current = null;
    }, 5000);
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Back arrow */}
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Text style={styles.backArrow}>‹</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Image
          source={require("../../assets/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.tagline}>Connection starts with you</Text>

        {/* Check circle */}
        <View style={styles.checkCircle}>
          <Text style={styles.checkMark}>✓</Text>
        </View>

        <Text style={styles.bodyText}>We sent a password reset link to</Text>
        <Text style={styles.email}>{email}</Text>
        <Text style={styles.bodyText}>
          Check your inbox, spam, and junk folders for the email. Open the
          link to set a new password, then come back and log in.
        </Text>
        <Text style={styles.closeHint}>
          You can close this screen and return to We Glue anytime.
        </Text>

        {/* Resend row */}
        <View style={styles.resendRow}>
          {resendLoading ? (
            <Text style={styles.resendLoadingText}>Sending...</Text>
          ) : resendSuccess ? (
            <Text style={styles.resendSuccessText}>
              Email resent! Check your inbox, spam, and junk folders for the email.
            </Text>
          ) : (
            <View style={styles.resendPromptRow}>
              <Text style={styles.resendPrompt}>Didn't get it? </Text>
              <TouchableOpacity onPress={handleResend} activeOpacity={0.7}>
                <Text style={styles.resendLink}>Resend</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {resendError !== null && !resendSuccess && !resendLoading && (
          <Text style={styles.resendErrorText}>{resendError}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FEFCF0" },
  backBtn: {
    paddingHorizontal: 20,
    paddingTop: 8,
    width: 40,
    height: 48,
    justifyContent: "center",
  },
  backArrow: { fontSize: 30, color: "#000", lineHeight: 36 },
  content: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 32,
    paddingTop: 16,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  logo: { width: 80, height: 72, marginTop: 16, marginBottom: 24 },
  title: {
    fontSize: 26,
    fontFamily: "Zain_700Bold",
    color: "#1a1a1a",
    marginBottom: 4,
    textAlign: "center",
  },
  tagline: {
    fontSize: 13,
    color: "#9CA3AF",
    marginBottom: 32,
    textAlign: "center",
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: "#0FA6A6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
  },
  checkMark: { fontSize: 32, color: "#0FA6A6", fontWeight: "700" },
  bodyText: {
    fontSize: 13,
    color: "#4B5563",
    textAlign: "center",
    lineHeight: 20,
  },
  email: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0FA6A6",
    textAlign: "center",
    marginVertical: 4,
  },
  closeHint: {
    fontSize: 12,
    color: "#9CA3AF",
    textAlign: "center",
    marginTop: 12,
    lineHeight: 18,
  },
  resendRow: {
    marginTop: 16,
    alignItems: "center",
  },
  resendPromptRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  resendPrompt: {
    fontSize: 13,
    color: "#6B7280",
  },
  resendLink: {
    color: "#0FA6A6",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  resendLoadingText: {
    fontSize: 13,
    color: "#9CA3AF",
  },
  resendSuccessText: {
    fontSize: 13,
    color: "#16A34A",
    fontWeight: "600",
    textAlign: "center",
  },
  resendErrorText: {
    fontSize: 12,
    color: "#F02719",
    textAlign: "center",
    marginTop: 6,
  },
});
