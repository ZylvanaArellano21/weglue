import { redirect } from "next/navigation";
import { getSecureAdminContext } from "../../../lib/admin/secureAdmin";
import { safeAdminNext } from "../../../lib/admin/adminEnv";
import { AdminLoginForm } from "../../../components/admin/AdminLoginForm";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata = {
  title: "Admin sign in",
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/**
 * The Admin Dashboard's OWN sign-in page.
 *
 * Separate from the student `/login` on purpose:
 *   • the student login belongs to the `.edu` signup/onboarding funnel and
 *     bounces every signed-in user to /home, ignoring `?next=`
 *   • an administrator sign-in must land back on the requested admin path and
 *     then continue into the MFA challenge
 *
 * This page is NOT linked from anywhere public — not from the student app, not
 * from the mobile apps, not from any navigation. It is reachable only by typing
 * the URL, or by middleware redirecting an already-targeted /admin request.
 *
 * Signing in here grants NOTHING on its own. It only establishes a Supabase
 * session; the account still has to be on the immutable UUID allowlist, pass
 * the optional email consistency check, and satisfy aal2 MFA before any admin
 * data loader will run.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const rawNext = typeof searchParams.next === "string" ? searchParams.next : "/admin";
  const next = safeAdminNext(rawNext);
  const expired = searchParams.expired === "1";

  const ctx = await getSecureAdminContext();

  // Portal off → the layout renders the "unavailable" shell; render nothing.
  if (ctx.status === "portal_disabled") return null;

  // Already signed in. Middleware normally forwards these before the page runs;
  // handle them here too so a direct hit can never strand a valid session.
  if (ctx.status === "authorized") redirect(next);
  if (ctx.status === "mfa_required") {
    redirect(`/admin/mfa?next=${encodeURIComponent(next)}`);
  }
  // status === "denied" → the layout renders the access-restricted card.
  if (ctx.status === "denied") return null;

  // status === "session_expired" → the stale session grants nothing; this page
  // is where re-authentication starts, so it renders the form with a notice.
  return <AdminLoginForm next={next} expired={expired || ctx.status === "session_expired"} />;
}
