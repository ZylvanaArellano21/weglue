"use client";

import { validateEducationEmail } from "@weglue/shared";
import { getSupabaseBrowser } from "./supabase-browser";

// ─── Account Center (web) ────────────────────────────────────────────────────
//
// Port of apps/mobile/services/accountService.ts. Same tables, same columns,
// same cooldown, same validation, same typed results and the SAME user-facing
// messages — a student who changes their username on the web and then opens the
// phone must see one consistent account, and both platforms must refuse the
// same inputs for the same reasons.
//
// Deliberately NOT ported here: account deletion. On web that already lives at
// /account/delete → POST /api/account/delete → the `delete-account` Edge
// Function, which is the same server-side deletion mobile calls. Account Center
// links to that flow rather than growing a second one.

const COOLDOWN_DAYS = 30;

export const ACCOUNT_CENTER_ERRORS = {
  COOLDOWN: "cooldown",
  USERNAME_TAKEN: "username_taken",
  INVALID_EMAIL: "invalid_email",
  EMAIL_IN_USE: "email_in_use",
  SEND_FAILED: "send_failed",
  SESSION_EXPIRED: "session_expired",
  NETWORK: "network",
  WRONG_PASSWORD: "wrong_password",
  MISMATCH: "password_mismatch",
  WEAK_PASSWORD: "weak_password",
} as const;

export type AccountCenterError =
  (typeof ACCOUNT_CENTER_ERRORS)[keyof typeof ACCOUNT_CENTER_ERRORS];

/** Password strength: at least 8 chars, 1 uppercase, 1 number. */
export function isStrongPassword(password: string): boolean {
  return password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDateForError(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Username ────────────────────────────────────────────────────────────────

export interface UsernameAvailability {
  available: boolean;
}

export async function checkUsernameAvailability(
  username: string,
  currentUserId: string
): Promise<UsernameAvailability> {
  if (!username.trim()) return { available: false };

  const supabase = getSupabaseBrowser();
  const { data } = await supabase
    .from("profiles")
    .select("id")
    // Usernames are stored lowercase, so availability is case-INSENSITIVE:
    // "Zylvana21" and "zylvana21" are the same handle and must not both exist.
    .eq("username", username.trim().toLowerCase())
    .neq("id", currentUserId)
    .maybeSingle();

  return { available: !data };
}

export type ChangeUsernameResult =
  | { success: true }
  | { success: false; error: AccountCenterError; message: string };

export async function changeUsername(
  userId: string,
  newUsername: string
): Promise<ChangeUsernameResult> {
  const supabase = getSupabaseBrowser();

  // Cooldown state first — a taken-username message would otherwise leak that
  // somebody else holds a handle the caller isn't even allowed to claim yet.
  const { data: profile } = await supabase
    .from("profiles")
    .select("username_changed_at")
    .eq("id", userId)
    .single();

  const changedAt = (profile as { username_changed_at?: string } | null)
    ?.username_changed_at;
  if (changedAt) {
    const nextAllowed = addDays(new Date(changedAt), COOLDOWN_DAYS);
    if (new Date() < nextAllowed) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.COOLDOWN,
        message: `You can change your username again on ${formatDateForError(nextAllowed)}.`,
      };
    }
  }

  const trimmed = newUsername.trim().toLowerCase();

  const { available } = await checkUsernameAvailability(trimmed, userId);
  if (!available) {
    return {
      success: false,
      error: ACCOUNT_CENTER_ERRORS.USERNAME_TAKEN,
      message: "That username is already taken.",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ username: trimmed, username_changed_at: new Date().toISOString() })
    .eq("id", userId);

  if (error) throw error;
  return { success: true };
}

// ─── Email ───────────────────────────────────────────────────────────────────

export type ChangeEmailResult =
  | { success: true }
  | { success: false; error: AccountCenterError; message: string };

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Safe email-change flow (identical to mobile):
 *   1. Validate locally (format + .edu) — instant, no network.
 *   2. Confirm the session is still alive (local check, no network).
 *   3. Ask Supabase Auth to start the change. GoTrue itself rejects an address
 *      already registered to another account, so nothing is sent in that case;
 *      on success it emails a verification link to the NEW address. The account
 *      email does NOT change until that link is opened — we never write the new
 *      address into `profiles` ourselves.
 *   4. Every failure path returns a typed result (never throws), so the UI can
 *      re-enable the button and show a clear message without freezing.
 */
