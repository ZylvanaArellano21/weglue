import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "./lib/supabase/middleware";

// Routes that are completely public — no session needed
const PUBLIC_ROUTES = new Set([
  "/",
  "/get-started",
  "/onboarding/interests",
  "/onboarding/activities",
  "/onboarding/signup",
  "/login",
  "/privacy-policy",
  "/terms-of-service",
  "/terms",
  "/delete-account",
  "/auth/callback",
]);

// Onboarding routes that require a valid (possibly unverified) session
const SESSION_REQUIRED_ROUTES = [
  "/onboarding/verify-email",
  "/onboarding/avatar",
  "/onboarding/explore-clubs",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow Next.js internals and static assets through
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

  const isPublic = PUBLIC_ROUTES.has(pathname);
  const needsSession = SESSION_REQUIRED_ROUTES.some((r) =>
    pathname.startsWith(r)
  );
  const isDashboard =
    pathname.startsWith("/dashboard") || pathname.startsWith("/home");

  // ── Unauthenticated users ──────────────────────────────────────────────────

  if (!user) {
    // Allow public routes through
    if (isPublic) return response;

    // Protected session routes → send to login
    if (needsSession || isDashboard) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    return response;
  }

  // ── Authenticated users ────────────────────────────────────────────────────

  const isEmailVerified = !!user.email_confirmed_at;

  // User confirmed their email but landed on verify-email (e.g. refreshed page)
  if (pathname === "/onboarding/verify-email" && isEmailVerified) {
    // Fetch profile to know next step. `onboarding_completed` (migration 027)
    // is the single source of truth written by mobile + all onboarding RPCs;
    // the legacy `onboarding_complete` (migration 003) is NOT kept in sync and
    // must never gate routing, or a freshly verified user is mis-routed.
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_completed, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.onboarding_completed) {
      return NextResponse.redirect(new URL("/home", request.url));
    }
    if (profile?.avatar_url) {
      return NextResponse.redirect(
        new URL("/onboarding/explore-clubs", request.url)
      );
    }
    return NextResponse.redirect(
      new URL("/onboarding/avatar", request.url)
    );
  }

  // Unverified user trying to access post-verification onboarding steps
  if (
    !isEmailVerified &&
    (pathname.startsWith("/onboarding/avatar") ||
      pathname.startsWith("/onboarding/explore-clubs") ||
      isDashboard)
  ) {
    return NextResponse.redirect(
      new URL("/onboarding/verify-email", request.url)
    );
  }

  // Verified + authenticated user on dashboard
  if (isDashboard && isEmailVerified) {
    return response; // pass through — they belong here
  }

  // Verified user hitting public/auth pages → redirect to the correct
  // onboarding step or the dashboard
  if (
    isEmailVerified &&
    (isPublic || pathname.startsWith("/login"))
  ) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_completed, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    // `onboarding_completed` is the authoritative completion flag. Once it is
    // true the user belongs on Home — even if they never set a custom avatar
    // (that's the exact state the Home "Personalize your picture!" prompt
    // handles). Checking avatar_url first used to bounce onboarded users back
    // into /onboarding/avatar, so it must NOT gate ahead of this.
    if (profile?.onboarding_completed) {
      return NextResponse.redirect(new URL("/home", request.url));
    }

    // Not finished yet — route through the remaining onboarding steps.
    if (!profile || !profile.avatar_url) {
      if (
        pathname.startsWith("/onboarding/avatar") ||
        pathname.startsWith("/onboarding/interests") ||
        pathname.startsWith("/onboarding/activities") ||
        pathname.startsWith("/onboarding/signup")
      ) {
        return response; // allow these survey steps
      }
      return NextResponse.redirect(
        new URL("/onboarding/avatar", request.url)
      );
    }

    if (pathname.startsWith("/onboarding/explore-clubs")) {
      return response;
    }
    return NextResponse.redirect(
      new URL("/onboarding/explore-clubs", request.url)
    );
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
