import { useEffect } from "react";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useAuthStore } from "@weglue/shared";
import { supabase } from "../lib/supabase";
import { shouldHandleDeepLinkNavigation } from "../lib/platformAdmin";

/**
 * Handles first-party auth links that open the app:
 *   - weglue://auth/confirmed#access_token=…            (legacy deep link)
 *   - https://weglue.app/auth/confirm#access_token=…    (Android App Link
 *     intercepts the web confirmation URL before the browser sees it)
 * Both are email-verification / email-change confirmation links issued by
 * We Glue's own email/password auth. Password-recovery is deliberately NOT
 * handled here — `/auth/reset-password` is not in the app's associated-domains
 * path list, so a recovery link opens the web page, never the app.
 *
 * Tokens can land in the URL fragment (legacy implicit flow) OR as query
 * params — `code` (PKCE) or `token_hash`+`type` (OTP) — the same shapes
 * apps/web/app/auth/confirm/page.tsx already handles server-side. Expired/used
 * links arrive as #error=…&error_code=otp_expired — those route to the
 * confirm-email screen with a clear resend path instead of being dropped.
 *
 * Hardening (rollout task 4):
 *   - Every branch is wrapped so a malformed / expired / already-consumed link
 *     can never throw an unhandled rejection or leave the app in a bad state;
 *     it routes to the resend screen instead.
 *   - A SIGNUP confirmation link is ignored when a real session is already
 *     active. The account is already confirmed and the user is signed in, so
 *     replacing their live session with tokens from a stale link (the classic
 *     way an old email link logs a user out) is never correct. An EMAIL-CHANGE
 *     confirmation is the opposite: it is meant to be applied while signed in,
 *     so it still runs `setSession` / `exchangeCodeForSession` as before.
 *   - The same credential (token_hash/code/access_token) is never submitted to
 *     Supabase twice within a few seconds, even if this hook's effect below
 *     fires handleUrl() more than once for the same cold-start URL (a known
 *     Expo Linking quirk — see RECENT_CREDENTIAL_COOLDOWN_MS). Resubmitting an
 *     already-consumed one-time token produces an "already used" error whose
 *     navigation can race the successful first call and override it, showing
 *     the user a false "link expired" screen for a confirmation that actually
 *     succeeded.
 */

/** Send the user to the resend screen without touching the current session. */
function routeToResend(expired: boolean): void {
  router.replace({
    pathname: "/auth/verify-email",
    params: { expired: expired ? "1" : "0" },
  });
}

// When this hook actually consumes a verification credential from a link
// (setSession / exchangeCodeForSession / verifyOtp), it stamps the time here.
// `confirmed.tsx` reads it to tell a real just-happened verification apart from
// a stale signup link opened while the user was already signed in — in the
// latter case nothing is consumed, so it must not sign the user out.
let authLinkConsumedAt = 0;

/** Marks that a verification credential from an auth deep link was just consumed. */
export function markAuthLinkConsumed(): void {
  authLinkConsumedAt = Date.now();
}

/** True if a verification credential was consumed within the last `withinMs`. */
export function authLinkRecentlyConsumed(withinMs = 20_000): boolean {
  return authLinkConsumedAt > 0 && Date.now() - authLinkConsumedAt < withinMs;
}

/** Test-only: clears the consumed marker so suites don't leak state. */
export function __resetAuthLinkConsumed(): void {
  authLinkConsumedAt = 0;
}

// Expo Linking can deliver the SAME cold-start URL twice — both
// getInitialURL() and the first 'url' event can fire for one launch. This is
// the identical quirk useInviteDeepLink.ts / inviteController.ts already hit
// and fixed with a module-level cooldown guard; it was never applied here. A
// one-time verification credential is NOT safe to resubmit like an invite
// token is: the second attempt hits an already-consumed token_hash/code, and
// whichever handleUrl() call resolves LAST wins the on-screen navigation — so
// a confirmation that actually succeeded can still end up showing "link
// expired" to the user. Keyed by the credential itself (not the full URL) so
// a genuinely different link is never blocked.
const RECENT_CREDENTIAL_COOLDOWN_MS = 4000;
let recentCredential: string | null = null;
let recentCredentialAt = 0;

/** Test-only: clears the credential-dedup marker so suites don't leak state. */
export function __resetRecentCredential(): void {
  recentCredential = null;
  recentCredentialAt = 0;
}

