import { useEffect } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useAuthStore } from "@weglue/shared";
import { supabase } from "../lib/supabase";
import {
  completeMicrosoftCallback,
  isMicrosoftSignInActive,
} from "../lib/microsoftAuth";
import { shouldHandleDeepLinkNavigation } from "../lib/platformAdmin";

/**
 * Handles auth links that open the app:
 *   - weglue://auth/confirmed#access_token=…            (legacy deep link)
 *   - https://weglue.app/auth/confirm#access_token=…    (Android App Link
 *     intercepts the web confirmation URL before the browser sees it)
 *   - weglue://auth/callback?code=…                     (Microsoft OAuth
 *     return when the app was backgrounded/killed during the browser step;
 *     the foreground path resolves inside openAuthSessionAsync instead)
 * Tokens land in the URL fragment. Expired/invalid links arrive as
 * #error=…&error_code=otp_expired — route those to the confirm-email screen
 * with a clear resend path instead of dropping them.
 */
async function handleUrl(url: string) {
  // Guard against a malformed/non-string payload from the native Linking
  // bridge — calling string methods on a non-string would throw during the
  // cold-start deep-link path and take the whole launch down.
  if (typeof url !== "string" || url.length === 0) return;

  if (url.includes("auth/callback")) {
    // Microsoft OAuth return. completeMicrosoftCallback deduplicates by code,
    // so this coexisting with the openAuthSessionAsync result is harmless.
    // When the foreground flow is active (Android can deliver the redirect
    // both ways), the screen that opened the browser owns navigation/errors.
    const foregroundOwns = isMicrosoftSignInActive();
    const result = await completeMicrosoftCallback(url);
    if (foregroundOwns) return;
    if (result.status === "success") {
      // Session is on the main client; the root guard routes from "/".
      router.replace("/");
    } else if (result.status === "error") {
      router.replace({
        pathname: "/auth/login",
        params: { oauthError: result.message },
      });
    }
    return;
  }

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
  const session = useAuthStore((s) => s.session);
  // While a platform-admin session is active the root layout renders the
  // blocking screen instead of the navigator, so there is nothing to navigate:
  // every router.replace above would target an unmounted stack. Gating on the
  // CURRENT session is deliberate — during an admin's own sign-in the session
  // is still null here, so the link is processed normally and the block screen
  // appears only once the session lands.
  const allowDeepLinks = shouldHandleDeepLinkNavigation(session);

  useEffect(() => {
    if (!allowDeepLinks) return;

    // Cold start: app launched from the deep link
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    // Warm start: app already running, brought to foreground via deep link
    const subscription = Linking.addEventListener("url", ({ url }) =>
      handleUrl(url)
    );

    return () => subscription.remove();
  }, [allowDeepLinks]);
}
