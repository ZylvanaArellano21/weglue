import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../../lib/supabase";
import { validateEducationEmail } from "@weglue/shared";

function mapSignUpError(error: { message: string; status?: number; code?: string }): string {
  const msg = error.message.toLowerCase();
  const code = (error.code ?? "").toLowerCase();

  if (code === "user_already_exists" || msg.includes("user already registered") || msg.includes("already registered")) {
    return "An account with this email already exists. Try logging in instead.";
  }
  if (code === "weak_password" || msg.includes("password") && msg.includes("characters")) {
    return "Password must be at least 8 characters long.";
  }
  if (msg.includes("university") || msg.includes("educational") || msg.includes("school email")) {
    return "Only university or college email addresses (.edu) are accepted. Please use your school email.";
  }
  if (msg.includes("confirmation") || msg.includes("confirm") || msg.includes("send")) {
    return "We couldn't send a confirmation email. Check your email address and try again.";
  }
  if (error.status === 0 || msg.includes("network") || msg.includes("fetch") || msg.includes("connect")) {
    return "No internet connection. Please check your network and try again.";
  }
  if (error.status && error.status >= 500) {
    return "Our servers hit an issue. Wait a moment and try again. If this keeps happening, contact support.";
  }
  return `Something unexpected happened (Error: ${error.message}). Please try again or contact support.`;
}

export default function SignupScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function clearError(field: string) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validateEmailField(value: string) {
    if (!value.trim()) {
      setErrors((prev) => ({ ...prev, email: "Email is required." }));
      return;
    }
    const result = validateEducationEmail(value.trim());
    if (!result.valid) {
      setErrors((prev) => ({ ...prev, email: result.reason! }));
    } else {
      clearError("email");
    }
  }

  function validate() {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = "Full name is required.";
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
      errs.password = "Password must be at least 8 characters long.";
    }
    if (password !== confirmPassword)
      errs.confirmPassword = "Passwords do not match.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSignup() {
    if (!validate()) return;
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: "https://weglue.app/auth/confirm",
        data: {
          full_name: fullName.trim(),
          username: username.trim().replace(/^@/, ""),
        },
      },
    });
    setLoading(false);
    if (error) {
      setErrors({ general: mapSignUpError(error) });
      return;
    }
    // Supabase returns a fake success (no error, no session, identities=[]) when
    // the email already exists, to prevent user enumeration. Catch it explicitly.
    if (!data.session && data.user?.identities?.length === 0) {
      setErrors({ general: "An account with this email already exists. Try logging in instead." });
      return;
    }
    if (data.session) {
      router.push("/auth/avatar");
    } else {
      const normalizedEmail = email.trim().toLowerCase();
      await AsyncStorage.setItem("@weglue/pending_confirmation_email", normalizedEmail);
      router.push({
        pathname: "/auth/verify-email",
        params: { email: normalizedEmail, from: "signup" },
      });
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Back arrow */}
          <View className="px-6 pt-4">
            <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 justify-center">
              <Text className="text-2xl text-teal">‹</Text>
            </TouchableOpacity>
          </View>

          <View className="px-8 pt-6 pb-10">
            <Text
              className="text-4xl text-gray-900 mb-8"
              style={{ fontFamily: "Zain_700Bold" }}
            >
              Create Account
            </Text>

            {/* Full Name */}
            <View className="mb-4">
              <TextInput
                className="bg-white border border-gray-200 rounded-full px-5 py-4 text-base text-gray-900"
                placeholder="Full Name"
                placeholderTextColor="#9CA3AF"
                value={fullName}
                onChangeText={(v) => { setFullName(v); clearError("fullName"); }}
                autoComplete="name"
              />
              {!!errors.fullName && (
                <Text className="text-xs mt-1 ml-4" style={{ color: "#F02719" }}>
                  {errors.fullName}
                </Text>
              )}
            </View>

            {/* Username */}
            <View className="mb-4">
              <TextInput
                className="bg-white border border-gray-200 rounded-full px-5 py-4 text-base text-gray-900"
                placeholder="@username"
                placeholderTextColor="#9CA3AF"
                value={username}
                onChangeText={(v) => { setUsername(v); clearError("username"); }}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {!!errors.username && (
                <Text className="text-xs mt-1 ml-4" style={{ color: "#F02719" }}>
                  {errors.username}
                </Text>
              )}
            </View>

            {/* Email */}
            <View className="mb-4">
              <TextInput
                className="bg-white border border-gray-200 rounded-full px-5 py-4 text-base text-gray-900"
                placeholder="Email (.edu required)"
                placeholderTextColor="#9CA3AF"
                value={email}
                onChangeText={(v) => { setEmail(v); clearError("email"); }}
                onBlur={() => validateEmailField(email)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />
              {!!errors.email && (
                <Text className="text-xs mt-1 ml-4" style={{ color: "#F02719" }}>
                  {errors.email}
                </Text>
              )}
            </View>

            {/* Password */}
            <View className="mb-4">
              <View className="bg-white border border-gray-200 rounded-full px-5 py-4 flex-row items-center">
                <TextInput
                  className="flex-1 text-base text-gray-900"
                  placeholder="Password"
                  placeholderTextColor="#9CA3AF"
                  value={password}
                  onChangeText={(v) => { setPassword(v); clearError("password"); }}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                />
                <TouchableOpacity onPress={() => setShowPassword((v) => !v)}>
                  <Text className="text-gray-400 text-sm">
                    {showPassword ? "Hide" : "Show"}
                  </Text>
                </TouchableOpacity>
              </View>
              {!!errors.password && (
                <Text className="text-xs mt-1 ml-4" style={{ color: "#F02719" }}>
                  {errors.password}
                </Text>
              )}
            </View>

            {/* Confirm Password */}
            <View className="mb-6">
              <View className="bg-white border border-gray-200 rounded-full px-5 py-4 flex-row items-center">
                <TextInput
                  className="flex-1 text-base text-gray-900"
                  placeholder="Confirm Password"
                  placeholderTextColor="#9CA3AF"
                  value={confirmPassword}
                  onChangeText={(v) => { setConfirmPassword(v); clearError("confirmPassword"); }}
                  secureTextEntry={!showConfirm}
                  autoComplete="new-password"
                />
                <TouchableOpacity onPress={() => setShowConfirm((v) => !v)}>
                  <Text className="text-gray-400 text-sm">
                    {showConfirm ? "Hide" : "Show"}
                  </Text>
                </TouchableOpacity>
              </View>
              {!!errors.confirmPassword && (
                <Text className="text-xs mt-1 ml-4" style={{ color: "#F02719" }}>
                  {errors.confirmPassword}
                </Text>
              )}
            </View>

            {/* General error */}
            {!!errors.general && (
              <Text className="text-sm text-center mb-4" style={{ color: "#F02719" }}>
                {errors.general}
              </Text>
            )}

            {/* Sign Up button */}
            <TouchableOpacity
              onPress={handleSignup}
              disabled={loading}
              className="bg-teal rounded-full py-4 items-center mb-6"
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text
                  className="text-white text-lg"
                  style={{ fontFamily: "Zain_700Bold" }}
                >
                  Sign Up
                </Text>
              )}
            </TouchableOpacity>

            {/* Log in link */}
            <TouchableOpacity
              onPress={() => router.replace("/auth/login")}
              className="items-center"
            >
              <Text className="text-gray-500 text-sm">
                Already have an account?{" "}
                <Text className="text-teal font-semibold">Log In</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
