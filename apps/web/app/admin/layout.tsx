import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { getSecureAdminContext } from "../../lib/admin/secureAdmin";
import { AdminShell } from "../../components/admin/AdminShell";

// The dashboard reads live data per request and must never be statically cached.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata = {
  title: "We Glue Admin",
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

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
  const { status, user, nextLevel } = await getSecureAdminContext();

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

  if (status === "mfa_required") {
    // Only the MFA page belongs here; middleware routes other admin paths to it.
    return <SecureBareShell>{children}</SecureBareShell>;
  }

  return (
    <AdminShell founderEmail={user?.email ?? "founder"}>{children}</AdminShell>
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
