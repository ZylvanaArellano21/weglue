import { useEffect, useState } from "react";
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
import { getPendingSignupEmail } from "../lib/authFlow";
import { getPendingInvite } from "../lib/pendingInvite";

export default function WelcomeScreen() {
  const { session, isLoading, profile } = useAuthStore();
  const router = useRouter();
  // null = still checking AsyncStorage; "" = no pending signup
  const [pendingSignupEmail, setPendingSignupEmail] = useState<string | null>(null);

  useEffect(() => {
    getPendingSignupEmail().then((stored) => setPendingSignupEmail(stored ?? ""));
  }, []);

  useEffect(() => {
    if (isLoading) return;

    if (!session) {
      // No session, but a signup is mid-flight (signed up, never verified,
      // closed the app) — resume at the confirm-email step. Its back button
      // clears the marker, so this can never trap the user.
      if (pendingSignupEmail) {
        router.replace({
          pathname: "/auth/verify-email",
          params: { email: pendingSignupEmail, from: "resume" },
        });
      }
      return;
    }

    if (!session.user.email_confirmed_at) {
      // Email not yet confirmed — send back to waiting screen
      router.replace({
        pathname: "/auth/verify-email",
        params: { email: session.user.email ?? "", from: "signup" },
      });
      return;
    }

    // A Microsoft (OAuth) account that never completed We Glue onboarding may
    // not enter Home: OAuth succeeding is not the same as having an account.
    // onboarding_completed is false ONLY for those accounts (042 backfilled it
    // true for everything else; password signups always set it true), and
    // complete_oauth_onboarding is the only thing that flips it — so this can
    // never trap an existing user.
    if (profile && profile.onboarding_completed === false) {
      router.replace("/onboarding/interests");
      return;
    }

    // A verified user ALWAYS goes straight to Home. There is no mandatory
    // onboarding left: no profile picture is required, no club catalog, no
    // club selection, no "Done" step. Accounts stranded mid-way through the
    // old flow therefore land on Home like everyone else — migration 042 also
    // backfilled that flag.
    // A deferred chat invite is consumed exactly here so the invited chat is
    // the first destination shown — then normal app entry.
    getPendingInvite().then((token) => {
      if (token) {
        router.replace(`/invite/${token}` as any);
      } else {
        router.replace("/(tabs)");
      }
    });
  }, [isLoading, session, profile, pendingSignupEmail]);

  if (isLoading || pendingSignupEmail === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#0FA6A6" />
      </View>
    );
  }

  if (session || pendingSignupEmail) return null;

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
    marginTop: 32,
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
