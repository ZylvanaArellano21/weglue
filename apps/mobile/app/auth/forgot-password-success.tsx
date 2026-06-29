import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";

export default function ForgotPasswordSuccessScreen() {
  const { email } = useLocalSearchParams<{ email: string }>();

  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  async function handleResend() {
    if (resendLoading || !email) return;
    setResendLoading(true);
    setResendSuccess(false);
    setResendError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: "https://weglue.app/auth/reset-password" }
    );

    setResendLoading(false);

    if (error) {
      setResendError("Couldn't resend. Try again.");
      return;
    }

    setResendSuccess(true);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Image
          source={require("../../assets/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />

        {/* Check circle */}
        <View style={styles.checkCircle}>
          <Text style={styles.checkMark}>✓</Text>
        </View>

        <Text style={styles.title}>Check your inbox</Text>
        <Text style={styles.subtitle}>
          We sent a password reset link to
        </Text>
        <Text style={styles.email}>{email}</Text>
        <Text style={styles.instruction}>
          Open the link in the email to set a new password. If you don't see it,
          check your spam folder.
        </Text>

        {resendSuccess ? (
          <Text style={styles.resendSuccessText}>Reset link resent! Check your inbox.</Text>
        ) : resendError ? (
          <View style={styles.resendErrorWrap}>
            <Text style={styles.resendErrorText}>{resendError}</Text>
            <TouchableOpacity
              style={styles.resendBtn}
              onPress={handleResend}
              disabled={resendLoading}
              activeOpacity={0.85}
            >
              {resendLoading ? (
                <ActivityIndicator color="#0FA6A6" />
              ) : (
                <Text style={styles.resendBtnText}>Try Again</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.resendBtn}
            onPress={handleResend}
            disabled={resendLoading}
            activeOpacity={0.85}
          >
            {resendLoading ? (
              <ActivityIndicator color="#0FA6A6" />
            ) : (
              <Text style={styles.resendBtnText}>Resend Link</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FEFCF0" },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logo: { width: 80, height: 72, marginBottom: 24 },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: "#0FA6A6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  checkMark: { fontSize: 32, color: "#0FA6A6", fontWeight: "700" },
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
    marginBottom: 12,
  },
  instruction: {
    fontSize: 13,
    color: "#5F5D5D",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 32,
  },
  resendBtn: {
    borderWidth: 1.5,
    borderColor: "#0FA6A6",
    borderRadius: 40,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  resendBtnText: { color: "#0FA6A6", fontSize: 14, fontWeight: "600" },
  resendSuccessText: {
    fontSize: 14,
    color: "#0FA6A6",
    fontWeight: "600",
    textAlign: "center",
  },
  resendErrorWrap: { alignItems: "center", gap: 10 },
  resendErrorText: { fontSize: 13, color: "#F02719", textAlign: "center" },
});
