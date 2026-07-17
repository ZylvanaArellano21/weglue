"use client";

import { createClient } from "./supabase/client";

/**
 * Web mirror of the mobile auth-flow plumbing (apps/mobile/lib/authFlow.ts):
 * redirect URLs, the pending-signup marker, the shared resend cooldown, the
 * backend status probes, and Supabase→user error message mapping.
 *
 * Deliberately web-specific — browser storage instead of AsyncStorage, and
 * redirect URLs that return to THIS web app — so nothing here can alter
 * mobile behavior.
 */

export const RESEND_COOLDOWN_SECONDS = 60;

function siteOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://weglue.app";
}

/** Where the verification email link lands. Shared with the mobile flow's
 * landing page — it detects a web signup via the marker below. */
export function confirmEmailRedirect(): string {
  return `${siteOrigin()}/auth/confirm`;
}

/** Where the password-reset email link lands. */
export function resetPasswordRedirect(): string {
  return `${siteOrigin()}/auth/reset-password`;
}

// ─── Pending-signup marker (survives refresh; same-browser web flow) ─────────

const PENDING_EMAIL_KEY = "weglue-web/pending_confirmation_email";
/** Set when the signup/verification started on the WEB, so the /auth/confirm
 * landing page can route the user back into the web flow instead of showing
 * the "go back to the app" copy meant for mobile users. */
const WEB_FLOW_KEY = "weglue-web/auth_flow_origin";

export function setPendingSignupEmail(email: string): void {
  try {
    localStorage.setItem(PENDING_EMAIL_KEY, email.trim().toLowerCase());
    localStorage.setItem(WEB_FLOW_KEY, "web");
  } catch {}
}

export function getPendingSignupEmail(): string | null {
  try {
    return localStorage.getItem(PENDING_EMAIL_KEY)?.trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

export function clearPendingSignup(): void {
  try {
    localStorage.removeItem(PENDING_EMAIL_KEY);
    localStorage.removeItem(WEB_FLOW_KEY);
  } catch {}
}

export function isWebAuthFlow(): boolean {
  try {
    return localStorage.getItem(WEB_FLOW_KEY) === "web";
  } catch {
    return false;
  }
}

// ─── Resend cooldown (shared by Confirm Email and Login "Verify now") ────────

const RESEND_COOLDOWN_KEY = "weglue-web/resend_cooldown_until";

/**
 * The cooldown lives in localStorage, not component state, so a page refresh
 * cannot hand the user a fresh 60 seconds, and "Verify now" on Login and
 * "Resend Email" on Confirm Email share ONE countdown. Keyed by email so a
 * different account isn't silently blocked.
 */
export function startResendCooldown(email: string): void {
  try {
    const until = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
    localStorage.setItem(
      RESEND_COOLDOWN_KEY,
      JSON.stringify({ email: email.trim().toLowerCase(), until })
    );
  } catch {}
}

/** Seconds left on the active cooldown for this email (0 when free to send). */
export function getResendCooldownRemaining(email: string): number {
  try {
    const raw = localStorage.getItem(RESEND_COOLDOWN_KEY);
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

function releaseResendCooldown(): void {
  try {
    localStorage.removeItem(RESEND_COOLDOWN_KEY);
  } catch {}
}

export type ResendResult =
  | { ok: true }
  | { ok: false; cooldown: number }
  | { ok: false; message: string };

/**
 * Sends exactly ONE verification email and opens the 60s cooldown. The
 * cooldown is claimed BEFORE the network call so a double click cannot put
 * two emails in flight; a genuine failure releases it so the user can retry.
 */
export async function sendVerificationEmail(email: string): Promise<ResendResult> {
  const userEmail = email.trim().toLowerCase();
  if (!userEmail) return { ok: false, message: "Enter your email address first." };

  const remaining = getResendCooldownRemaining(userEmail);
  if (remaining > 0) return { ok: false, cooldown: remaining };

  startResendCooldown(userEmail);

  const supabase = createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: userEmail,
    options: { emailRedirectTo: confirmEmailRedirect() },
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
    // cooldown. Any other failure sent nothing, so release it.
    if (!throttled) releaseResendCooldown();

    return { ok: false, message: friendlyEmailSendError(error) };
  }

  return { ok: true };
}

// ─── Password-reset cooldown (same persistence pattern) ──────────────────────

const RESET_COOLDOWN_KEY = "weglue-web/reset_cooldown_until";

export function getResetCooldownRemaining(email: string): number {
  try {
    const raw = localStorage.getItem(RESET_COOLDOWN_KEY);
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

/** Sends a password-reset email with the same claim-first cooldown rules. */
export async function sendPasswordResetEmail(email: string): Promise<ResendResult> {
  const userEmail = email.trim().toLowerCase();
  if (!userEmail) return { ok: false, message: "Enter your email address first." };

  const remaining = getResetCooldownRemaining(userEmail);
  if (remaining > 0) return { ok: false, cooldown: remaining };

  try {
    const until = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
    localStorage.setItem(RESET_COOLDOWN_KEY, JSON.stringify({ email: userEmail, until }));
  } catch {}

  const supabase = createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(userEmail, {
    redirectTo: resetPasswordRedirect(),
  });

  if (error) {
    const code = (error.code ?? "").toLowerCase();
    const msg = (error.message ?? "").toLowerCase();
    const throttled =
      code === "over_email_send_rate_limit" ||
      error.status === 429 ||
      msg.includes("rate limit") ||
      msg.includes("too many") ||
      msg.includes("you can only request this after");
    if (!throttled) {
      try {
        localStorage.removeItem(RESET_COOLDOWN_KEY);
      } catch {}
    }
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
  username?: string
): Promise<SignupStatus> {
  const supabase = createClient();
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
  email: string
): Promise<"replaced" | "not_found" | "exists_verified" | "rate_limited" | "error"> {
  const supabase = createClient();
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

// ─── Password rules (identical to mobile signup validation) ──────────────────

export interface PasswordCheck {
  minLength: boolean;
  hasCapital: boolean;
  hasNumber: boolean;
  valid: boolean;
}

export function checkPassword(password: string): PasswordCheck {
  const minLength = password.length >= 8;
  const hasCapital = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return { minLength, hasCapital, hasNumber, valid: minLength && hasCapital && hasNumber };
}

/** First unmet requirement, phrased exactly like the mobile app. */
export function passwordError(password: string): string | null {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Password must include at least 1 capital letter.";
  if (!/[0-9]/.test(password)) return "Password must include at least 1 number.";
  return null;
}

// ─── Error mapping (never show raw Supabase errors) ──────────────────────────

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
