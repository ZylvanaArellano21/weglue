import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";
import { SearchClient } from "../../components/search/SearchClient";

export const metadata = { title: "Search" };
export const dynamic = "force-dynamic";

export default async function SearchPage(): Promise<JSX.Element> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <SearchClient userId={user.id} />;
}
