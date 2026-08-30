import { useEffect, useRef, useState } from "react";
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
import { useToast } from "../../components/Toast";
import { useOnboardingStore, validateEducationEmail } from "@weglue/shared";
import {
  checkSignupStatus,
  clearPendingSignup,
  sendVerificationEmail,
  setPendingSignupEmail,
} from "../../lib/authFlow";

type LoginError =
  | null
  | "wrong_password"
  | "no_account"
  // Credentials are VALID; the email is simply not verified yet. Only ever set
  // from GoTrue's email_not_confirmed, which is issued after the password has
  // already been checked — so this state can never leak account existence for
  // a wrong password.
  | "unverified"
  | "generic";

export default function LoginScreen() {
  const router = useRouter();
  const { prefillEmail, verified } = useLocalSearchParams<{
    prefillEmail?: string;
    verified?: string;
  }>();
  const { show, ToastComponent } = useToast();
  const {
    setPendingEmail,
    setPendingPassword,
    reset: resetOnboarding,
  } = useOnboardingStore();

  const [email, setEmail] = useState(prefillEmail ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loginError, setLoginError] = useState<LoginError>(null);
  const [showVerifiedBanner] = useState(verified === "1");
  const [verifying, setVerifying] = useState(false);
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  function clearAllErrors() {
    setFieldErrors({});
    setLoginError(null);
  }

  /**
   * "Verify now" — sends exactly ONE verification email, opens the shared 60s
   * cooldown, then opens Confirm Email, which adopts that same cooldown rather
   * than starting a fresh one. Double taps are swallowed by verifyingRef.
   */
  async function handleVerifyNow() {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setVerifying(true);

    const normalizedEmail = email.trim().toLowerCase();
    try {
      const result = await sendVerificationEmail(normalizedEmail);

      if (!result.ok && "message" in result) {
        show(result.message, "error");
        return;
      }

      // Sent, or a cooldown from a very recent send is already running — either
      // way Confirm Email is the right destination and it will show the
      // remaining countdown plus the success state.
      await setPendingSignupEmail(normalizedEmail);
      router.push({
        pathname: "/auth/verify-email",
        params: { email: normalizedEmail },
      });
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  }

  /** Both "Create an account" entry points start the survey at Interests. */
  function startNewAccount() {
    setPendingEmail(email.trim().toLowerCase());
    setPendingPassword("");
    router.replace("/onboarding/interests");
  }

  function handleEmailChange(v: string) {
    setEmail(v);
    clearAllErrors();
  }

  function handlePasswordChange(v: string) {
    setPassword(v);
    clearAllErrors();
  }

  async function handleLogin() {
    const newFieldErrors: { email?: string; password?: string } = {};

    if (!email.trim()) {
      newFieldErrors.email = "Email is required.";
    } else {
      const emailCheck = validateEducationEmail(email.trim());
      if (!emailCheck.valid) newFieldErrors.email = emailCheck.reason!;
    }
    if (!password) {
      newFieldErrors.password = "Password is required.";
    }

    if (Object.keys(newFieldErrors).length > 0) {
      setFieldErrors(newFieldErrors);
      return;
    }

    setLoading(true);
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      const code = (error.code ?? "").toLowerCase();

      if (code === "over_request_rate_limit") {
        // Per-IP request throttle (Supabase shares this bucket between sign-up
        // and sign-in). Hits when many devices log in from one public IP right
        // after a classroom sign-up rush. It clears quickly; the password is
        // still in the field, so a retry works.
        setLoading(false);
        show("Too many sign-ins from your network right now. Wait a moment and try again.", "error");
        return;
      }

      if (msg.includes("email not confirmed") || code === "email_not_confirmed") {
        // GoTrue validates the password BEFORE issuing this error, so the
        // account exists, the password is right, and verification is the only
        // blocker. That is exactly — and only — when we may say so.
        setLoading(false);
        setLoginError("unverified");
        return;
      }

      if (
        code === "invalid_credentials" ||
        code === "user_not_found" ||
        msg.includes("invalid login credentials") ||
        msg.includes("invalid credentials") ||
        msg.includes("user not found")
      ) {
        // GoTrue hides whether the account exists — ask our rate-limited
        // backend probe so we can show the right message.
        const status = await checkSignupStatus(normalizedEmail);
        setLoading(false);
        if (status.kind === "ok") {
          if (status.emailStatus === "available") {
            setLoginError("no_account");
          } else {
            // The account exists but the password was rejected. Whether it is
            // verified or not, the blocker here is the password — say only
            // that, and never surface the unverified state (which would
            // confirm the account exists to someone guessing passwords).
            setLoginError("wrong_password");
          }
        } else {
          setLoginError("generic");
        }
        return;
      }

      setLoading(false);
      show("Something went wrong. Please try again.", "error");
      return;
    }

    setLoading(false);
    if (data?.user) {
      // Wipe any stale signup-in-progress state (marker + pending
      // username/email/password) so it can never leak into this account.
      resetOnboarding();
      await clearPendingSignup();
      // Route to "/" — the index guard handles navigation to (tabs) once the
      // onAuthStateChange in _layout.tsx has synced the profile. This avoids
      // the race where (tabs)/_layout evaluates before isLoading is set to true
      // by the SIGNED_IN event, causing a flash of the profile-pic screen.
      router.replace("/");
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {ToastComponent}
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
            {/* Always Welcome — never router.back(), which could reveal a
                half-completed signup form or a deleted onboarding screen. */}
            <TouchableOpacity
              onPress={() => router.replace("/welcome")}
              style={styles.backBtn}
            >
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
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, !!fieldErrors.email && styles.inputError]}
              placeholder="yourname@email.com"
              placeholderTextColor="rgba(0,0,0,0.3)"
              value={email}
              onChangeText={handleEmailChange}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            {!!fieldErrors.email && (
              <Text style={styles.fieldError}>{fieldErrors.email}</Text>
            )}

            <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
            <View style={[styles.passwordRow, !!fieldErrors.password && styles.inputError]}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter your password"
                placeholderTextColor="rgba(0,0,0,0.3)"
                value={password}
                onChangeText={handlePasswordChange}
                secureTextEntry={!showPassword}
                autoComplete="current-password"
              />
              <TouchableOpacity onPress={() => setShowPassword((v) => !v)}>
                <Text style={styles.showToggle}>{showPassword ? "Hide" : "Show"}</Text>
              </TouchableOpacity>
            </View>
            {!!fieldErrors.password && (
              <Text style={styles.fieldError}>{fieldErrors.password}</Text>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 24 }]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#FEFCF0" />
              ) : (
                <Text style={styles.primaryBtnText}>Log in</Text>
              )}
            </TouchableOpacity>

            {showVerifiedBanner && (
              <Text style={styles.verifiedBanner}>
                Your email is verified. Log in to continue.
              </Text>
            )}

            {loginError === "wrong_password" && (
              <Text style={styles.generalError}>Incorrect password.</Text>
            )}

            {loginError === "no_account" && (
              <Text style={styles.generalError}>
                No account found with that email.{" "}
                <Text style={styles.resendLink} onPress={startNewAccount}>
                  Create one.
                </Text>
              </Text>
            )}

            {loginError === "unverified" && (
              <Text style={styles.generalError}>
                You haven&apos;t verified your email.{" "}
                {verifying ? (
                  <Text style={styles.resendLink}>Sending…</Text>
                ) : (
                  <Text style={styles.resendLink} onPress={handleVerifyNow}>
                    Verify now
                  </Text>
                )}
              </Text>
            )}

            {loginError === "generic" && (
              <Text style={styles.generalError}>
                Incorrect email or password.
              </Text>
            )}

            <TouchableOpacity
              style={{ alignSelf: "center", marginBottom: 24 }}
              onPress={() =>
                router.push({
                  pathname: "/auth/forgot-password",
                  params: { prefillEmail: email },
                })
              }
            >
              <Text style={styles.tealLink}>Forgot Password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={startNewAccount}
              style={{ alignSelf: "center" }}
            >
              <Text style={styles.footerText}>
                New here?{" "}
                <Text style={styles.tealLink}>Create an account</Text>
              </Text>
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
  },
  inputError: { borderColor: "#F02719" },
  fieldError: { color: "#F02719", fontSize: 12, marginTop: 4, marginLeft: 4 },
  generalError: {
    color: "#F02719",
    fontSize: 13,
    marginTop: 10,
    marginBottom: 4,
    lineHeight: 18,
  },
  verifiedBanner: {
    fontSize: 13,
    color: "#0FA6A6",
    fontWeight: "600",
    marginTop: 2,
    marginBottom: 8,
    lineHeight: 18,
  },
  resendLink: {
    fontSize: 13,
    color: "#0FA6A6",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  passwordRow: {
    backgroundColor: "#FEFCF0",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.2)",
    borderRadius: 10,
    height: 53,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  passwordInput: { flex: 1, fontSize: 14, fontWeight: "600", color: "#000" },
  showToggle: { fontSize: 12, color: "#0FA6A6", fontWeight: "600" },
  primaryBtn: {
    height: 52,
    backgroundColor: "#0FA6A6",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  primaryBtnText: { color: "#FEFCF0", fontSize: 16, fontWeight: "600" },
  tealLink: { fontSize: 14, color: "#0FA6A6", fontWeight: "600", textDecorationLine: "underline" },
  footerText: { fontSize: 12, color: "#5F5D5D" },
});
