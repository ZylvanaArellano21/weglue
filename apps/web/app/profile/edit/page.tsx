import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { EditProfileClient } from "../../../components/profile/EditProfileClient";

export const metadata = { title: "Edit Profile" };
export const dynamic = "force-dynamic";

export default async function EditProfilePage(): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <EditProfileClient userId={user.id} />;
}
