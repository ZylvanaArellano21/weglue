import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "./lib/supabase/middleware";

// Auth-flow pages a signed-in, fully-onboarded user has no business visiting —
// they bounce to the dashboard instead.
const AUTH_FLOW_ROUTES = [
  "/get-started",
  "/onboarding/interests",
  "/onboarding/activities",
  "/onboarding/signup",
  "/onboarding/verify-email",
  "/login",
  "/forgot-password",
];

// Routes that require a signed-in session.
const PROTECTED_PREFIXES = ["/dashboard", "/home", "/onboarding/explore-clubs"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow Next.js internals, API routes, and static assets through
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$/.test(pathname)
  ) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createMiddlewareClient(request, response);

  // getUser() validates the JWT on every request — required for secure middleware
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = PROTECTED_PREFIXES.some((r) => pathname.startsWith(r));
  const isAuthFlow = AUTH_FLOW_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`)
  );

  // ── Unauthenticated users ──────────────────────────────────────────────────

  if (!user) {
    if (isProtected) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    // The whole auth flow (surveys, signup, confirm-email, login, forgot
    // password, email-link landing pages) is public by design: signups have
    // no session until the email is verified.
    return response;
  }

  // ── Authenticated users ────────────────────────────────────────────────────

  // /auth/* handles its own session states (recovery links must render their
  // form even though the recovery session is technically "authenticated").
  if (pathname.startsWith("/auth/")) return response;

  const isEmailVerified = !!user.email_confirmed_at;

  if (!isEmailVerified) {
    // A session without a verified email may only sit on the confirm screen.
    if (isProtected) {
      return NextResponse.redirect(
        new URL("/onboarding/verify-email", request.url)
      );
    }
    return response;
  }

  // Verified session. An account that never finished We Glue onboarding must
  // complete it (username + survey) before entering the app.
  if (isProtected || isAuthFlow) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_completed")
      .eq("id", user.id)
      .maybeSingle();

    const onboardingPending = profile?.onboarding_completed === false;

    if (onboardingPending) {
      if (
        pathname.startsWith("/onboarding/signup") ||
        pathname.startsWith("/onboarding/interests") ||
        pathname.startsWith("/onboarding/activities")
      ) {
        return response; // let them finish
      }
      return NextResponse.redirect(new URL("/onboarding/signup", request.url));
    }

    // Fully onboarded — auth-flow pages bounce to the Home experience.
    if (isAuthFlow) {
      return NextResponse.redirect(new URL("/home", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     * - public static assets
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
