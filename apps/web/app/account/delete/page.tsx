import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { DeleteAccountClient } from "../../../components/account/DeleteAccountClient";

// Permanent, self-service account deletion for signed-in web users.
// Reachable from Your Profile → Delete Account.

export const metadata = { title: "Delete Account" };
export const dynamic = "force-dynamic";

export default async function DeleteAccountPage(): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed out (including landing here after a completed deletion): the public
  // help page explains how to delete without an account.
  if (!user) redirect("/login");

  return <DeleteAccountClient email={user.email ?? ""} />;
}
