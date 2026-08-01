import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { MessagesClient } from "../../components/messages/MessagesClient";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function MessagesPage(): Promise<JSX.Element> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <MessagesClient userId={user.id} />;
}
