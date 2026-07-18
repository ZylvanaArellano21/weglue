"use server";

import { createClient } from "../../lib/supabase/server";
import { createAdminClient } from "../../lib/supabase/admin";

const EDU_REGEX = /^[^\s@]+@[^\s@]+\.edu$/i;

export interface SignupPayload {
  username: string;
  email: string;
  password: string;
  selectedInterests: string[];
  selectedActivities: string[];
  agreedToTerms: boolean;
  isOfAge: boolean;
}

export interface ActionError {
  field?: "username" | "email" | "password" | "terms" | "age" | "general";
  message: string;
}

export interface ActionResult {
  success: boolean;
  /** Where to navigate on success. Omitted when success is false. */
  redirectTo?: string;
  error?: ActionError;
}

export async function signupAction(
  payload: SignupPayload
): Promise<ActionResult> {
  const {
    username,
    email,
    password,
    selectedInterests,
    selectedActivities,
    agreedToTerms,
    isOfAge,
  } = payload;

  // Server-side .edu validation
  if (!EDU_REGEX.test(email.trim())) {
    return {
      success: false,
      error: {
        field: "email",
        message: "Only .edu email addresses are allowed.",
      },
    };
  }

  if (!agreedToTerms) {
    return {
      success: false,
      error: {
        field: "terms",
        message: "You must agree to the Terms of Service and Privacy Policy.",
      },
    };
  }

  if (!isOfAge) {
    return {
      success: false,
      error: {
        field: "age",
        message: "You must confirm you are 13 years of age or older.",
      },
    };
  }

  const cleanUsername = username.trim().replace(/^@/, "");
  const cleanEmail = email.trim().toLowerCase();

  const supabase = createClient();

  // Check username uniqueness before signup to give a cleaner error
  const { data: existingUser } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", cleanUsername)
    .maybeSingle();

  if (existingUser) {
    return {
      success: false,
      error: { field: "username", message: "Username is already taken." },
    };
  }

  // Call Supabase Auth signup
  const { data, error } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: {
      data: {
        username: cleanUsername,
        full_name: cleanUsername,
      },
      emailRedirectTo: `${
        process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
      }/auth/callback?from=signup`,
    },
  });

  if (error) {
    // Duplicate email
    if (
      error.message.toLowerCase().includes("already registered") ||
      error.message.toLowerCase().includes("user already registered")
    ) {
      return {
        success: false,
        error: { field: "email", message: "Email is already registered." },
      };
    }
    // Duplicate username (from trigger UNIQUE constraint)
    if (
      error.message.includes("duplicate key") ||
      error.message.includes("profiles_username_key")
    ) {
      return {
        success: false,
        error: { field: "username", message: "Username is already taken." },
      };
    }
    return {
      success: false,
      error: { field: "general", message: error.message },
    };
  }

  if (!data.user) {
    return {
      success: false,
      error: {
        field: "general",
        message: "Sign up failed. Please try again.",
      },
    };
  }

  const userId = data.user.id;

  // Use admin client to bypass RLS (user has no active session yet while
  // email confirmation is pending).
  try {
    const admin = createAdminClient();

    // Update profile created by the auto-trigger with legal consent fields
    await admin
      .from("profiles")
      .update({
        agreed_to_terms: true,
        agreed_at: new Date().toISOString(),
      })
      .eq("id", userId);

    // Persist onboarding survey selections
    if (selectedInterests.length > 0) {
      await admin
        .from("user_interests")
        .insert(selectedInterests.map((interest) => ({ user_id: userId, interest })));
    }

    if (selectedActivities.length > 0) {
      await admin
        .from("user_activities")
        .insert(
          selectedActivities.map((activity) => ({ user_id: userId, activity }))
        );
    }
  } catch (adminErr) {
    // Non-fatal: user can still complete onboarding. Log for observability.
    console.error("[signupAction] admin insert failed:", adminErr);
  }

  // If Supabase returned a session, email confirmation is disabled —
  // go straight to avatar setup.
  if (data.session) {
    return { success: true, redirectTo: "/onboarding/avatar" };
  }

  // Email confirmation is required — hold on the verify-email screen.
  return {
    success: true,
    redirectTo: `/onboarding/verify-email?email=${encodeURIComponent(cleanEmail)}`,
  };
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface LoginResult {
  success: boolean;
  redirectTo?: string;
  error?: ActionError;
}

export async function loginAction(payload: LoginPayload): Promise<LoginResult> {
  const { email, password } = payload;

  if (!EDU_REGEX.test(email.trim())) {
    return {
      success: false,
      error: {
        field: "email",
        message: "Please enter a valid .edu email address.",
      },
    };
  }

  const supabase = createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    if (
      error.message.toLowerCase().includes("email not confirmed") ||
      error.message.toLowerCase().includes("not confirmed")
    ) {
      return {
        success: false,
        error: {
          field: "email",
          message: "Please verify your email before logging in.",
        },
      };
    }
    return {
      success: false,
      error: { field: "general", message: "Invalid email or password." },
    };
  }

  if (!data.user) {
    return {
      success: false,
      error: { field: "general", message: "Login failed. Please try again." },
    };
  }

  // Email not confirmed → send to verification page
  if (!data.user.email_confirmed_at) {
    return { success: true, redirectTo: "/onboarding/verify-email" };
  }

  // Fetch profile to determine onboarding step. `onboarding_completed`
  // (migration 027) is the authoritative flag written by mobile + all
  // onboarding RPCs; the legacy `onboarding_complete` (migration 003) is not
  // kept in sync and must never gate routing. It is also checked BEFORE
  // avatar_url so a completed user with no custom picture lands on Home (the
  // exact state the Home "Personalize your picture!" prompt handles) rather
  // than being sent back into onboarding.
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, avatar_url")
    .eq("id", data.user.id)
    .single();

  if (!profile) {
    return { success: true, redirectTo: "/onboarding/avatar" };
  }

  if (profile.onboarding_completed) {
    return { success: true, redirectTo: "/home" };
  }

  // Determine next incomplete onboarding step
  if (!profile.avatar_url) {
    return { success: true, redirectTo: "/onboarding/avatar" };
  }

  return { success: true, redirectTo: "/onboarding/explore-clubs" };
}
