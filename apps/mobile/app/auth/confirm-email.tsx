import { useEffect } from "react";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PENDING_EMAIL_KEY = "@weglue/pending_confirmation_email";

/**
 * Deep link target: weglue://auth/confirm-email
 * Reached when the user taps "Back to sign up" from the web expired-link error page.
 * Redirects to verify-email with any persisted pending email so they can resend.
 */
export default function ConfirmEmailDeepLinkScreen() {
  const router = useRouter();

  useEffect(() => {
    AsyncStorage.getItem(PENDING_EMAIL_KEY).then((email) => {
      if (email) {
        router.replace({
          pathname: "/auth/verify-email",
          params: { email },
        });
      } else {
        router.replace("/auth/verify-email");
      }
    });
  }, []);

  return null;
}
