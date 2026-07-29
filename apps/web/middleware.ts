import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "./lib/supabase/middleware";
import { isAllowlistedAdmin } from "./lib/admin/adminEnv";
import { platformAdminRedirectPath } from "./lib/auth/platformAdminGuard";
import {
  ADMIN_ENTRY_COOKIE_NAME,
  ADMIN_ENTRY_INTERNAL_ROUTE,
  ADMIN_NOT_FOUND_ROUTE,
  adminEntryDecision,
  adminEntryCookieSecret,
  adminEntryPath,
  isEntryGateConfigured,
  readCookie,
  verifyEntryTicket,
} from "./lib/admin/entryGate";

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

  // ── Private administrator entry gateway (defense in depth) ─────────────────
  // Runs BEFORE getUser() on purpose: a concealed request must cost no Supabase
  // round-trip (so probing /admin cannot be used to generate auth load) and must
  // not depend on the auth service being reachable to stay concealed.
  //
  // This gate NEVER grants administrator access. A valid ticket only lifts the
  // 404 concealment so the existing chain below can run exactly as before:
  // portal switch → validated session → founder UUID → founder email → aal2 →
  // recent MFA → write switch. See lib/admin/entryGate.ts.
  const entryPath = adminEntryPath();
  const gateApplies =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === ADMIN_ENTRY_INTERNAL_ROUTE ||
    pathname.startsWith(`${ADMIN_ENTRY_INTERNAL_ROUTE}/`) ||
    pathname === ADMIN_NOT_FOUND_ROUTE ||
    pathname.startsWith(`${ADMIN_NOT_FOUND_ROUTE}/`) ||
    (!!entryPath && (pathname === entryPath || pathname === `${entryPath}/`));

  if (gateApplies) {
    // Only verify the ticket for paths the gate governs — student requests do no
    // crypto work at all (two string comparisons and out).
    const cookieSecret = adminEntryCookieSecret();
    const hasValidTicket = cookieSecret
      ? (await verifyEntryTicket(
          cookieSecret,
          readCookie(request.headers.get("cookie"), ADMIN_ENTRY_COOKIE_NAME)
        )) !== null
      : false;

    const decision = adminEntryDecision({
      pathname,
      hasValidTicket,
      entryPath,
      configured: isEntryGateConfigured(),
    });

    if (decision.action === "gateway") {
      // The private external path is served by the fixed internal handler. A
      // rewrite keeps the configured path out of any redirect Location header.
      return NextResponse.rewrite(new URL(ADMIN_ENTRY_INTERNAL_ROUTE, request.url));
    }

    if (decision.action === "conceal_admin") {
      // Pass through WITHOUT the Supabase session lookup below, so probing
      // /admin costs no auth round-trip. The /admin layout and each /admin/api
      // route call notFound() when the ticket is absent, which makes Next render
      // its OWN 404 for the requested URL.
      //
      // Deliberately NOT a rewrite: NextResponse.rewrite() stamps an
      // `x-middleware-rewrite` header that a genuine 404 does not carry, which
      // would itself reveal that /admin is handled specially.
      return NextResponse.next({ request });
    }

    if (decision.action === "conceal_internal") {
      // The internal implementation paths are not the secret, so a rewrite
      // artifact here reveals nothing. Rewriting to a route that does not exist
      // yields Next's ordinary not-found response.
      return NextResponse.rewrite(new URL(ADMIN_NOT_FOUND_ROUTE, request.url));
    }
    // decision.action === "admin_allowed" → fall through to the existing chain.
  }

  let response = NextResponse.next({ request });
  const supabase = createMiddlewareClient(request, response);

  // getUser() validates the JWT on every request — required for secure middleware
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── Admin portal: hardened routing + non-cacheable, non-indexable headers ──
  // Runs before the ordinary app routing so /admin has its own security posture.
  if (pathname.startsWith("/admin")) {
    return handleAdminRequest(request, response, supabase, user, pathname);
  }

  // ── Platform-admin containment ────────────────────────────────────────────
  // A platform-admin Auth identity is not a student and has no profiles row.
  // This runs BEFORE any student routing, so the onboarding_completed lookup
  // below (and every student page, feed, club and recommendation behind it) is
  // unreachable for it — nothing can create or require a student profile.
  // Returns null for every ordinary user, so student routing is untouched.
  const adminBlockPath = platformAdminRedirectPath(user, pathname);
  if (adminBlockPath) {
    return NextResponse.redirect(new URL(adminBlockPath, request.url));
  }

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

/**
 * Admin portal request handling. Every /admin response is stamped no-store +
 * X-Robots-Tag noindex. Routing (defense-in-depth on top of the per-loader
 * requireSecureAdmin gate):
 *   • portal off              → pass through; the layout renders "unavailable"
 *   • /admin/api/*            → pass through; the Route Handler enforces auth/JSON
 *   • /admin/mfa (gate page)  → always reachable so the founder can step up
 *   • no session              → redirect to login with a return path
 *   • not allowlisted         → pass through; the layout renders "access denied"
 *   • aal1 (MFA not satisfied)→ redirect to the MFA challenge
 *   • aal2 sitting on /mfa    → bounce forward to the intended admin path
 */
async function handleAdminRequest(
  request: NextRequest,
  response: NextResponse,
  supabase: ReturnType<typeof createMiddlewareClient>,
  user: { id: string; email?: string | null } | null,
  pathname: string
): Promise<NextResponse> {
  const secure = (res: NextResponse): NextResponse => {
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.headers.set("Pragma", "no-cache");
    res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    return res;
  };
  const redirectTo = (path: string): NextResponse =>
    secure(NextResponse.redirect(new URL(path, request.url)));

  // Kill switch: the layout/route own the "unavailable" state; just pass through.
  if (process.env.ADMIN_PORTAL_ENABLED !== "true") return secure(response);

  // APIs and Route Handlers enforce their own auth and must return JSON, never a
  // redirect, so a fetch() never silently follows a 3xx to an HTML page.
  if (pathname.startsWith("/admin/api")) return secure(response);

  // Pages that must stay reachable while the session is not yet fully verified:
  // the dashboard's OWN login (never the student /login — admin sign-in is
  // deliberately separate from student onboarding) and the MFA challenge.
  const isLoginPage = pathname === "/admin/login";
  const isGatePage = isLoginPage || pathname === "/admin/mfa";

  if (!user) {
    if (isGatePage) return secure(response);
    return redirectTo(`/admin/login?next=${encodeURIComponent(pathname)}`);
  }

  // Non-allowlisted signed-in users are handled by the layout (access denied).
  if (!isAllowlistedAdmin(user)) return secure(response);

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const level = aal?.currentLevel;

  if (level !== "aal2") {
    // An allowlisted aal1 session sitting on the login page has already signed
    // in — send it forward to the MFA challenge rather than leaving it there.
    if (isLoginPage) {
      const rawNext = request.nextUrl.searchParams.get("next") ?? "/admin";
      const nx = rawNext.startsWith("/admin") && !rawNext.startsWith("//") ? rawNext : "/admin";
      return redirectTo(`/admin/mfa?next=${encodeURIComponent(nx)}`);
    }
    if (isGatePage) return secure(response);
    return redirectTo(`/admin/mfa?next=${encodeURIComponent(pathname)}`);
  }

  // Fully verified admin already on a gate page → forward to destination.
  if (isGatePage) {
    const rawNext = request.nextUrl.searchParams.get("next") ?? "/admin";
    const next = rawNext.startsWith("/admin") && !rawNext.startsWith("//") ? rawNext : "/admin";
    return redirectTo(next);
  }

  return secure(response);
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
