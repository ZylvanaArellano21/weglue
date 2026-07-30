import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getSecureAdminContext } from "../../lib/admin/secureAdmin";
import { hasValidEntryTicket } from "../../lib/admin/entryTicket";
import { AdminShell } from "../../components/admin/AdminShell";

// The dashboard reads live data per request and must never be statically cached.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Metadata must be ticket-aware, and this is NOT cosmetic.
 *
 * Next resolves a segment's metadata independently of whether the segment renders
 * — so a STATIC `metadata` export here still emitted `<title>We Glue Admin</title>`
 * and `noindex` onto the concealed 404 page, announcing the dashboard's existence
 * to anyone probing /admin. Verified locally before this fix.
 *
 * Returning `{}` while concealed lets the root layout's metadata apply unchanged,
 * so the 404 matches what any mistyped URL produces. The real admin metadata is
 * only attached once a valid entry ticket is present.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (!(await hasValidEntryTicket())) return {};
  return {
    title: "We Glue Admin",
    robots: { index: false, follow: false, nocache: true, noarchive: true },
  };
}

/**
 * Server-side secure gate for the ENTIRE /admin subtree. Runs on every request.
 * This layout gate is defense-in-DEPTH: middleware routes aal1 sessions to the
 * MFA challenge, and each data loader / action / route independently calls
 * requireSecureAdmin(), so admin data is unreachable even if a page bypassed
 * this layout.
 *
 * Render matrix by secure status:
 *   • portal_disabled → safe "unavailable" state, no service-role client built
 *   • unauthenticated → redirect to login (with return path)
 *   • denied          → access-restricted card
 *   • mfa_required    → bare shell that renders children (the /admin/mfa flow);
 *                        no navigation, no data. Any data page reached here has
 *                        its own loader throw, so nothing leaks.
 *   • authorized      → the full dashboard shell
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  // ── Private entry gateway: concealment BEFORE anything else ────────────────
  // Without a valid entry ticket this whole subtree does not exist. notFound()
  // renders Next's ordinary 404 for the requested URL — same body, same headers,
  // real 404 status — so /admin is indistinguishable from a mistyped path. It runs
  // first so no session lookup, no service-role client and none of the states
  // below (which name the portal, the founder, or MFA) can be reached or observed.
  //
  // This is concealment only. It grants nothing: getSecureAdminContext() below
  // still applies the portal switch, the validated session, the immutable founder
  // UUID allowlist, the founder email check and aal2 MFA, unchanged.
  if (!(await hasValidEntryTicket())) notFound();

  const { status, user, sessionExpiresAtMs } = await getSecureAdminContext();

  if (status === "portal_disabled") {
    return <PortalUnavailable />;
  }

  if (status === "unauthenticated") {
    // Render the gate page bare (the dashboard's own /admin/login, or /admin/mfa
    // reached without a session). Middleware already redirects every OTHER
    // unauthenticated admin path to /admin/login before this layout runs, so
    // reaching here on a data page would mean middleware was bypassed — and
    // that page's own requireSecureAdmin() still throws. Fail-closed either way.
    // Deliberately NOT the student /login: admin sign-in is separate from
    // student onboarding, and the student login ignores ?next=.
    return <SecureBareShell>{children}</SecureBareShell>;
  }

  if (status === "denied") {
    return <AccessDenied email={user?.email ?? null} />;
  }

  if (status === "session_expired") {
    // The session outlived its absolute maximum age. Every loader on this page
    // independently throws `session_expired`, so nothing renders with data —
    // this is only the human-readable landing for that state.
    return <SessionExpired />;
  }

  if (status === "mfa_required") {
    // Only the MFA page belongs here; middleware routes other admin paths to it.
    return <SecureBareShell>{children}</SecureBareShell>;
  }

  return (
    <AdminShell
      founderEmail={user?.email ?? "founder"}
      sessionExpiresAtMs={sessionExpiresAtMs}
    >
      {children}
    </AdminShell>
  );
}

function SecureBareShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-gray-50">{children}</div>;
}

function PortalUnavailable() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-2xl">
          ⏸️
        </div>
        <h1 className="mt-5 text-lg font-semibold text-gray-900">Admin portal unavailable</h1>
        <p className="mt-2 text-sm text-gray-500">
          The We Glue Admin Dashboard is currently turned off. No administration data is being
          served. Please try again later.
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/home"
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600"
          >
            Go to We Glue
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Absolute-session-age landing. Deliberately states no timings: not when the
 * session started, not how long the window is, not how far past it the session
 * is. "Sign in again" is the whole message.
 */
function SessionExpired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl">
          ⏳
        </div>
        <h1 className="mt-5 text-lg font-semibold text-gray-900">Administrator session expired</h1>
        <p className="mt-2 text-sm text-gray-500">
          For security, administrator sessions end after a fixed period. Sign in again and complete
          multi-factor verification to continue.
        </p>
        <div className="mt-6 flex justify-center">
          <Link
            href="/admin/login?expired=1"
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600"
          >
            Sign in again
          </Link>
        </div>
      </div>
    </div>
  );
}

function AccessDenied({ email }: { email: string | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-2xl">
          🔒
        </div>
        <h1 className="mt-5 text-lg font-semibold text-gray-900">Admin access restricted</h1>
        <p className="mt-2 text-sm text-gray-500">
          Your account{email ? ` (${email})` : ""} is signed in but is not authorized for the We Glue
          Admin Dashboard. This area is limited to the founder.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/home"
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-600"
          >
            Go to We Glue
          </Link>
        </div>
      </div>
    </div>
  );
}
