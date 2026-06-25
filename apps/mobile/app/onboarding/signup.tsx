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
import { useOnboardingStore } from "@weglue/shared";
import { useToast } from "../../components/Toast";

export default function OnboardingSignupScreen() {
  const router = useRouter();
  const { matchCount, setPendingUsername } = useOnboardingStore();
  const { show, ToastComponent } = useToast();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!username.trim()) errs.username = "Username is required.";
    if (!email.trim()) errs.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errs.email = "Please enter a valid email.";
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

  async function handleNext() {
    if (!validate()) return;
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          username: username.trim().replace(/^@/, ""),
          full_name: username.trim().replace(/^@/, ""),
        },
        emailRedirectTo: "https://weglue.app/auth/confirm",
      },
    });

    setLoading(false);

    if (error) {
      const msg =
        error.message && error.message !== "{}" && !error.message.startsWith("{")
          ? error.message
          : "Something went wrong. Please try again.";
      show(msg, "error");
      return;
    }

    setPendingUsername(username.trim().replace(/^@/, ""));

    if (data.session) {
      // Email confirmation is OFF — user is logged in immediately
      router.push("/onboarding/profile-pic");
    } else {
      // Email confirmation is ON — send to a waiting screen
      router.push({
        pathname: "/auth/verify-email",
        params: { email: email.trim().toLowerCase(), from: "signup" },
      });
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
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!!errors.username && <Text style={styles.errorText}>{errors.username}</Text>}

            {/* School Email */}
            <Text style={[styles.label, { marginTop: 16 }]}>Lone Star Email</Text>
            <TextInput
              style={[styles.input, !!errors.email && styles.inputError]}
              placeholder="you@school.edu"
              placeholderTextColor="rgba(0,0,0,0.3)"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            {!!errors.email && <Text style={styles.errorText}>{errors.email}</Text>}

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
            ) : (
              <Text style={styles.errorText}>Min. 8 characters, 1 capital letter, 1 number</Text>
            )}

            {/* Microsoft SSO (coming soon) */}
            <TouchableOpacity
              style={[styles.secondaryBtn, { marginTop: 24 }]}
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

            {/* Next button */}
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 16 }, loading && { opacity: 0.7 }]}
              onPress={handleNext}
              disabled={loading}
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
              onPress={() => router.push("/auth/login")}
              style={{ alignSelf: "center", marginTop: 16 }}
            >
              <Text style={styles.footerText}>
                Already have an account?{" "}
                <Text style={styles.tealLink}>Log in</Text>
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
  header: { alignItems: "center", paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
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
  hintText: { fontSize: 11, color: "#5F5D5D", marginTop: 4, marginLeft: 4 },
  tealLink: { fontSize: 12, color: "#0FA6A6", fontWeight: "600" },
  footerText: { fontSize: 12, color: "#5F5D5D" },
});
