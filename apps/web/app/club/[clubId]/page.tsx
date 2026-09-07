import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import { ClubProfileClient } from "../../../components/clubs/ClubProfileClient";
import { PublicClubTwin } from "../../../components/clubs/PublicClubTwin";
import { getPublicClubTwin } from "../../../lib/publicClub";

export const metadata = { title: "Club" };
export const dynamic = "force-dynamic";

// Canonical Club Profile — the SAME implementation opened from every entry point
// (Club-tab sidebar/catalog/search, Home cards, notifications). Middleware
// guarantees only verified, onboarded users reach it; RLS decides what content
// the viewer may see.
//
// The one exception middleware lets through unauthenticated is a scanned club
// QR (`?source=qr`). The installed app intercepts the universal / app link
// before the browser, so a browser that reaches this page has NO app. Instead
// of a bare store bounce it now renders the read-only public club "twin" —
// migration 131's get_public_club_profile envelope only (identity, meeting
// info, officer titles, member count, bounded public events / media / posts),
// with "Get We Glue" as the single participation affordance. A signed-in
// phone-web user still falls through to the full native-parity profile below.
export default async function ClubProfilePage({
  params,
  searchParams,
}: {
  params: { clubId: string };
  searchParams: { source?: string };
}): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return <ClubProfileClient clubId={params.clubId} userId={user.id} />;
  }

  // Unauthenticated. Middleware only allows this for `?source=qr`; any other
  // unauthenticated /club/* request was already redirected to /login.
  if (searchParams.source !== "qr") {
    redirect(`/login?next=${encodeURIComponent(`/club/${params.clubId}`)}`);
  }

  const twin = await getPublicClubTwin(params.clubId);
  if (!twin) {
    // Unknown / inactive / non-public club, or a malformed id — nothing public
    // to show, and no session to place. Send them to sign in.
    redirect(`/login?next=${encodeURIComponent(`/club/${params.clubId}`)}`);
  }

  return <PublicClubTwin club={twin} />;
}
