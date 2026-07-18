import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { InterestsRerunClient } from "../../components/profile/InterestsRerunClient";

export const metadata = { title: "Interests" };
export const dynamic = "force-dynamic";

export default async function InterestsRerunPage(): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <InterestsRerunClient userId={user.id} />;
}
