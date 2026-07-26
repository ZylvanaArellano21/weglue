import { redirect } from "next/navigation";
import { getSecureAdminContext } from "../../../lib/admin/secureAdmin";
import { safeAdminNext } from "../../../lib/admin/adminEnv";
import { AdminMfaFlow } from "../../../components/admin/AdminMfaFlow";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata = {
  title: "Admin verification",
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/**
 * The MFA step-up screen. Reached when an allowlisted admin holds only an aal1
 * session. portal_disabled / denied / unauthenticated are owned by the /admin
 * layout (which renders/redirects appropriately) — here we only need to bounce
 * an already-aal2 session forward and render the challenge when it's required.
 */
export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const rawNext = typeof searchParams.next === "string" ? searchParams.next : "/admin";
  const next = safeAdminNext(rawNext);

  const ctx = await getSecureAdminContext();

  // Already fully verified — no reason to sit on the challenge screen.
  if (ctx.status === "authorized") redirect(next);

  // Only render the challenge when MFA is actually the missing step. Every other
  // status is handled by the layout shell wrapping this page.
  if (ctx.status !== "mfa_required") return null;

  return <AdminMfaFlow next={next} email={ctx.user?.email ?? "founder"} />;
}
