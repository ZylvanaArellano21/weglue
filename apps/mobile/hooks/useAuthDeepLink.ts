import { useEffect } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";

/**
 * Handles auth links that open the app:
 *   - weglue://auth/confirmed#access_token=…            (legacy deep link)
 *   - https://weglue.app/auth/confirm#access_token=…    (Android App Link
 *     intercepts the web confirmation URL before the browser sees it)
 * Tokens land in the URL fragment. Expired/invalid links arrive as
 * #error=…&error_code=otp_expired — route those to the confirm-email screen
 * with a clear resend path instead of dropping them.
 */
async function handleUrl(url: string) {
  const isAuthLink =
    url.includes("auth/confirmed") || url.includes("auth/confirm");
  if (!isAuthLink) return;

  const fragment = url.split("#")[1] ?? "";
  const params = new URLSearchParams(fragment);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  const error_code = params.get("error_code");

  if (access_token && refresh_token) {
    await supabase.auth.setSession({ access_token, refresh_token });
    // onAuthStateChange in _layout.tsx fires automatically after setSession
    return;
  }

  if (error_code) {
    // otp_expired / access_denied — let the user resend from the app.
    router.replace({
      pathname: "/auth/verify-email",
      params: { expired: error_code === "otp_expired" ? "1" : "0" },
    });
  }
}

export function useAuthDeepLink() {
  useEffect(() => {
    // Cold start: app launched from the deep link
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    // Warm start: app already running, brought to foreground via deep link
    const subscription = Linking.addEventListener("url", ({ url }) =>
      handleUrl(url)
    );

    return () => subscription.remove();
  }, []);
}
