import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

/** Canonical deep link shared by native and web.  The destination stays behind
 * normal event RLS, so a link never discloses a members-only event. */
export default async function EventLinkPage({ params }: { params: { eventId: string } }): Promise<never> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const next = `/event/${params.eventId}`;
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  redirect(`/home?event=${encodeURIComponent(params.eventId)}`);
}
