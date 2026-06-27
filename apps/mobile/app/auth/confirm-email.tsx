import { useEffect } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useOnboardingStore } from "@weglue/shared";

const PENDING_EMAIL_KEY = "@weglue/pending_confirmation_email";

/**
 * Deep link target: weglue://auth/confirm-email
 * Reached when the user taps "Back to sign up" from the web expired-link error page.
 * Redirects to verify-email with any persisted pending email so they can resend.
 */
export default function ConfirmEmailDeepLinkScreen() {
  const router = useRouter();
  const { pendingEmail } = useOnboardingStore();

  useEffect(() => {
    let active = true;

    async function redirectToVerifyEmail() {
      const email = await AsyncStorage.getItem(PENDING_EMAIL_KEY);
      const userEmail =
        email?.trim().toLowerCase() || pendingEmail.trim().toLowerCase();

      if (!active) return;

      if (userEmail) {
        await AsyncStorage.setItem(PENDING_EMAIL_KEY, userEmail);
        if (!active) return;

        router.replace({
          pathname: "/auth/verify-email",
          params: { email: userEmail },
        });
      } else {
        router.replace("/auth/verify-email");
      }
    }

    redirectToVerifyEmail();

    return () => {
      active = false;
    };
  }, [pendingEmail, router]);

  return null;
}
