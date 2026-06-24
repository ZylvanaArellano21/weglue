import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";

export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", session.user.id)
    .single();

  return (
    <main className="min-h-screen bg-cream flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-5xl text-teal font-zain font-bold mb-4">
          We Glue
        </h1>
        <p className="text-xl text-gray-700 mb-2">
          Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}! 🎉
        </p>
        <p className="text-gray-400">Your campus community is coming soon.</p>
      </div>
    </main>
  );
}
