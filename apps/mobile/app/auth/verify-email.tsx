import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAuthStore } from "@weglue/shared";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../components/Toast";

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { email, from } = useLocalSearchParams<{ email: string; from?: string }>();
  const { session } = useAuthStore();
  const { show, ToastComponent } = useToast();
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Navigate when the auth store session confirms email (triggered by deep link)
  useEffect(() => {
    if (session?.user?.email_confirmed_at) {
      router.replace("/onboarding/profile-pic");
    }
  }, [session]);

  // Poll every 4 seconds: handles same-device confirmation when session becomes active
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user?.email_confirmed_at) {
        clearInterval(pollRef.current!);
        router.replace("/onboarding/profile-pic");
      }
    }, 4000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  async function handleResend() {
    if (!email || cooldown > 0) return;
    setResending(true);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setResending(false);
    if (error) {
      show("Something went wrong. Please try again.", "error");
    } else {
      show("Verification email sent!", "success");
      startCooldown(60);
    }
  }

  function startCooldown(seconds: number) {
    setCooldown(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  const resendLabel = cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Email";

  return (
    <SafeAreaView style={styles.container}>
      {ToastComponent}
      <View style={styles.content}>
        {/* Logo icon */}
        <Image
          source={require("../../assets/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.title}>Confirm your email</Text>

        <Text style={styles.subtitle}>We sent a verification link to</Text>
        <Text style={styles.email}>{email}</Text>

        <Text style={styles.instruction}>
          Tap the link in the email to verify your account. Once verified, you
          will be taken to the next step automatically.
        </Text>

        <TouchableOpacity
          style={[styles.resendBtn, (resending || cooldown > 0) && styles.resendBtnDisabled]}
          onPress={handleResend}
          disabled={resending || cooldown > 0}
          activeOpacity={0.85}
        >
          {resending ? (
            <ActivityIndicator color="#FEFCF0" />
          ) : (
            <Text style={[styles.resendText, cooldown > 0 && styles.resendTextMuted]}>
              {resendLabel}
            </Text>
          )}
        </TouchableOpacity>
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
  logo: {
    width: 80,
    height: 72,
    marginBottom: 28,
  },
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
    marginBottom: 16,
  },
  instruction: {
    fontSize: 13,
    color: "#5F5D5D",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 36,
  },
  resendBtn: {
    width: "100%",
    height: 52,
    borderRadius: 40,
    backgroundColor: "#0FA6A6",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  resendBtnDisabled: {
    backgroundColor: "#CCCCCC",
    shadowOpacity: 0,
    elevation: 0,
  },
  resendText: { fontSize: 16, fontWeight: "600", color: "#FEFCF0" },
  resendTextMuted: { color: "#FEFCF0" },
});
