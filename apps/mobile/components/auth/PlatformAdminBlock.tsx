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
import { PLATFORM_ADMIN_MOBILE_MESSAGE } from "@weglue/shared";

// ─── Platform-admin blocking screen (iOS + Android, identical) ───────────────
//
// Rendered by the root layout INSTEAD of the navigator when the signed-in
// account is a platform-admin Auth identity. Because it replaces the <Stack>
// rather than covering it, no student screen ever mounts: no Home, no tabs, no
// onboarding, no recommendation query, no realtime channel, no push host.
//
// Deliberately contains NOTHING but the message and Sign out:
//   • no Admin Dashboard button, link, URL or deep link
//   • no hidden/long-press administration mode
//   • no dashboard functionality of any kind
// The founder reaches the dashboard separately, in a browser. A student-facing
// app binary must never advertise where the admin portal lives.
//
// There is no Platform.OS branch here or in the layout that renders it — iOS
// and Android execute the same JavaScript.

export function PlatformAdminBlock({
  email,
  onSignOut,
}: {
  email?: string | null;
  onSignOut: () => Promise<void> | void;
}) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      // The auth listener unmounts this screen on success; resetting matters
      // only when sign-out failed, so the button stays usable.
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Image
          source={require("../../assets/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Administrator account</Text>
        <Text style={styles.message}>{PLATFORM_ADMIN_MOBILE_MESSAGE}</Text>
        {email ? <Text style={styles.email}>{email}</Text> : null}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={handleSignOut}
          activeOpacity={0.85}
          disabled={signingOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          {signingOut ? (
            <ActivityIndicator color="#FEFCF0" />
          ) : (
            <Text style={styles.signOutText}>Sign out</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FEFCF0",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logo: {
    width: 120,
    height: 108,
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontFamily: "Zain_700Bold",
    color: "#000000",
    textAlign: "center",
  },
  message: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    color: "#444444",
    textAlign: "center",
    lineHeight: 24,
    marginTop: 12,
  },
  email: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#888888",
    textAlign: "center",
    marginTop: 20,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  signOutBtn: {
    width: "100%",
    height: 52,
    backgroundColor: "#0FA6A6",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  signOutText: {
    color: "#FEFCF0",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
