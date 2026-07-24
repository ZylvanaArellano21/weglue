import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { getFounderContext } from "../../lib/admin/founder";
import { AdminShell } from "../../components/admin/AdminShell";

// The dashboard reads live data per request and must never be statically cached.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "We Glue Admin",
  robots: { index: false, follow: false },
};

/**
 * Server-side founder gate for the ENTIRE /admin subtree. Runs on every request
 * to any /admin page. Note that this layout gate is defense-in-DEPTH only — each
 * data function and the search API independently call requireFounder(), so admin
 * data is unreachable even if a page were to bypass this layout.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { status, user } = await getFounderContext();

  if (status === "unauthenticated") {
    redirect("/login?next=/admin");
  }

  if (status === "denied") {
    return <AccessDenied email={user?.email ?? null} />;
  }

  return <AdminShell founderEmail={user?.email ?? "founder"}>{children}</AdminShell>;
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
