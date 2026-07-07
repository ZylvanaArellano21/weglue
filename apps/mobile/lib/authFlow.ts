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
