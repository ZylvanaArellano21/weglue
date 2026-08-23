import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { RESEND_COOLDOWN_SECONDS } from "../constants/auth";

/**
 * Single source of truth for the auth/onboarding flow plumbing:
 * redirect URLs, the pending-signup marker, the backend status
 * probes, and Supabase→user error message mapping.
 *
 * Every email Supabase sends must redirect to one of these two URLs —
 * they are the only https URLs on the project's allow-list, they work
 * on iOS TestFlight, Android, and desktop mail clients alike, and the
 * web pages tell the user to come back to the app.
 */
export const CONFIRM_EMAIL_REDIRECT = "https://weglue.app/auth/confirm";
export const RESET_PASSWORD_REDIRECT = "https://weglue.app/auth/reset-password";

/** Where the Account Center "change email" verification link lands. Carries
 * its own `flow=email_change` marker (mirrors apps/web/lib/authFlow.ts's
 * emailChangeRedirect) so /auth/confirm never has to guess whether a
 * confirmation came from signup or from an existing user changing their
 * email in Account Center. */
export const CONFIRM_EMAIL_CHANGE_REDIRECT =
  "https://weglue.app/auth/confirm?flow=email_change";

export const PENDING_EMAIL_KEY = "@weglue/pending_confirmation_email";

// ─── Pending-signup marker (survives app restarts) ───────────────────────────

export async function setPendingSignupEmail(email: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_EMAIL_KEY, email.trim().toLowerCase());
}

export async function getPendingSignupEmail(): Promise<string | null> {
  const stored = await AsyncStorage.getItem(PENDING_EMAIL_KEY);
  return stored?.trim().toLowerCase() || null;
}

export async function clearPendingSignup(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_EMAIL_KEY);
}

// ─── Resend cooldown (shared by Confirm Email and Login) ─────────────────────

const RESEND_COOLDOWN_KEY = "@weglue/resend_cooldown_until";

/**
 * The resend cooldown lives in storage, not in a screen's state, because the
 * SAME cooldown has to hold across BOTH screens that can send a verification
 * email: tapping "Verify now" on Login starts a cooldown that Confirm Email
 * must already be counting down when it opens, and navigating back and forth
 * must not hand the user a fresh 60 seconds. Keyed by email so a different
 * account isn't silently blocked.
 */
export async function startResendCooldown(email: string): Promise<void> {
  const until = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
  await AsyncStorage.setItem(
    RESEND_COOLDOWN_KEY,
    JSON.stringify({ email: email.trim().toLowerCase(), until }),
  );
}

/** Seconds left on the active cooldown for this email (0 when free to send). */
export async function getResendCooldownRemaining(email: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(RESEND_COOLDOWN_KEY);
    if (!raw) return 0;
    const { email: storedEmail, until } = JSON.parse(raw) as {
      email: string;
      until: number;
    };
    if (storedEmail !== email.trim().toLowerCase()) return 0;
    const remaining = Math.ceil((until - Date.now()) / 1000);
    return remaining > 0 ? Math.min(remaining, RESEND_COOLDOWN_SECONDS) : 0;
  } catch {
    return 0;
  }
}

export type ResendResult =
  | { ok: true }
  | { ok: false; cooldown: number }
  | { ok: false; message: string };

/**
 * Sends exactly ONE verification email and opens the 60s cooldown.
 *
 * The cooldown is claimed BEFORE the network call, so a double tap (or a tap
 * on Login's "Verify now" followed immediately by one on Confirm Email) cannot
 * put two emails in flight. A genuine failure releases the cooldown so the
 * user isn't locked out of retrying by an error that sent nothing.
 */
export async function sendVerificationEmail(email: string): Promise<ResendResult> {
  const userEmail = email.trim().toLowerCase();
  if (!userEmail) return { ok: false, message: "Enter your email address first." };

  const remaining = await getResendCooldownRemaining(userEmail);
  if (remaining > 0) return { ok: false, cooldown: remaining };

  await startResendCooldown(userEmail);

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: userEmail,
    options: { emailRedirectTo: CONFIRM_EMAIL_REDIRECT },
  });

  if (error) {
    const code = (error.code ?? "").toLowerCase();
    const msg = (error.message ?? "").toLowerCase();
    const throttled =
      code === "over_email_send_rate_limit" ||
      error.status === 429 ||
      msg.includes("rate limit") ||
      msg.includes("you can only request this after");

    // A throttle means the provider is still holding us off — keep the
    // cooldown. Any other failure sent nothing, so release it and let the
    // user retry immediately rather than serving a pointless 60s wait.
    if (!throttled) await AsyncStorage.removeItem(RESEND_COOLDOWN_KEY);

    return { ok: false, message: friendlyEmailSendError(error) };
  }

  return { ok: true };
}

// ─── Backend status probes (SECURITY DEFINER RPCs, rate-limited) ─────────────

export type EmailStatus = "available" | "exists_verified" | "exists_unverified";
export type UsernameStatus = "available" | "taken" | "yours_pending" | null;

export type SignupStatus =
  | { kind: "ok"; emailStatus: EmailStatus; usernameStatus: UsernameStatus }
  | { kind: "rate_limited" }
  | { kind: "error" };

/**
 * Safe server-side answer to "does this email/username already exist and in
 * what state?" — never queries auth.users from the client.
 */
export async function checkSignupStatus(
  email: string,
  username?: string,
): Promise<SignupStatus> {
  const { data, error } = await supabase.rpc("auth_signup_status", {
    p_email: email.trim().toLowerCase(),
    p_username: username?.trim() ?? null,
  });

  if (error || !data) return { kind: "error" };
  if (data.status === "rate_limited") return { kind: "rate_limited" };
  if (data.status !== "ok") return { kind: "error" };

  return {
    kind: "ok",
    emailStatus: data.email_status as EmailStatus,
    usernameStatus: (data.username_status ?? null) as UsernameStatus,
  };
}

/**
 * Deletes an abandoned UNVERIFIED signup so a fresh signUp() can recreate it
 * with the latest password/username. The backend refuses verified accounts.
 */
export async function replacePendingSignup(
  email: string,
): Promise<"replaced" | "not_found" | "exists_verified" | "rate_limited" | "error"> {
  const { data, error } = await supabase.rpc("replace_pending_signup", {
    p_email: email.trim().toLowerCase(),
  });
  if (error || !data) return "error";
  switch (data.status) {
    case "pending_signup_replaced":
      return "replaced";
    case "not_found":
      return "not_found";
    case "exists_verified":
      return "exists_verified";
    case "rate_limited":
      return "rate_limited";
    default:
      return "error";
  }
}

// ─── Error mapping (never show raw Supabase errors) ──────────────────────────

/**
 * Maps a Supabase auth error to a clean user-facing message.
 * Returns null when the caller should handle the error case itself.
 */
export function friendlyEmailSendError(error: {
  message?: string;
  code?: string;
  status?: number;
}): string {
  const code = (error.code ?? "").toLowerCase();
  const msg = (error.message ?? "").toLowerCase();

  if (
    code === "over_email_send_rate_limit" ||
    error.status === 429 ||
    msg.includes("rate limit")
  ) {
    return "Email limit reached. Rate limited by the server. Try again in about an hour.";
  }
  if (msg.includes("you can only request this after")) {
    return `Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another email.`;
  }
  return "Something went wrong. Please try again.";
}
