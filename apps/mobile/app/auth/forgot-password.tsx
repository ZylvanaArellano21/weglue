import { useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { RESEND_COOLDOWN_SECONDS } from "../../constants/auth";

type EmailState = "idle" | "not_found" | "unverified" | "verified";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { prefillEmail } = useLocalSearchParams<{ prefillEmail?: string }>();

  const [email, setEmail] = useState(prefillEmail ?? "");
  const [loading, setLoading] = useState(false);
  const [emailState, setEmailState] = useState<EmailState>("idle");
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // State B: Verify Now cooldown
  const [verifyCooldown, setVerifyCooldown] = useState(0);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown() {
    setVerifyCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setVerifyCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function handleEmailChange(v: string) {
    setEmail(v);
    setEmailState("idle");
    setSent(false);
    setVerifySuccess(false);
    setVerifyError(null);
    setSubmitError(null);
  }

  async function handleSubmit() {
    const trimmed = email.trim().toLowerCase();
    setSubmitError(null);

    if (!trimmed) {
      setEmailState("not_found");
      return;
    }

    if (!trimmed.includes(".edu")) {
      setEmailState("not_found");
      return;
    }

    setLoading(true);

    // Probe: signInWithPassword with an invalid password reveals account state
    // without triggering any side effects visible to the user.
    const { error: probeError } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password: `__probe_${Date.now()}__`,
    });

    setLoading(false);

    if (!probeError) {
      // Extremely unlikely (would need a valid password match), treat as verified
      setEmailState("verified");
      await sendResetLink(trimmed);
      return;
    }

    const probeCode = (probeError.code ?? "").toLowerCase();
    const probeMsg = probeError.message.toLowerCase();

    if (probeCode === "email_not_confirmed" || probeMsg.includes("email not confirmed")) {
      // State B: user exists but is unverified
      setEmailState("unverified");
      return;
    }

    if (
      probeCode === "user_not_found" ||
      probeMsg.includes("user not found") ||
      probeMsg.includes("no user found")
    ) {
      // State A: no account for this email
      setEmailState("not_found");
      return;
    }

    // invalid_credentials = user exists with wrong password = verified → State C
    setEmailState("verified");
    await sendResetLink(trimmed);
  }

  async function sendResetLink(trimmed: string) {
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: "https://weglue.app/auth/reset-password",
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

  async function handleVerifyNow() {
    if (verifyLoading || verifyCooldown > 0) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setVerifyLoading(true);
    setVerifySuccess(false);
    setVerifyError(null);

    const { error } = await supabase.auth.resend({
      type: "signup",
      email: trimmed,
      options: { emailRedirectTo: "weglue://auth/confirmed" },
    });

    setVerifyLoading(false);
    startCooldown();

    if (error) {
      setVerifyError(
        `Couldn't send. Wait ${RESEND_COOLDOWN_SECONDS} seconds and try again.`
      );
    } else {
      setVerifySuccess(true);
    }
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
                This email isn't associated with any account. Please create one.
              </Text>
            )}

            {emailState === "unverified" && (
              <View>
                <Text style={styles.errorText}>
                  This email hasn't been verified yet. Please verify it first.
                </Text>

                {verifySuccess && (
                  <Text style={styles.verifySuccessText}>
                    Verification email sent! Check your inbox.
                  </Text>
                )}

                {verifyError && (
                  <Text style={styles.errorText}>{verifyError}</Text>
                )}

                <TouchableOpacity
                  style={[
                    styles.verifyNowBtn,
                    (verifyLoading || verifyCooldown > 0) && styles.verifyNowBtnDisabled,
                  ]}
                  onPress={handleVerifyNow}
                  disabled={verifyLoading || verifyCooldown > 0}
                  activeOpacity={0.85}
                >
                  {verifyLoading ? (
                    <ActivityIndicator color="#FEFCF0" size="small" />
                  ) : (
                    <Text style={styles.verifyNowBtnText}>
                      {verifyCooldown > 0
                        ? `Resend (${verifyCooldown}s)`
                        : verifySuccess
                        ? "Resend Verification Email"
                        : "Verify Now"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
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
  form: { paddingHorizontal: 24, paddingBottom: 40 },
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
  verifySuccessText: {
    color: "#16A34A",
    fontSize: 13,
    marginBottom: 8,
    marginLeft: 4,
  },
  verifyNowBtn: {
    height: 44,
    backgroundColor: "#0FA6A6",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  verifyNowBtnDisabled: { backgroundColor: "#CCCCCC" },
  verifyNowBtnText: { color: "#FEFCF0", fontSize: 14, fontWeight: "600" },
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
