import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { UserProfileClient } from "../../../components/profile/UserProfileClient";

export const metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function UserProfilePage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Viewing your own id here → send to the editable own-profile page.
  if (user.id === params.id) redirect("/profile");
  return <UserProfileClient targetUserId={params.id} viewerUserId={user.id} />;
}
