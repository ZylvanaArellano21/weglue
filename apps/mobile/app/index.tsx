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
import * as Linking from "expo-linking";
import { useAuthStore } from "@weglue/shared";
import { getPendingSignupEmail } from "../lib/authFlow";
import { resumePendingInvite } from "../lib/inviteController";
import { resumePendingCheckin } from "../lib/pendingCheckin";
import { checkAndroidInstallReferrerOnce } from "../lib/androidInstallReferrer";
import { isContentDeepLinkUrl } from "../lib/coldStartRouting";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { withTimeout } from "../lib/withTimeout";

const INITIAL_URL_TIMEOUT_MS = 2000;
const STARTUP_STORAGE_TIMEOUT_MS = 1000;

export default function WelcomeScreen() {
  const { session, isLoading, profile } = useAuthStore();
  const router = useRouter();
  // null = still checking AsyncStorage; "" = no pending signup
  const [pendingSignupEmail, setPendingSignupEmail] = useState<string | null>(null);
  const [deletedNotice, setDeletedNotice] = useState(false);
  // null = still checking the cold-start URL; true = the app was launched by a
  // Universal / App Link that targets an in-app content screen (/club, /post),
  // which expo-router routes to on its own. WelcomeScreen is the root-stack
  // anchor and stays mounted underneath that screen, so it must NOT run its
  // redirect-to-Home effect in that case — doing so clobbers the deep-link
  // destination (the club profile flashes, then bounces to Home). This is an
  // iOS-only cold-start timing race; Android's App Link handling never hits it.
  const [contentDeepLink, setContentDeepLink] = useState<boolean | null>(null);
  const [contentDeepLinkError, setContentDeepLinkError] = useState(false);
  const [initialUrlAttempt, setInitialUrlAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void withTimeout(Linking.getInitialURL(), INITIAL_URL_TIMEOUT_MS)
      .then((url) => {
        if (!cancelled) {
          setContentDeepLinkError(false);
          setContentDeepLink(isContentDeepLinkUrl(url));
        }
      })
      .catch(() => {
        if (!cancelled) setContentDeepLinkError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initialUrlAttempt]);

  useEffect(() => {
    let cancelled = false;
    void withTimeout(getPendingSignupEmail(), STARTUP_STORAGE_TIMEOUT_MS)
      .then((stored) => {
        if (!cancelled) setPendingSignupEmail(stored ?? "");
      })
      .catch(() => {
        if (!cancelled) setPendingSignupEmail("");
      });
    AsyncStorage.getItem("weglue-account-deletion-success").then((value) => {
      if (value === "1") {
        setDeletedNotice(true);
        void AsyncStorage.removeItem("weglue-account-deletion-success");
      }
    });
    // Feature 1 — a fresh Android install has no session yet; this persists
    // any Play Install Referrer invite token so it survives signup/login the
    // same way a deep-link-captured token does. No-ops on iOS, on every
    // launch after the first, and if there's no token to find.
    void checkAndroidInstallReferrerOnce({
      hasSession: !!session?.user?.email_confirmed_at,
      isOnboarded: !!session?.user?.email_confirmed_at,
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isLoading || contentDeepLink === null) return;
    if (!session && pendingSignupEmail === null) return;

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

    // Defence in depth: an account that never completed We Glue onboarding may
    // not enter Home. onboarding_completed is true for every email/password
    // account (042 backfilled it, and password signups always set it at
    // creation), so this branch can never trap an existing user.
    if (profile && profile.onboarding_completed === false) {
      router.replace("/onboarding/interests");
      return;
    }

    // A verified user ALWAYS goes straight to Home. There is no mandatory
    // onboarding left: no profile picture is required, no club catalog, no
    // club selection, no "Done" step. Accounts stranded mid-way through the
    // old flow therefore land on Home like everyone else — migration 042 also
    // backfilled that flag.
    // Launched by a Universal / App Link to a content screen (/club, /post):
    // expo-router is already routing there. Don't override it with Home.
    if (contentDeepLink) return;

    // A deferred check-in (signed out when the QR/link was opened) is
    // consumed first, then a deferred chat invite, then normal app entry.
    resumePendingCheckin().then((hadPendingCheckin) => {
      if (hadPendingCheckin) return;
      resumePendingInvite().then((hadPendingInvite) => {
        if (!hadPendingInvite) {
          router.replace("/(tabs)");
        }
      });
    });
  }, [isLoading, session, profile, pendingSignupEmail, contentDeepLink]);

  if (contentDeepLinkError) {
    return (
      <View style={[styles.loading, { paddingHorizontal: 24 }]}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: "#000", textAlign: "center" }}>
          We couldn’t open your launch link
        </Text>
        <Text style={{ fontSize: 14, color: "#444", textAlign: "center", marginTop: 8 }}>
          Please try again so we can send you to the right place.
        </Text>
        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 24 }]}
          onPress={() => {
            setContentDeepLinkError(false);
            setContentDeepLink(null);
            setInitialUrlAttempt((attempt) => attempt + 1);
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading || contentDeepLink === null || (!session && pendingSignupEmail === null)) {
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
        {deletedNotice && <Text style={styles.deletedNotice}>Your account has been successfully deleted.</Text>}
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
          onPress={() => router.push("/onboarding/choose-university")}
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
  deletedNotice: { marginBottom: 12, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: '#DCFCE7', color: '#166534', fontSize: 14, fontWeight: '600', textAlign: 'center' },
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
