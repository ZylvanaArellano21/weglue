import { redirect } from "next/navigation";
import { createClient } from "../../../../lib/supabase/server";
import { EventAttendanceClient } from "../../../../components/home/EventAttendanceClient";

export const metadata = { title: "Attendance" };
export const dynamic = "force-dynamic";

// Event ⋯ → Attendance. Officers/advisors only; reached from inside the
// already-authenticated app.
export default async function EventAttendancePage({
  params,
}: {
  params: { eventId: string };
}): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/event/${params.eventId}/attendance`)}`);
  }

  return <EventAttendanceClient eventId={params.eventId} userId={user.id} />;
}
