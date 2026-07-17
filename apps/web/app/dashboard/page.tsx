import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "../../lib/supabase/server";
import { ClubMatchesSection } from "../../components/home/ClubMatchesSection";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage(): Promise<JSX.Element> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, full_name, avatar_url")
    .eq("id", user.id)
    .single();

  async function handleSignOut() {
    "use server";
    const supabaseServer = createClient();
    await supabaseServer.auth.signOut();
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0]">
      {/* Top nav */}
      <nav className="bg-white border-b border-black/5 px-6 h-14 flex items-center justify-between max-w-5xl mx-auto">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Image src="/logo.png" alt="We Glue" width={28} height={28} />
          <span
            className="font-bold text-base text-black"
            style={{ fontFamily: "var(--font-zain)" }}
          >
            We Glue
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {profile?.avatar_url ? (
            <Image
              src={profile.avatar_url}
              alt={profile.username ?? "avatar"}
              width={32}
              height={32}
              className="rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[#0FA6A6] flex items-center justify-center text-white text-sm font-bold">
              {(profile?.username ?? user.email ?? "?").charAt(0).toUpperCase()}
            </div>
          )}
          <form action={handleSignOut}>
            <button
              type="submit"
              className="text-xs text-[#5F5D5D] hover:text-[#0FA6A6] transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </nav>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-6 py-12 text-center">
        <h1
          className="text-3xl font-bold text-black mb-2"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          Welcome back
          {profile?.username ? `, ${profile.username}` : ""}!
        </h1>
        <p className="text-sm text-[#5F5D5D] mb-8">
          Your campus community is here. More features coming soon.
        </p>

        {/* The persistent club-match batch promised during signup — same
            server-side batch the mobile Home tab shows. */}
        <ClubMatchesSection userId={user.id} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md mx-auto">
          <Link
            href="/onboarding/explore-clubs"
            className="bg-white rounded-xl shadow-sm border border-black/5 p-5 text-left hover:shadow-md transition-shadow"
          >
            <p className="text-2xl mb-2">🏛️</p>
            <p className="text-sm font-semibold text-black mb-1">Explore Clubs</p>
            <p className="text-xs text-[#5F5D5D]">Discover clubs that match your interests</p>
          </Link>
          <div className="bg-white rounded-xl shadow-sm border border-black/5 p-5 text-left opacity-50">
            <p className="text-2xl mb-2">📅</p>
            <p className="text-sm font-semibold text-black mb-1">Events</p>
            <p className="text-xs text-[#5F5D5D]">Coming soon</p>
          </div>
        </div>
      </div>
    </main>
  );
}
