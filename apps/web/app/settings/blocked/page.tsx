import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { BlockedAccountsClient } from "../../../components/settings/BlockedAccountsClient";

// ─── Settings → Blocked Accounts (student web) ──────────────────────────────
//
// PRIVACY PROPERTY: this page can only ever show blocks the signed-in student
// OWNS. That is enforced in the database, not here — `get_my_blocked_users()`
// scopes to auth.uid() inside the function body, and the `user_blocks` SELECT
// policy is `blocker_id = auth.uid()`. There is no request this page could make
// that would reveal who has blocked the viewer.

export const metadata = {
  title: "Blocked Accounts",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function BlockedAccountsPage(): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <BlockedAccountsClient userId={user.id} />;
}
