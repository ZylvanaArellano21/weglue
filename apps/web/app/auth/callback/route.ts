import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

/**
 * OAuth / PKCE callback for the web app (Microsoft sign-in, plus any legacy
 * code-based email links). Exchanges the code for a session, then routes:
 *   - Microsoft account that finished We Glue onboarding → /dashboard
 *   - Microsoft account that never finished onboarding  → /onboarding/signup
 *     (username choice + survey completion, mirroring the mobile flow)
 * Provider errors are mapped to the same friendly copy the mobile app shows —
 * never raw OAuth internals.
 */

function friendlyOAuthError(description: string | null): string {
  const text = (description ?? "").toLowerCase();
  if (text.includes("university or college email")) {
    // Our before_user_created hook rejected the signup — ineligible email.
    return "This Microsoft account isn't connected to an eligible school email (.edu or equivalent). Try your school Microsoft account instead.";
  }
  if (text.includes("error getting user email") || text.includes("email not found")) {
    return "We couldn't get an email address from that Microsoft account. Try another account, or sign up with your school email.";
  }
  return "Microsoft sign-in didn't finish. Please try again.";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const providerError = searchParams.get("error") ?? searchParams.get("error_code");

  if (providerError) {
    const message = friendlyOAuthError(searchParams.get("error_description"));
    return NextResponse.redirect(
      `${origin}/login?oauthError=${encodeURIComponent(message)}`
    );
  }

  if (code) {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data?.session) {
      const user = data.session.user;

      // Guard: the before_user_created hook should reject accounts without a
      // verified school email; never strand one in the app if it slips through.
      if (!user.email || !user.email_confirmed_at) {
        await supabase.auth.signOut();
        return NextResponse.redirect(
          `${origin}/login?oauthError=${encodeURIComponent(
            "We couldn't verify a school email on that Microsoft account. Try again, or sign up with your school email and password."
          )}`
        );
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user.id)
        .maybeSingle();

      if (profile && profile.onboarding_completed === false) {
        // New Microsoft identity — finish We Glue onboarding (explicit
        // username + survey) on the account-creation screen.
        return NextResponse.redirect(`${origin}/onboarding/signup`);
      }
      return NextResponse.redirect(`${origin}/dashboard`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?oauthError=${encodeURIComponent(
      "Your Microsoft sign-in expired. Please try again."
    )}`
  );
}