export async function changeEmail(
  userId: string,
  newEmail: string
): Promise<ChangeEmailResult> {
  try {
    const supabase = getSupabaseBrowser();
    const trimmedEmail = newEmail.trim().toLowerCase();

    if (!EMAIL_FORMAT_REGEX.test(trimmedEmail)) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.INVALID_EMAIL,
        message: "Please enter a valid email address.",
      };
    }

    const eduCheck = validateEducationEmail(trimmedEmail);
    if (!eduCheck.valid) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.INVALID_EMAIL,
        message: eduCheck.reason!,
      };
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (!session) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.SESSION_EXPIRED,
        message: "Your session has expired. Please log in again.",
      };
    }

    if (session.user.email?.toLowerCase() === trimmedEmail) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.INVALID_EMAIL,
        message: "That is already your current email address.",
      };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("email_changed_at")
      .eq("id", userId)
      .single();

    const changedAt = (profile as { email_changed_at?: string } | null)?.email_changed_at;
    if (changedAt) {
      const nextAllowed = addDays(new Date(changedAt), COOLDOWN_DAYS);
      if (new Date() < nextAllowed) {
        return {
          success: false,
          error: ACCOUNT_CENTER_ERRORS.COOLDOWN,
          message: `You can change your email again on ${formatDateForError(nextAllowed)}.`,
        };
      }
    }

    const { error } = await supabase.auth.updateUser({ email: trimmedEmail });

    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      const code = (error as { code?: string }).code ?? "";
      if (
        code === "email_exists" ||
        (msg.includes("already") &&
          (msg.includes("registered") || msg.includes("exists") || msg.includes("in use")))
      ) {
        return {
          success: false,
          error: ACCOUNT_CENTER_ERRORS.EMAIL_IN_USE,
          message: "That email is already used by another account.",
        };
      }
      if (
        code === "over_email_send_rate_limit" ||
        msg.includes("rate limit") ||
        msg.includes("security purposes")
      ) {
        return {
          success: false,
          error: ACCOUNT_CENTER_ERRORS.SEND_FAILED,
          message: "Too many attempts. Please wait a minute and try again.",
        };
      }
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.SEND_FAILED,
        message: "Could not send the verification email. Please try again.",
      };
    }

    // Track the cooldown only after the verification email actually sent.
    await supabase
      .from("profiles")
      .update({ email_changed_at: new Date().toISOString() })
      .eq("id", userId);

    return { success: true };
  } catch {
    return {
      success: false,
      error: ACCOUNT_CENTER_ERRORS.NETWORK,
      message: "Network error. Check your connection and try again.",
    };
  }
}

// ─── Password ────────────────────────────────────────────────────────────────

export type ChangePasswordResult =
  | { success: true }
  | { success: false; error: AccountCenterError; message: string };

export async function changePassword(
  newPassword: string,
  confirmPassword: string
): Promise<ChangePasswordResult> {
  if (newPassword !== confirmPassword) {
    return {
      success: false,
      error: ACCOUNT_CENTER_ERRORS.MISMATCH,
      message: "Passwords do not match.",
    };
  }

  if (!isStrongPassword(newPassword)) {
    return {
      success: false,
      error: ACCOUNT_CENTER_ERRORS.WEAK_PASSWORD,
      message:
        "Password must be at least 8 characters with one uppercase letter and one number.",
    };
  }

  // The plaintext never leaves this call: it goes straight to GoTrue over TLS
  // and is never written to a table, a log, or any cache.
  const { error } = await getSupabaseBrowser().auth.updateUser({
    password: newPassword,
  });
  if (error) {
    if (error.message.toLowerCase().includes("password")) {
      return {
        success: false,
        error: ACCOUNT_CENTER_ERRORS.WRONG_PASSWORD,
        message: error.message,
      };
    }
    throw error;
  }

  return { success: true };
}
