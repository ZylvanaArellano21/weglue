import { useState } from "react";
import {
  ActivityIndicator,
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
import { useOnboardingStore, validateEducationEmail } from "@weglue/shared";
import { useToast } from "../../components/Toast";
import { LegalModal } from "../../components/shared/LegalModal";
import {
  CONFIRM_EMAIL_REDIRECT,
  checkSignupStatus,
  friendlyEmailSendError,
  replacePendingSignup,
  setPendingSignupEmail,
} from "../../lib/authFlow";

export default function OnboardingSignupScreen() {
  const router = useRouter();
  const {
    matchCount,
    selectedInterests,
    selectedActivities,
    setPendingUsername,
    setPendingEmail,
    setPendingPassword,
    reset: resetOnboarding,
    pendingUsername,
    pendingEmail,
  } = useOnboardingStore();
  const { show, ToastComponent } = useToast();

  // Restore username/email from store so back navigation preserves the form
  const [username, setUsername] = useState(pendingUsername);
  const [email, setEmail] = useState(pendingEmail);
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Verified duplicate email — rendered as an inline error with a tappable
  // "Try to log in." link instead of a plain string.
  const [emailExistsVerified, setEmailExistsVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState<{ valid: boolean; reason?: string } | null>(null);
  const [legalModalOpen, setLegalModalOpen] = useState(false);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!username.trim()) errs.username = "Username is required.";
    if (!email.trim()) {
      errs.email = "Email is required.";
    } else {
      const emailCheck = validateEducationEmail(email.trim());
      if (!emailCheck.valid) errs.email = emailCheck.reason!;
    }
    if (!password) {
      errs.password = "Password is required.";
    } else if (password.length < 8) {
      errs.password = "Password must be at least 8 characters.";
    } else if (!/[A-Z]/.test(password)) {
      errs.password = "Password must include at least 1 capital letter.";
    } else if (!/[0-9]/.test(password)) {
      errs.password = "Password must include at least 1 number.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleEmailChange(text: string) {
    setEmail(text);
    // Always clear the server-side "already taken" error when the user edits the field
    if (errors.email) setErrors((prev) => { const next = { ...prev }; delete next.email; return next; });
    if (emailExistsVerified) setEmailExistsVerified(false);
    if (!text.includes("@")) {
      setEmailFeedback(null);
      return;
    }
    const result = validateEducationEmail(text.trim());
    setEmailFeedback({ valid: result.valid, reason: result.reason });
  }

  async function handleNext() {
    if (!validate()) return;
    setLoading(true);
    setEmailExistsVerified(false);

    const cleanUsername = username.trim().replace(/^@/, "");
    const normalizedEmail = email.trim().toLowerCase();

    try {
      // 1. Ask the backend what state this email/username is in. This is the
      //    only safe way to distinguish a verified duplicate (block, point to
      //    login) from an abandoned unverified signup (silently resume).
      const status = await checkSignupStatus(normalizedEmail, cleanUsername);

      if (status.kind === "rate_limited") {
        show("Too many attempts. Wait a few minutes and try again.", "error");
        return;
      }
      if (status.kind === "error") {
        show("Something went wrong. Please try again.", "error");
        return;
      }

      if (status.emailStatus === "exists_verified") {
        setEmailExistsVerified(true);
        return;
      }

      if (status.usernameStatus === "taken") {
        setErrors((prev) => ({ ...prev, username: "This username is already taken." }));
        return;
      }

      // 2. Abandoned unverified signup with this email — replace it so the
      //    NEW password/username take effect (GoTrue would otherwise keep the
      //    old ones and only resend the stale confirmation email).
      if (status.emailStatus === "exists_unverified") {
        const replaced = await replacePendingSignup(normalizedEmail);
        if (replaced === "exists_verified") {
          setEmailExistsVerified(true);
          return;
        }
        if (replaced === "rate_limited") {
          show("Too many attempts. Wait a few minutes and try again.", "error");
          return;
        }
        if (replaced === "error") {
          show("Something went wrong. Please try again.", "error");
          return;
        }
        // "replaced" or "not_found" → proceed with a fresh signup below.
      }

      // The survey answers travel in the user's OWN signup metadata. Email
      // confirmation is ON, so there is no session yet — the auth trigger
      // (migration 042) is what persists the interests, the activities and the
      // ranked recommendation batch, server-side, at the moment the account is
      // created. That is what makes the match count survive verifying on a
      // different device, reinstalling, or closing the app before verifying.
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            username: cleanUsername,
            full_name: cleanUsername,
            interests: selectedInterests,
            activities: selectedActivities,
          },
          emailRedirectTo: CONFIRM_EMAIL_REDIRECT,
        },
      });

      if (error) {
        const code = (error.code ?? "").toLowerCase();
        const body = error.message.toLowerCase();
        if (code === "user_already_exists" || body.includes("already registered") || body.includes("already exists")) {
          // Race: became verified between the probe and signUp.
          setEmailExistsVerified(true);
        } else {
          show(friendlyEmailSendError(error), "error");
        }
        return;
      }

      // Supabase returns a fake success (no error, identities=[]) when a
      // verified email already exists, to avoid user enumeration.
      if (!data.session && data.user?.identities?.length === 0) {
        setEmailExistsVerified(true);
        return;
      }

      setPendingUsername(cleanUsername);
      setPendingEmail(normalizedEmail);
      setPendingPassword(password);
      await setPendingSignupEmail(normalizedEmail);

      // Confirm Email is the only next step, whether or not a session came
      // back. There is no profile-picture step and no club catalog any more.
      router.push({
        pathname: "/auth/verify-email",
        params: { email: normalizedEmail, from: "signup" },
      });
    } finally {
      setLoading(false);
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
          {/* Back arrow */}
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backArrow}>‹</Text>
            </TouchableOpacity>
          </View>

          {/* Match celebration header */}
          <View style={styles.header}>
            <View style={styles.partyRow}>
              <Text style={styles.partyEmoji}>🎉</Text>
              <Text style={styles.matchedText}>You matched with</Text>
              <Text style={styles.partyEmoji}>🎉</Text>
            </View>
            <Text style={styles.matchCount}>+{matchCount} clubs</Text>
            <Text style={styles.createText}>
              Create an account so that you can see your matches!!!
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Username */}
            <Text style={styles.label}>Username</Text>
            <TextInput
              style={[styles.input, !!errors.username && styles.inputError]}
              placeholder=""
              placeholderTextColor="rgba(0,0,0,0.3)"
              value={username}
              onChangeText={(v) => {
                setUsername(v);
                if (errors.username) setErrors((prev) => { const next = { ...prev }; delete next.username; return next; });
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!!errors.username && <Text style={styles.errorText}>{errors.username}</Text>}

            {/* School Email */}
            <Text style={[styles.label, { marginTop: 16 }]}>School Email</Text>
            <View style={{ position: "relative" }}>
              <TextInput
                style={[
                  styles.input,
                  (!!errors.email || emailExistsVerified || (emailFeedback !== null && !emailFeedback.valid)) && styles.inputError,
                  emailFeedback?.valid && !emailExistsVerified && styles.inputValid,
                ]}
                placeholder="yourname@university.edu"
                placeholderTextColor="rgba(0,0,0,0.3)"
                value={email}
                onChangeText={handleEmailChange}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
              {emailFeedback?.valid && (
                <View style={styles.inputCheckmark} pointerEvents="none">
                  <Text style={{ color: "#0FA6A6", fontSize: 16, fontWeight: "700" }}>✓</Text>
                </View>
              )}
            </View>
            {emailExistsVerified ? (
              <Text style={styles.errorText}>
                You already have an account.{" "}
                <Text
                  style={styles.errorLink}
                  onPress={() => router.replace("/auth/login")}
                >
                  Try to log in.
                </Text>
              </Text>
            ) : (
              (!!errors.email || (emailFeedback !== null && !emailFeedback.valid && !errors.email)) && (
                <Text style={styles.errorText}>
                  {errors.email || "Please use your university or college email (.edu or equivalent)"}
                </Text>
              )
            )}

            {/* Password */}
            <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
            <TextInput
              style={[styles.input, !!errors.password && styles.inputError]}
              placeholder="Min.8 characters"
              placeholderTextColor="rgba(0,0,0,0.3)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
            />
            {!!errors.password ? (
              <Text style={styles.errorText}>{errors.password}</Text>
            ) : null}
            <View style={styles.hintRow}>
              <Text style={[styles.hintItem, password.length === 0 ? styles.hintGray : password.length >= 8 ? styles.hintGreen : styles.hintRed]}>
                Min. 8 characters
              </Text>
              <Text style={[styles.hintItem, password.length === 0 ? styles.hintGray : /[A-Z]/.test(password) ? styles.hintGreen : styles.hintRed]}>
                1 capital letter
              </Text>
              <Text style={[styles.hintItem, password.length === 0 ? styles.hintGray : /[0-9]/.test(password) ? styles.hintGreen : styles.hintRed]}>
                1 number
              </Text>
            </View>

            {/* Next button */}
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { marginTop: 24 },
                (loading || (emailFeedback !== null && !emailFeedback.valid) || Object.keys(errors).length > 0) && styles.primaryBtnDisabled,
              ]}
              onPress={handleNext}
              disabled={loading || (emailFeedback !== null && !emailFeedback.valid) || Object.keys(errors).length > 0}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#FEFCF0" />
              ) : (
                <Text style={styles.primaryBtnText}>Next</Text>
              )}
            </TouchableOpacity>

            {/* Log in link */}
            <TouchableOpacity
              onPress={() => router.replace("/auth/login")}
              style={{ alignSelf: "center", marginTop: 16 }}
            >
              <Text style={styles.footerText}>
                Already have an account?{" "}
                <Text style={styles.tealLink}>Log in</Text>
              </Text>
            </TouchableOpacity>

            {/* Legal notice — clicking either link opens the same in-app
                document (Terms & Conditions, with the Privacy Policy as a
                section inside it) as a modal, so closing it always returns to
                this exact screen with everything already typed still here. */}
            <Text style={styles.legalText}>
              By clicking Next, you agree to our{" "}
              <Text style={styles.tealLink} onPress={() => setLegalModalOpen(true)}>
                Terms and Conditions
              </Text>{" "}
              and{" "}
              <Text style={styles.tealLink} onPress={() => setLegalModalOpen(true)}>
                Privacy Policy
              </Text>
              .
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <LegalModal visible={legalModalOpen} onClose={() => setLegalModalOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FEFCF0" },
  topBar: { paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  backArrow: { fontSize: 30, color: "#000", lineHeight: 36 },
  // width/maxWidth/alignSelf are a no-op on phone (screens are already
  // narrower than 480) but cap and center this column on iPad/Android
  // tablet instead of stretching edge-to-edge.
  header: { alignItems: "center", paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, width: "100%", maxWidth: 480, alignSelf: "center" },
  partyRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  partyEmoji: { fontSize: 24 },
  matchedText: { fontSize: 24, fontWeight: "700", color: "#0FA6A6" },
  matchCount: {
    fontSize: 36,
    fontWeight: "700",
    color: "#0FA6A6",
    textDecorationLine: "underline",
    marginBottom: 12,
  },
  createText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#000",
    textAlign: "center",
    lineHeight: 24,
  },
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
  inputValid: { borderColor: "#0FA6A6" },
  errorLink: {
    fontSize: 11,
    color: "#0FA6A6",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  inputCheckmark: {
    position: "absolute",
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  primaryBtnDisabled: { opacity: 0.5 },
  errorText: { fontSize: 11, color: "#F02719", marginTop: 4, marginLeft: 4 },
  primaryBtn: {
    height: 52,
    backgroundColor: "#0FA6A6",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  primaryBtnText: { color: "#FEFCF0", fontSize: 16, fontWeight: "600" },
  hintRow: { flexDirection: "row", gap: 12, marginTop: 6, marginLeft: 4, flexWrap: "wrap" },
  hintItem: { fontSize: 11, fontWeight: "500" },
  hintGray: { color: "#9CA3AF" },
  hintRed: { color: "#F02719" },
  hintGreen: { color: "#0FA6A6" },
  tealLink: { fontSize: 12, color: "#0FA6A6", fontWeight: "600" },
  footerText: { fontSize: 12, color: "#5F5D5D" },
  legalText: {
    fontSize: 12,
    color: "#000",
    textAlign: "center",
    marginTop: 16,
    lineHeight: 18,
  },
});
