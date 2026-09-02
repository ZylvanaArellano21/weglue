import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareClient } from "./lib/supabase/middleware";
import {
  isAllowlistedAdmin,
  isAdminSessionExpired,
  adminSessionMaxAgeSeconds,
  type AuthMethodEntry,
} from "./lib/admin/adminEnv";
import { platformAdminRedirectPath } from "./lib/auth/platformAdminGuard";
import { storeTargetFromUserAgent, storeUrlFor } from "./lib/deviceRouting";
import {
  restrictionRedirectPath,
  shouldLeaveRestrictedShell,
  type ServerAccessState,
} from "./lib/auth/restrictionGuard";
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
//
// The profile surfaces are here as defense in depth: each page already calls
// getUser() and redirects, but bouncing at the edge means a signed-out request
// (including a restored history entry after logout) never renders an
// authenticated shell at all, even for a frame.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/home",
  "/event/",
  "/post/",
  "/club/",
  "/clubs",
  "/messages",
  "/onboarding/explore-clubs",
  "/profile",
  "/u/",
  // Trailing slash on purpose: "/account-restricted" must NOT match.
  "/account/",
  "/settings/",
];

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

  // -- We Glue smart download routing --------------------------------------
  // `/download` is the single permanent QR destination. Resolve the obvious
  // phone cases from the User-Agent here - instant, no page flash, no JS - and
  // let everything a header cannot decide (desktop, crawlers, and modern
  // iPadOS Safari's "Macintosh" UA) fall through to the page, which refines
  // the call client-side via navigator.maxTouchPoints. Runs before getUser()
  // so a QR scan costs no auth round-trip. Store URLs are external, so this
  // can never loop.
  if (pathname === "/download" || pathname === "/download/") {
    const store = storeTargetFromUserAgent(request.headers.get("user-agent"));
    if (store) {
      return NextResponse.redirect(storeUrlFor(store));
    }
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

  // ── Administrator restriction containment (Day 10B2) ──────────────────────
  //
  // Runs for every signed-in student, on EVERY request — not just the
  // PROTECTED_PREFIXES set — so a deep link, a client-side navigation, or a
  // browser refresh all land on the restricted shell. Server actions and route
  // handlers are additionally denied by the database itself (migration 058),
  // so this is containment and clarity, never the sole control.
  //
  // One RPC per request for signed-in students. It is the SAME predicate the
  // enforcement layer uses, so the routing decision and the database can never
  // disagree, and it rides a partial index covering only restricted accounts.
  if (user) {
    // `my_access_state()` — NOT `get_account_access_state(uuid)`. The per-user
    // probe is service_role only so students cannot enumerate other accounts;
    // this one is scoped to auth.uid() inside the function body and returns the
    // generic 'restricted' rather than naming the internal classification.
    const { data: accessPayload } = await supabase.rpc("my_access_state");
    const state = ((accessPayload as { state?: string } | null)?.state ?? null) as
      | ServerAccessState
      | null;

    const restrictedPath = restrictionRedirectPath(state, pathname);
    if (restrictedPath) {
      return NextResponse.redirect(new URL(restrictedPath, request.url));
    }
    // A lapsed or lifted restriction releases the student on their next
    // request — no client timer, no manual refresh.
    if (shouldLeaveRestrictedShell(state, pathname)) {
      return NextResponse.redirect(new URL("/home", request.url));
    }
  }

  const isProtected = PROTECTED_PREFIXES.some((r) => pathname.startsWith(r));
  const isAuthFlow = AUTH_FLOW_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`)
  );

  // ── Unauthenticated users ──────────────────────────────────────────────────

  if (!user) {
    // A club QR scanned without the app installed must reach the club page's
    // own store-bounce (apps/web/app/club/[clubId]/page.tsx), not /login. The
    // `?source=qr` marker is set only by the mobile/web QR share screens.
    const isClubQr =
      pathname.startsWith("/club/") &&
      request.nextUrl.searchParams.get("source") === "qr";
    if (isProtected && !isClubQr) {
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
 *   • session past max age    → redirect to login (full re-auth + fresh MFA)
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
  const methods = (aal?.currentAuthenticationMethods ?? []) as AuthMethodEntry[];

  // ── Absolute administrator session maximum age ─────────────────────────────
  // Routing mirror of the server gate in secureAdmin.ts (which is the authority
  // and denies independently of this branch). Checked BEFORE any forwarding so
  // an aged session is never bounced around the MFA loop or forwarded onward
  // from a gate page. Only the sign-in page stays reachable, which is exactly
  // what re-authentication requires: a NEW session, then a NEW MFA challenge.
  if (isAdminSessionExpired(methods, Math.floor(Date.now() / 1000), adminSessionMaxAgeSeconds())) {
    if (isLoginPage) return secure(response);
    const back = pathname === "/admin/mfa" ? "/admin" : pathname;
    return redirectTo(`/admin/login?expired=1&next=${encodeURIComponent(back)}`);
  }

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
