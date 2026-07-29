import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { isPlatformAdminAuthUser } from "@weglue/shared/auth/platformAdmin";
import { AccountRestrictedActions } from "./AccountRestrictedActions";

// ─── Neutral blocked page for platform-admin identities ─────────────────────
//
// Where middleware sends a signed-in platform-admin session that tried to enter
// the student web app. It renders NO student data: no profile lookup, no feed,
// no clubs, no recommendations. It also never creates or repairs a profile row.
//
// It deliberately does NOT link to the Admin Dashboard and does not name its
// URL. The dashboard is reached separately, by someone who already knows where
// it is; a page on the public student origin must not advertise it.

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Account restricted — We Glue",
  robots: { index: false, follow: false },
};

export default async function AccountRestrictedPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in → nothing to explain. Ordinary students never belong here
  // either; send them back to the app rather than showing a scary message.
  if (!user) redirect("/login");
  if (!isPlatformAdminAuthUser(user)) redirect("/home");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FEFCF0] px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-2xl">
          🔒
        </div>
        <h1 className="mt-5 text-lg font-semibold text-gray-900">
          Account restricted
        </h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          This account is reserved for We Glue administration. Open the private
          Admin Dashboard login.
        </p>
        <p className="mt-4 text-xs text-gray-400">{user.email}</p>
        <AccountRestrictedActions />
      </div>
    </main>
  );
}
