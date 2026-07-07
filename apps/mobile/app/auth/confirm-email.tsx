import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useOnboardingStore } from "@weglue/shared";
import {
  getPendingSignupEmail,
  setPendingSignupEmail,
} from "../../lib/authFlow";

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
      const email = await getPendingSignupEmail();
      const userEmail = email || pendingEmail.trim().toLowerCase();

      if (!active) return;

      if (userEmail) {
        await setPendingSignupEmail(userEmail);
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
