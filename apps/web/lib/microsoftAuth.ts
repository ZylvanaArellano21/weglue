"use client";

import { createClient } from "./supabase/client";

/**
 * Web "Continue with Microsoft" via Supabase's Azure OAuth provider.
 *
 * Unlike mobile (in-app browser sheet + custom-scheme redirect), the web uses
 * a full-page redirect: the browser client stores the PKCE verifier in a
 * cookie, GoTrue sends the user to Microsoft, and Microsoft returns to
 * /auth/callback where the server exchanges the code for a session. Errors
 * come back as ?error… query params on the callback and are mapped to the
 * same friendly copy the mobile app uses — never raw OAuth internals.
 */

// Same friendly copy as apps/mobile/lib/microsoftAuth.ts (web-local copy so
// no shared file changes).
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

/** Maps GoTrue error params (from the OAuth callback) to friendly copy. */
export function friendlyOAuthError(params: {
  error?: string | null;
  errorCode?: string | null;
  errorDescription?: string | null;
}): string {
  const text = (params.errorDescription ?? "").toLowerCase();
  if (text.includes("university or college email")) {
    // Our before_user_created hook rejected the signup — ineligible email.
    return MS_ERRORS.notEligible;
  }
  if (text.includes("error getting user email") || text.includes("email not found")) {
    return MS_ERRORS.noEmail;
  }
  return MS_ERRORS.generic;
}

export type StartMicrosoftResult = { ok: true } | { ok: false; message: string };

let inFlight = false;

/**
 * Starts the redirect flow. Exactly one attempt at a time; on success the
 * page navigates away to Microsoft, so callers only need to handle errors.
 */
export async function startMicrosoftSignIn(): Promise<StartMicrosoftResult> {
  if (inFlight) return { ok: false, message: "" };
  inFlight = true;

  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: "openid profile email",
        // Always let the user pick which Microsoft account to use — after a
        // We Glue logout the next sign-in must not silently reuse the last
        // Microsoft session.
        queryParams: { prompt: "select_account" },
      },
    });

    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("provider is not enabled") || msg.includes("unsupported provider")) {
        return { ok: false, message: MS_ERRORS.unavailable };
      }
      return { ok: false, message: MS_ERRORS.unreachable };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: MS_ERRORS.unreachable };
  } finally {
    inFlight = false;
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

export interface CompleteOnboardingResult {
  status: CompleteOnboardingStatus;
  profile: Record<string, unknown> | null;
}

/**
 * Persists the pending survey + explicit username to a Microsoft-created
 * account and flips onboarding_completed — validated server-side and
 * idempotent (same RPC the mobile app calls).
 */
export async function completeOAuthOnboarding(
  username: string,
  interests: string[],
  activities: string[]
): Promise<CompleteOnboardingResult> {
  const supabase = createClient();
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
  const status = known.includes(data.status)
    ? (data.status as CompleteOnboardingStatus)
    : "error";
  return { status, profile: (data.profile as Record<string, unknown>) ?? null };
}
