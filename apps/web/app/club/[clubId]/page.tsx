import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { ClubProfileClient } from "../../../components/clubs/ClubProfileClient";

export const metadata = { title: "Club" };
export const dynamic = "force-dynamic";

// Canonical Club Profile — the SAME implementation opened from every entry point
// (Club-tab sidebar/catalog/search, Home cards, notifications). Middleware
// guarantees only verified, onboarded users reach it; RLS decides what content
// the viewer may see.
export default async function ClubProfilePage({
  params,
}: {
  params: { clubId: string };
}): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return <ClubProfileClient clubId={params.clubId} userId={user.id} />;
}
