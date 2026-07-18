import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { OwnProfileClient } from "../../components/profile/OwnProfileClient";

export const metadata = { title: "Your Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage(): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <OwnProfileClient userId={user.id} />;
}
