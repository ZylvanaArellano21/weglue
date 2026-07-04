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
    // Fetch profile to know next step
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_complete, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.onboarding_complete) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
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
      .select("onboarding_complete, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || !profile.avatar_url) {
      // Still needs to set up avatar
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

    if (!profile.onboarding_complete) {
      if (pathname.startsWith("/onboarding/explore-clubs")) {
        return response;
      }
      return NextResponse.redirect(
        new URL("/onboarding/explore-clubs", request.url)
      );
    }

    // Fully onboarded — redirect to dashboard
    return NextResponse.redirect(new URL("/dashboard", request.url));
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
