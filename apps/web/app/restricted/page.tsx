import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { RestrictedActions } from "./RestrictedActions";

// ─── Restricted-account shell (student web) ─────────────────────────────────
//
// Day 10B2. Where middleware sends a signed-in student whose account is
// suspended or platform-blocked.
//
// It renders NO student data: no feed, no clubs, no people, no recommendations.
// The only things here are a generic explanation, the public support contact,
// the store-policy pages, sign-out, and account deletion.
//
// THE INTERNAL REASON IS NOT AVAILABLE TO THIS PAGE, by construction rather
// than by discipline: `my_access_state()` cannot return it, and the
// `account_restrictions` table has zero RLS policies, so a student session has
// no path to it at all.

export const metadata = {
  title: "Account restricted — We Glue",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function RestrictedPage(): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("my_access_state");
  const payload = (data ?? {}) as {
    state?: "active" | "suspended" | "restricted" | "deletion_pending";
    suspended_until?: string | null;
    violation_category?: string | null;
    public_reason?: string | null;
    scheduled_deletion_at?: string | null;
    appeal_deadline?: string | null;
    support_email?: string | null;
  };

  // Not restricted (lifted, or lapsed) → back to the app. Middleware does this
  // too; the duplicate check makes a direct visit behave correctly as well.
  if (!payload.state || payload.state === "active") redirect("/home");

  const support = payload.support_email || "zylvana.arellano.campos@gmail.com";
  const until = payload.suspended_until ? new Date(payload.suspended_until) : null;
  const suspended = payload.state === "suspended";
  const deletionPending = payload.state === "deletion_pending";
  const deletionDate = payload.scheduled_deletion_at ? new Date(payload.scheduled_deletion_at) : null;
  const appealDate = payload.appeal_deadline ? new Date(payload.appeal_deadline) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FEFCF0] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-2xl">
          🔒
        </div>

        <h1 className="mt-5 text-lg font-semibold text-gray-900">
          {deletionPending
            ? `Your We Glue account is scheduled for permanent deletion on ${deletionDate && !Number.isNaN(deletionDate.getTime()) ? deletionDate.toLocaleDateString() : "the scheduled date"}.`
            : suspended
            ? "Your We Glue access is temporarily suspended."
            : "Your access to We Glue has been restricted."}
        </h1>

        <p className="mt-3 text-sm leading-6 text-gray-600">
          You can’t use We Glue right now. Your account and everything in it — your
          posts, messages, clubs and events — are still here and have not been
          deleted.
        </p>

        <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">Violation</p>
          <p className="mt-0.5 text-sm font-semibold text-gray-900">{payload.violation_category || "Community Guidelines violation"}</p>
          <p className="mt-3 text-[11px] uppercase tracking-wide text-gray-400">Reason</p>
          <p className="mt-0.5 text-sm leading-6 text-gray-700">{payload.public_reason || "Your account was suspended because activity associated with it violated the We Glue Community Guidelines. Contact support for more information."}</p>
        </div>

        {until && !Number.isNaN(until.getTime()) && (
          <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">
              Access returns on
            </p>
            <p className="mt-0.5 text-sm font-semibold text-gray-900">
              {until.toLocaleString()}
            </p>
          </div>
        )}
        {deletionPending && appealDate && !Number.isNaN(appealDate.getTime()) && (
          <p className="mt-3 text-sm text-gray-600">Appeal deadline: <strong>{appealDate.toLocaleString()}</strong></p>
        )}

        <p className="mt-5 text-sm text-gray-600">
          If you believe this action was made in error, contact{" "}
          <a href={`mailto:${support}`} className="font-medium text-[#0FA6A6] hover:underline">
            {support}
          </a>
          {" "}and include your We Glue username.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs">
          <Link href="/privacy-policy" className="text-[#0FA6A6] hover:underline">
            Privacy Policy
          </Link>
          <Link href="/terms" className="text-[#0FA6A6] hover:underline">
            Terms of Use
          </Link>
          <Link href="/community-guidelines" className="text-[#0FA6A6] hover:underline">
            Community Guidelines
          </Link>
        </div>

        <p className="mt-6 text-[11px] text-gray-400">{user.email}</p>

        {/* Account deletion stays reachable. A restricted account must never
            become one the student cannot leave (App Store 5.1.1(v)). */}
        <RestrictedActions />
      </div>
    </main>
  );
}
