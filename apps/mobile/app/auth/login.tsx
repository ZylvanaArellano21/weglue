import { useState } from "react";
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

export default function LoginScreen() {
  const router = useRouter();
  const { show, ToastComponent } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) {
      show("Please fill in all fields.", "error");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setLoading(false);

    if (error) {
      if (error.message.toLowerCase().includes("email not confirmed")) {
        show("Please verify your email before logging in.", "error");
      } else {
        show("Invalid email or password.", "error");
      }
      return;
    }

    if (data?.user) {
      const { data: interests } = await supabase
        .from("user_interests")
        .select("id")
        .eq("user_id", data.user.id)
        .limit(1);
      if ((interests?.length ?? 0) > 0) {
        router.replace("/(tabs)/home");
      } else {
        router.replace("/onboarding/interests");
      }
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

          {/* Logo + Brand */}
          <View style={styles.brand}>
            <Image
              source={require("../../assets/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.brandName}>We Glue</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* School Email */}
            <Text style={styles.label}>School Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@school.edu"
              placeholderTextColor="rgba(0,0,0,0.3)"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            {/* Password */}
            <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Enter your password"
                placeholderTextColor="rgba(0,0,0,0.3)"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="current-password"
              />
              <TouchableOpacity onPress={() => setShowPassword((v) => !v)}>
                <Text style={styles.showToggle}>{showPassword ? "Hide" : "Show"}</Text>
              </TouchableOpacity>
            </View>

            {/* Log in button */}
            <TouchableOpacity
              style={styles.primaryBtn}
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

            {/* Forgot password */}
            <TouchableOpacity style={{ alignSelf: "center", marginBottom: 24 }}>
              <Text style={styles.tealLink}>Forgot Password?</Text>
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Microsoft SSO (coming soon) */}
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

            {/* Create account link */}
            <TouchableOpacity
              onPress={() => router.replace("/")}
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
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    marginBottom: 6,
  },
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
    marginBottom: 24,
  },
  passwordInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
  },
  showToggle: { fontSize: 12, color: "#5F5D5D", fontWeight: "500" },
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
  tealLink: { fontSize: 14, color: "#0FA6A6", fontWeight: "600" },
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
