import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { HomeClient } from "../../components/home/HomeClient";

export const metadata = { title: "Home" };
// Auth + realtime make this inherently dynamic.
export const dynamic = "force-dynamic";

// The web Home experience. First-login lands here directly on the Events tab —
// no separate Congratulations screen (that appears ONLY on the interests
// rerun). The middleware guarantees only verified, onboarded users reach it.
export default async function HomePage(): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <HomeClient userId={user.id} />;
}