/** Exported for unit tests. Called by the hook for every incoming auth link. */
export async function handleUrl(url: string): Promise<void> {
  // Guard against a malformed/non-string payload from the native Linking
  // bridge — calling string methods on a non-string would throw during the
  // cold-start deep-link path and take the whole launch down.
  if (typeof url !== "string" || url.length === 0) return;

  const isAuthLink =
    url.includes("auth/confirmed") || url.includes("auth/confirm");
  if (!isAuthLink) return;

  const [beforeHash, fragment = ""] = url.split("#");
  const hashParams = new URLSearchParams(fragment);
  const queryIndex = beforeHash.indexOf("?");
  const queryParams = new URLSearchParams(
    queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : ""
  );

  // `?flow=email_change` is our OWN marker (set by accountService.changeEmail /
  // the web emailChangeRedirect), not Supabase's `type`. It reliably tells an
  // email-change confirmation apart from a signup confirmation across every
  // delivery path, including PKCE `code` links that carry no `type` at all.
  const isEmailChange = queryParams.get("flow") === "email_change";

  const error_code = hashParams.get("error_code") ?? queryParams.get("error_code");
  const errorParam = hashParams.get("error") ?? queryParams.get("error");
  if (error_code || errorParam) {
    // otp_expired / access_denied — let the user resend from the app.
    routeToResend(error_code === "otp_expired");
    return;
  }

  const access_token = hashParams.get("access_token");
  const refresh_token = hashParams.get("refresh_token");
  const code = queryParams.get("code") ?? hashParams.get("code");
  const token_hash = queryParams.get("token_hash") ?? hashParams.get("token_hash");
  const type = queryParams.get("type") ?? hashParams.get("type");

  const hasCredential = Boolean(
    (access_token && refresh_token) || code || (token_hash && type)
  );
  if (!hasCredential) return;

  // Idempotent re-delivery guard (see RECENT_CREDENTIAL_COOLDOWN_MS above):
  // a second delivery of the SAME credential within the cooldown window,
  // whether truly concurrent or merely close in time, is a no-op.
  const credentialKey = access_token
    ? `token:${access_token}`
    : code
      ? `code:${code}`
      : `otp:${token_hash}:${type}`;
  const now = Date.now();
  if (credentialKey === recentCredential && now - recentCredentialAt < RECENT_CREDENTIAL_COOLDOWN_MS) {
    return;
  }
  recentCredential = credentialKey;
  recentCredentialAt = now;

  // A SIGNUP confirmation while a real session is already active: the account
  // is confirmed and the user is signed in. Do not let a (possibly stale)
  // signup link replace the live session — that is the unexpected-logout path.
  // Email-change confirmations are explicitly allowed through: they are meant
  // to be applied to the signed-in user.
  if (!isEmailChange) {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      // Already verified + signed in; nothing to consume. The navigator is
      // already showing the authenticated app, so no navigation is needed.
      return;
    }
  }

  try {
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (error) throw error;
      markAuthLinkConsumed();
      // onAuthStateChange in _layout.tsx fires automatically after setSession
      return;
    }

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      markAuthLinkConsumed();
      // onAuthStateChange in _layout.tsx fires automatically after the exchange
      return;
    }

    if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash,
        type: type as
          | "signup"
          | "email"
          | "recovery"
          | "email_change"
          | "invite"
          | "magiclink",
      });
      if (error) throw error;
      markAuthLinkConsumed();
      // onAuthStateChange in _layout.tsx fires automatically after verifyOtp
      return;
    }
  } catch {
    // Malformed, expired, or already-consumed link. Never surface a raw error
    // and never leave the user stuck — hand off to the resend screen. The
    // current session (if any) was not modified: setSession/exchange only
    // persist on success.
    routeToResend(true);
  }
}

export function useAuthDeepLink(accessResolved = true) {
  const session = useAuthStore((s) => s.session);
  // While a platform-admin session is active the root layout renders the
  // blocking screen instead of the navigator, so there is nothing to navigate:
  // every router.replace above would target an unmounted stack. Gating on the
  // CURRENT session is deliberate — during an admin's own sign-in the session
  // is still null here, so the link is processed normally and the block screen
  // appears only once the session lands.
  const allowDeepLinks = accessResolved && shouldHandleDeepLinkNavigation(session);

  useEffect(() => {
    if (!allowDeepLinks) return;

    // Cold start: app launched from the deep link
    void Linking.getInitialURL().then((url) => {
      if (url) void handleUrl(url);
    });

    // Warm start: app already running, brought to foreground via deep link
    const subscription = Linking.addEventListener("url", ({ url }) =>
      void handleUrl(url)
    );

    return () => subscription.remove();
  }, [allowDeepLinks]);
}
