import { useEffect } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuthStore } from "@weglue/shared";

export default function WelcomeScreen() {
  const { session, isLoading, profile } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || !session) return;

    if (!session.user.email_confirmed_at) {
      // Email not yet confirmed — send back to waiting screen
      router.replace({
        pathname: "/auth/verify-email",
        params: { email: session.user.email ?? "", from: "signup" },
      });
      return;
    }

    if (!profile?.avatar_url) {
      // Confirmed but no profile picture — complete that step first
      router.replace("/onboarding/profile-pic");
      return;
    }

    // Fully onboarded — go to the main app
    router.replace("/(tabs)/home");
  }, [isLoading, session, profile]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#0FA6A6" />
      </View>
    );
  }

  if (session) return null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Logo + Tagline — upper 45% */}
      <View style={styles.hero}>
        <Image
          source={require("../assets/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>We Glue</Text>
        <Text style={styles.subtitle}>Connection Starts with You</Text>
      </View>

      {/* CTA buttons — bottom */}
      <View style={styles.cta}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.push("/onboarding/interests")}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Sign up</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push("/auth/login")}
          activeOpacity={0.7}
          style={{ marginTop: 16 }}
        >
          <Text style={styles.loginLink}>Log in</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEFCF0",
  },
  container: {
    flex: 1,
    backgroundColor: "#FEFCF0",
  },
  hero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 40,
  },
  logo: {
    width: 200,
    height: 180,
    marginBottom: 16,
  },
  title: {
    fontSize: 50,
    fontFamily: "Zain_700Bold",
    color: "#000000",
    textAlign: "center",
    lineHeight: 56,
    marginTop: 24,
  },
  subtitle: {
    fontSize: 28,
    fontFamily: "Zain_400Regular",
    color: "#000000",
    textAlign: "center",
    marginTop: 4,
  },
  cta: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    alignItems: "center",
  },
  primaryBtn: {
    width: "100%",
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
  primaryBtnText: {
    color: "#FEFCF0",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  loginLink: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
    color: "#000000",
    textAlign: "center",
  },
});
