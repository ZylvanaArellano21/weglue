import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";

/**
 * Microsoft ("Continue with Microsoft") sign-in via Supabase's Azure OAuth
 * provider, PKCE flow.
 *
 * WHY A SECOND GOTRUE CLIENT: the main client (lib/supabase.ts) runs the
 * implicit flow on purpose — email confirmation / reset links carry tokens in
 * the URL fragment and must keep working when the link is opened on a
 * DIFFERENT device than the one that signed up (PKCE would demand the code
 * verifier stored on the original device). Switching it to PKCE globally would
 * silently break cross-device email verification. So OAuth runs on a
 * dedicated PKCE client with its own storage key; the exchanged session is
 * handed to the main client, and the aux storage is wiped. Tokens are only
 * ever obtained from exchangeCodeForSession over TLS — never parsed out of a
 * redirect URL.
 */

export const MICROSOFT_REDIRECT_URL = "weglue://auth/callback";

/** Aux-client storage keys — cleaned after every exchange. */
const OAUTH_STORAGE_KEY = "weglue-oauth-pkce";
const OAUTH_STORAGE_KEYS = [OAUTH_STORAGE_KEY, `${OAUTH_STORAGE_KEY}-code-verifier`];

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

// persistSession MUST stay true: with false, auth-js falls back to a memory
// storage adapter and the PKCE code verifier would not survive the app being
// killed while the Microsoft browser sheet is open (cold-start return).
const oauthClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    storageKey: OAUTH_STORAGE_KEY,
    flowType: "pkce",
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type MicrosoftSignInResult =
  /** Session established on the main client. */
  | { status: "success" }
  /** User closed the browser sheet — not an error, show nothing scary. */
  | { status: "cancelled" }
  /** Another attempt is already running (double tap) — ignore. */
  | { status: "busy" }
  | { status: "error"; message: string };

// ─── Friendly copy (never expose OAuth/Supabase/Azure internals) ─────────────

export const MS_ERRORS = {
  unavailable:
    "Microsoft sign-in isn't available yet. Please log in with your school email and password.",
  unreachable: "We couldn't reach Microsoft. Check your connection and try again.",
  notEligible:
    "This Microsoft account isn't connected to an eligible school email (.edu or equivalent). Try your school Microsoft account instead.",
  noEmail:
    "We couldn't get an email address from that Microsoft account. Try another account, or sign up with your school email.",
  emailUnverified:
    "We couldn't verify a school email on that Microsoft account. Try again, or sign up with your school email and password.",
  expired: "Your Microsoft sign-in expired. Please try again.",
  generic: "Microsoft sign-in didn't finish. Please try again.",
} as const;

// ─── Callback URL parsing (pure — unit tested) ───────────────────────────────

export type ParsedOAuthCallback =
  | { kind: "code"; code: string }
  | { kind: "provider_error"; message: string }
  | { kind: "invalid" };

/**
 * Parses the redirect GoTrue issues to weglue://auth/callback. Success carries
 * ?code=…; failures carry ?error=…&error_description=…. The only provider
 * error surfaced verbatim-ish is our OWN before_user_created hook rejection
 * (recognized by its wording) — everything else maps to safe generic copy.
 */
export function parseOAuthCallback(url: string): ParsedOAuthCallback {
  if (typeof url !== "string" || url.length === 0) return { kind: "invalid" };

  let params: URLSearchParams;
  try {
    const query = url.split("#")[0].split("?")[1] ?? "";
    params = new URLSearchParams(query);
  } catch {
    return { kind: "invalid" };
  }

  const error = params.get("error");
  const errorCode = params.get("error_code");
  const description = params.get("error_description") ?? "";

  if (error || errorCode) {
    const text = description.toLowerCase();
    if (text.includes("university or college email")) {
      // Our before_user_created hook rejected the signup — ineligible email.
      return { kind: "provider_error", message: MS_ERRORS.notEligible };
    }
    if (text.includes("error getting user email") || text.includes("email not found")) {
      return { kind: "provider_error", message: MS_ERRORS.noEmail };
    }
    if (error === "access_denied" || errorCode === "access_denied") {
      // User declined consent inside Microsoft — treat like a cancel.
      return { kind: "provider_error", message: MS_ERRORS.generic };
    }
    return { kind: "provider_error", message: MS_ERRORS.generic };
  }

  const code = params.get("code");
  if (code && code.length > 0) return { kind: "code", code };
  return { kind: "invalid" };
}

// ─── Exchange (deduplicated — duplicate callbacks are idempotent) ─────────────

/** Codes already exchanged (or being exchanged) this app run. A replayed
 * callback URL (warm+cold double delivery, reopened link) never triggers a
 * second exchange or a second navigation. */
const inFlightByCode = new Map<string, Promise<MicrosoftSignInResult>>();
const handledCodes = new Set<string>();

