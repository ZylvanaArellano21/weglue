import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { ClubsClient } from "../../components/clubs/ClubsClient";

export const metadata = { title: "Clubs" };
export const dynamic = "force-dynamic";

// The web Club tab. Middleware guarantees only verified, onboarded users reach
// it. `?matches=1` (set when returning from the interests rerun launched here)
// scrolls the user to the freshly refreshed "Suggested for you" section.
export default async function ClubsPage({
  searchParams,
}: {
  searchParams: { matches?: string };
}): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <ClubsClient userId={user.id} scrollToSuggested={searchParams.matches === "1"} />;
}
