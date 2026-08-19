import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { CalendarTabClient } from "../../components/calendar/CalendarTabClient";

export const metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function CalendarPage(): Promise<JSX.Element> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <CalendarTabClient userId={user.id} />;
}