async function exchangeAndHandOff(code: string): Promise<MicrosoftSignInResult> {
  const { data, error } = await oauthClient.auth.exchangeCodeForSession(code);

  if (error || !data?.session) {
    // Used/expired code or missing verifier — the flow can simply be retried.
    return { status: "error", message: MS_ERRORS.expired };
  }

  const { access_token, refresh_token } = data.session;
  const user = data.session.user;

  if (!user?.email) {
    // The hook should have rejected this before the user existed; guard anyway.
    await AsyncStorage.multiRemove(OAUTH_STORAGE_KEYS).catch(() => {});
    return { status: "error", message: MS_ERRORS.noEmail };
  }
  if (!user.email_confirmed_at) {
    // Azure app registration missing the email/xms_edov claims — never strand
    // the user on the password-account verify screen with no password.
    await AsyncStorage.multiRemove(OAUTH_STORAGE_KEYS).catch(() => {});
    return { status: "error", message: MS_ERRORS.emailUnverified };
  }

  // Hand the session to the main client (tokens come from the TLS exchange
  // response, not from the URL). onAuthStateChange in _layout.tsx takes over.
  const { error: setError } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  // The aux client's stored copy of the session + verifier is no longer needed.
  await AsyncStorage.multiRemove(OAUTH_STORAGE_KEYS).catch(() => {});

  if (setError) return { status: "error", message: MS_ERRORS.generic };
  return { status: "success" };
}

/**
 * Completes a Microsoft OAuth callback URL. Safe to call more than once with
 * the same URL (openAuthSessionAsync result AND the Linking listener can both
 * see it) — the exchange runs exactly once per code.
 */
export async function completeMicrosoftCallback(
  url: string,
): Promise<MicrosoftSignInResult> {
  const parsed = parseOAuthCallback(url);

  if (parsed.kind === "provider_error") {
    return { status: "error", message: parsed.message };
  }
  if (parsed.kind === "invalid") {
    return { status: "error", message: MS_ERRORS.generic };
  }

  if (handledCodes.has(parsed.code)) {
    // Replay of a callback we already finished this run: success if the
    // session it produced is still here, otherwise ask for a fresh attempt.
    const { data } = await supabase.auth.getSession();
    return data.session ? { status: "success" } : { status: "error", message: MS_ERRORS.expired };
  }

  let pending = inFlightByCode.get(parsed.code);
  if (!pending) {
    pending = exchangeAndHandOff(parsed.code).finally(() => {
      handledCodes.add(parsed.code);
      inFlightByCode.delete(parsed.code);
    });
    inFlightByCode.set(parsed.code, pending);
  }
  return pending;
}

// ─── The user-facing entry point ─────────────────────────────────────────────

let signInInFlight = false;

/** True while a foreground "Continue with Microsoft" attempt owns the flow —
 * lets the deep-link handler defer navigation to the screen that started it. */
export function isMicrosoftSignInActive(): boolean {
  return signInInFlight;
}

/**
 * Runs the whole "Continue with Microsoft" flow: builds the provider URL,
 * opens the system auth browser, and completes the callback. Exactly one
 * attempt can run at a time; a second tap gets "busy" and changes nothing.
 */
export async function signInWithMicrosoft(): Promise<MicrosoftSignInResult> {
  if (signInInFlight) return { status: "busy" };
  signInInFlight = true;

  try {
    const { data, error } = await oauthClient.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: MICROSOFT_REDIRECT_URL,
        skipBrowserRedirect: true,
        scopes: "openid profile email",
        // Always let the user pick which Microsoft account to use — after a
        // We Glue logout the next sign-in must not silently reuse the last
        // Microsoft session.
        queryParams: { prompt: "select_account" },
      },
    });

    if (error || !data?.url) {
      const msg = (error?.message ?? "").toLowerCase();
      if (msg.includes("provider is not enabled") || msg.includes("unsupported provider")) {
        return { status: "error", message: MS_ERRORS.unavailable };
      }
      return { status: "error", message: MS_ERRORS.unreachable };
    }

    const result = await WebBrowser.openAuthSessionAsync(
      data.url,
      MICROSOFT_REDIRECT_URL,
    );

    if (result.type === "success" && result.url) {
      return await completeMicrosoftCallback(result.url);
    }
    if (result.type === "cancel" || result.type === "dismiss") {
      return { status: "cancelled" };
    }
    return { status: "error", message: MS_ERRORS.generic };
  } catch {
    return { status: "error", message: MS_ERRORS.unreachable };
  } finally {
    signInInFlight = false;
  }
}

// ─── Post-OAuth onboarding completion (server-authoritative) ─────────────────

export type CompleteOnboardingStatus =
  | "completed"
  | "already_completed"
  | "username_taken"
  | "username_invalid"
  | "not_eligible"
  | "email_unverified"
  | "error";

export type CompleteOnboardingResult = {
  status: CompleteOnboardingStatus;
  /** Fresh profile row on completed / already_completed. */
  profile: Record<string, unknown> | null;
};

/**
 * Persists the pending survey + explicit username to a Microsoft-created
 * account and flips onboarding_completed — all validated server-side
 * (eligibility, verified email, username uniqueness) and idempotent, so a
 * double tap or a replayed call can never duplicate surveys or batches.
 */
export async function completeOAuthOnboarding(
  username: string,
  interests: string[],
  activities: string[],
): Promise<CompleteOnboardingResult> {
  const { data, error } = await supabase.rpc("complete_oauth_onboarding", {
    p_username: username.trim().replace(/^@/, ""),
    p_interests: interests,
    p_activities: activities,
  });

  if (error || !data?.status) return { status: "error", profile: null };

  const known: CompleteOnboardingStatus[] = [
    "completed",
    "already_completed",
    "username_taken",
    "username_invalid",
    "not_eligible",
    "email_unverified",
  ];
  const status = known.includes(data.status) ? (data.status as CompleteOnboardingStatus) : "error";
  return { status, profile: (data.profile as Record<string, unknown>) ?? null };
}
