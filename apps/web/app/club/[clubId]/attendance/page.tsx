import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { ClubAttendanceClient } from "../../../../components/clubs/ClubAttendanceClient";

export const metadata = { title: "QR attendance" };
export const dynamic = "force-dynamic";

// Club ⋯ → QR attendance. Officers/advisors only; reached from inside the
// already-authenticated app, so this follows the plain protected-page
// pattern (redirect to /login?next=…) rather than the checkin routes'
// deferred pendingCheckin mechanism.
export default async function ClubAttendancePage({
  params,
}: {
  params: { clubId: string };
}): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/club/${params.clubId}/attendance`)}`);
  }

  return <ClubAttendanceClient clubId={params.clubId} userId={user.id} />;
}
