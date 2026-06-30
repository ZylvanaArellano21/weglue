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
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../components/Toast";
import { validateEducationEmail } from "@weglue/shared";
import { RESEND_COOLDOWN_SECONDS } from "../../constants/auth";

export default function LoginScreen() {
  const router = useRouter();
  const { show, ToastComponent } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [unconfirmedEmail, setUnconfirmedEmail] = useState(false);
  const [invalidCredentials, setInvalidCredentials] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const resendCooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startResendCooldown() {
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    if (resendCooldownRef.current) clearInterval(resendCooldownRef.current);
    resendCooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(resendCooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function clearAllErrors() {
    setFieldErrors({});
    setUnconfirmedEmail(false);
    setInvalidCredentials(false);
    setResendSuccess(false);
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
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);

    if (error) {
      const msg = error.message.toLowerCase();
      const code = (error.code ?? "").toLowerCase();

      if (msg.includes("email not confirmed") || code === "email_not_confirmed") {
        setUnconfirmedEmail(true);
        return;
      }

      if (
        code === "invalid_credentials" ||
        code === "user_not_found" ||
        msg.includes("invalid login credentials") ||
        msg.includes("invalid credentials") ||
        msg.includes("user not found")
      ) {
        setInvalidCredentials(true);
        return;
      }

      show("Something went wrong. Please try again.", "error");
      return;
    }

    if (data?.user) {
      // Route to "/" — the index guard handles navigation to (tabs) once the
      // onAuthStateChange in _layout.tsx has synced the profile. This avoids
      // the race where (tabs)/_layout evaluates before isLoading is set to true
      // by the SIGNED_IN event, causing a flash of the profile-pic screen.
      router.replace("/");
    }
  }

  async function handleResend() {
    if (resendLoading || resendCooldown > 0) return;
    setResendLoading(true);
    setResendSuccess(false);

    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: "weglue://auth/confirmed" },
    });

    setResendLoading(false);
    startResendCooldown();

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("not found") || msg.includes("user not found")) {
        show("No account found for this email. Please sign up first.", "error");
      } else {
        show(`Couldn't send verification email. Wait ${RESEND_COOLDOWN_SECONDS} seconds and try again.`, "error");
      }
      return;
    }

    setResendSuccess(true);
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
            <Text style={styles.label}>School Email</Text>
            <TextInput
              style={[styles.input, !!fieldErrors.email && styles.inputError]}
              placeholder="you@school.edu"
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

            {invalidCredentials && (
              <Text style={styles.generalError}>
                No account found with these credentials. Double-check your email and password.
              </Text>
            )}

            {unconfirmedEmail && (
              <View style={styles.unconfirmedBox}>
                <Text style={styles.unconfirmedText}>
                  You haven't verified this email.{" "}
                  {resendSuccess ? (
                    <Text style={styles.resendSuccessText}>Email sent!</Text>
                  ) : resendLoading ? (
                    <Text style={styles.resendLoadingText}>Sending…</Text>
                  ) : resendCooldown > 0 ? (
                    <Text style={styles.resendLoadingText}>Resend in {resendCooldown}s</Text>
                  ) : (
                    <Text style={styles.resendLink} onPress={handleResend}>
                      Verify now
                    </Text>
                  )}
                </Text>
              </View>
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

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => show("Coming soon!", "info")}
              activeOpacity={0.85}
            >
              <View style={styles.msLogo}>
                <View style={[styles.msSquare, { backgroundColor: "#F25022" }]} />
                <View style={[styles.msSquare, { backgroundColor: "#7FBA00" }]} />
                <View style={[styles.msSquare, { backgroundColor: "#00A4EF" }]} />
                <View style={[styles.msSquare, { backgroundColor: "#FFB900" }]} />
              </View>
              <Text style={styles.secondaryBtnText}>Continue with Microsoft</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.replace("/onboarding/interests")}
              style={{ alignSelf: "center", marginTop: 20 }}
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
  form: { paddingHorizontal: 24, paddingBottom: 40 },
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
  unconfirmedBox: {
    marginTop: 10,
    marginBottom: 4,
  },
  unconfirmedText: {
    fontSize: 13,
    color: "#F02719",
    lineHeight: 18,
    marginBottom: 6,
  },
  resendLink: {
    fontSize: 13,
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
  divider: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(0,0,0,0.12)" },
  dividerText: { marginHorizontal: 12, fontSize: 12, color: "#5F5D5D" },
  secondaryBtn: {
    height: 52,
    backgroundColor: "#fff",
    borderRadius: 40,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.2)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  msLogo: { flexDirection: "row", flexWrap: "wrap", width: 18, height: 18, gap: 1.5, marginRight: 2 },
  msSquare: { width: 7.5, height: 7.5 },
  secondaryBtnText: { fontSize: 16, fontWeight: "600", color: "#000" },
  footerText: { fontSize: 12, color: "#5F5D5D" },
});
