import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useOnboardingStore } from "@weglue/shared";
import { RESEND_COOLDOWN_SECONDS } from "../../constants/auth";
import { RESET_PASSWORD_REDIRECT, checkSignupStatus } from "../../lib/authFlow";

type EmailState = "idle" | "not_found" | "unverified" | "verified";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { prefillEmail } = useLocalSearchParams<{ prefillEmail?: string }>();
  const { setPendingEmail, setPendingPassword } = useOnboardingStore();

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const [email, setEmail] = useState(prefillEmail ?? "");
  const [loading, setLoading] = useState(false);
  const [emailState, setEmailState] = useState<EmailState>("idle");
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleEmailChange(v: string) {
    setEmail(v);
    setEmailState("idle");
    setSent(false);
    setSubmitError(null);
  }

  /** Sends an unfinished signup back into onboarding with the same email. */
  function continueCreatingAccount() {
    setPendingEmail(email.trim().toLowerCase());
    setPendingPassword("");
    router.replace("/onboarding/interests");
  }

  async function handleSubmit() {
    const trimmed = email.trim().toLowerCase();
    setSubmitError(null);

    if (!trimmed || !trimmed.includes("@")) {
      setEmailState("not_found");
      return;
    }

    setLoading(true);

    // Safe backend probe (rate-limited RPC) — no fake-password login attempts.
    const status = await checkSignupStatus(trimmed);

    if (status.kind === "rate_limited") {
      setLoading(false);
      setSubmitError("Too many attempts. Wait a few minutes and try again.");
      return;
    }
    if (status.kind === "error") {
      setLoading(false);
      setSubmitError("Something went wrong. Please try again.");
      return;
    }

    if (status.emailStatus === "available") {
      setLoading(false);
      setEmailState("not_found");
      return;
    }

    if (status.emailStatus === "exists_unverified") {
      // Not a finished account — a password reset would go nowhere useful.
      setLoading(false);
      setEmailState("unverified");
      return;
    }

    setEmailState("verified");
    setLoading(false);
    await sendResetLink(trimmed);
  }

  async function sendResetLink(trimmed: string) {
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: RESET_PASSWORD_REDIRECT,
    });
    setLoading(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("rate") || msg.includes("too many")) {
        setSubmitError(
          `Rate limited. Wait ${RESEND_COOLDOWN_SECONDS} seconds and try again.`
        );
        setEmailState("idle");
        return;
      }
      setSubmitError("Something went wrong. Please try again.");
      setEmailState("idle");
      return;
    }

    setSent(true);
    router.replace({
      pathname: "/auth/forgot-password-success",
      params: { email: trimmed },
    });
  }

  const isButtonDisabled =
    loading || emailState === "not_found" || emailState === "unverified" || sent;

  const showEmailError = emailState === "not_found" || emailState === "unverified";

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backArrow}>‹</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.brand}>
            <Image
              source={require("../../assets/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.brandName}>We Glue</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.title}>Reset your password</Text>
            <Text style={styles.subtitle}>
              We'll send a reset link to your school email. Check your inbox after tapping send.
            </Text>

            <Text style={styles.label}>School Email</Text>
            <TextInput
              style={[styles.input, showEmailError && styles.inputError]}
              placeholder="you@school.edu"
              placeholderTextColor="rgba(0,0,0,0.3)"
              value={email}
              onChangeText={handleEmailChange}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoFocus
            />

            {emailState === "not_found" && (
              <Text style={styles.errorText}>
                No account under that email.{" "}
                <Text style={styles.errorLink} onPress={continueCreatingAccount}>
                  Create one.
                </Text>
              </Text>
            )}

            {emailState === "unverified" && (
              <Text style={styles.errorText}>
                This account was not finished.{" "}
                <Text style={styles.errorLink} onPress={continueCreatingAccount}>
                  Continue creating your account.
                </Text>
              </Text>
            )}

            {!!submitError && (
              <Text style={styles.errorText}>{submitError}</Text>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, isButtonDisabled && { opacity: 0.45 }]}
              onPress={handleSubmit}
              disabled={isButtonDisabled}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#FEFCF0" />
              ) : (
                <Text style={styles.primaryBtnText}>Send Reset Link</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FEFCF0" },
  topBar: { paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  backArrow: { fontSize: 30, color: "#000", lineHeight: 36 },
  brand: { alignItems: "center", paddingTop: 8, paddingBottom: 24 },
  logo: { width: 70, height: 64, marginBottom: 4 },
  brandName: { fontSize: 30, fontFamily: "Zain_700Bold", color: "#000" },
  // maxWidth + alignSelf: "center" is a no-op on any phone (screens are
  // already narrower than 480) but caps and centers the form on iPad/Android
  // tablet instead of the fields stretching edge-to-edge across the screen.
  form: { paddingHorizontal: 24, paddingBottom: 40, width: "100%", maxWidth: 480, alignSelf: "center" },
  title: {
    fontSize: 26,
    fontFamily: "Zain_700Bold",
    color: "#000",
    marginBottom: 8,
    marginTop: 40,
  },
  subtitle: {
    fontSize: 14,
    color: "#5F5D5D",
    lineHeight: 20,
    marginBottom: 28,
  },
  label: { fontSize: 14, fontWeight: "600", color: "#000", marginBottom: 6 },
  input: {
    backgroundColor: "#FEFCF0",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.2)",
    borderRadius: 10,
    height: 53,
    paddingHorizontal: 16,
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 8,
  },
  inputError: { borderColor: "#F02719" },
  errorText: {
    color: "#F02719",
    fontSize: 13,
    marginBottom: 12,
    marginLeft: 4,
    lineHeight: 18,
  },
  errorLink: {
    color: "#0FA6A6",
    fontSize: 13,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  primaryBtn: {
    height: 52,
    backgroundColor: "#0FA6A6",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  primaryBtnText: { color: "#FEFCF0", fontSize: 16, fontWeight: "600" },
});
