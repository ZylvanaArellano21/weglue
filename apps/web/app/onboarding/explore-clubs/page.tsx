"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";

interface Club {
  id: string;
  name: string;
  description: string;
  meeting_day: string | null;
  meeting_time_start: string | null;
  meeting_time_end: string | null;
  meeting_building: string | null;
  meeting_room: string | null;
  cover_image_url: string | null;
  member_count: number;
  matchScore: number;
  joined: boolean;
}

function formatTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = (h ?? 0) >= 12 ? "pm" : "am";
  const hour = (h ?? 0) > 12 ? (h ?? 0) - 12 : (h ?? 0) || 12;
  return `${hour}:${String(m ?? 0).padStart(2, "0")} ${period}`;
}

function Toast({
  message,
  type,
}: {
  message: string;
  type: "success" | "error" | "info";
}) {
  const bg =
    type === "error"
      ? "bg-[#F02719]"
      : type === "success"
      ? "bg-[#0FA6A6]"
      : "bg-gray-800";
  return (
    <div
      className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 ${bg} text-white font-semibold text-sm px-5 py-3 rounded-xl shadow-lg max-w-sm text-center`}
    >
      {message}
    </div>
  );
}

function ClubCard({
  club,
  onJoin,
}: {
  club: Club;
  onJoin: (club: Club) => void;
}) {
  const timeStr =
    club.meeting_time_start && club.meeting_time_end
      ? `${formatTime(club.meeting_time_start)} - ${formatTime(club.meeting_time_end)}`
      : null;
  const location =
    club.meeting_building && club.meeting_room
      ? `Building ${club.meeting_building}, Room ${club.meeting_room}`
      : null;

  return (
    <div className="bg-white rounded-[10px] overflow-hidden shadow-[0px_4px_3px_rgba(0,0,0,0.25)] hover:shadow-md transition-shadow flex flex-col">
      {/* Cover image / placeholder */}
      <div className="h-24 relative bg-[#E0F7F7]">
        {club.cover_image_url ? (
          <Image
            src={club.cover_image_url}
            alt={club.name}
            fill
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-3xl font-bold text-[#0FA6A6]">
              {club.name.charAt(0)}
            </span>
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col items-center gap-1 flex-1">
        <p className="text-sm font-semibold text-black text-center leading-tight">
          {club.name}
        </p>
        {club.meeting_day && (
          <p className="text-[10px] text-[#5F5D5D]">{club.meeting_day}</p>
        )}
        {timeStr && <p className="text-[10px] text-[#5F5D5D]">{timeStr}</p>}
        {location && (
          <p className="text-[10px] text-[#5F5D5D] text-center">{location}</p>
        )}
        <button
          type="button"
          onClick={() => onJoin(club)}
          disabled={club.joined}
          className={`mt-2 px-5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            club.joined
              ? "bg-[#E0F7F7] text-[#0FA6A6] cursor-default"
              : "bg-[#0FA6A6] text-white hover:bg-[#0d9494]"
          }`}
        >
          {club.joined ? "Joined ✓" : "Join"}
        </button>
      </div>
    </div>
  );
}

export default function ExploreClubsPage(): JSX.Element {
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  function showToast(
    message: string,
    type: "success" | "error" | "info" = "success"
  ) {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }

  const loadClubs = useCallback(async () => {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    const [
      { data: clubsData },
      { data: ciData },
      { data: memberData },
      { data: userInterests },
    ] = await Promise.all([
      supabase
        .from("clubs")
        .select(
          "id, name, description, meeting_day, meeting_time_start, meeting_time_end, meeting_building, meeting_room, cover_image_url, member_count"
        )
        .order("name"),
      supabase.from("club_interests").select("club_id, interest"),
      supabase.from("club_members").select("club_id").eq("user_id", user.id),
      supabase
        .from("user_interests")
        .select("interest")
        .eq("user_id", user.id),
    ]);

    const userInterestSet = new Set(
      (userInterests ?? []).map((r: { interest: string }) => r.interest)
    );
    const joinedSet = new Set(
      (memberData ?? []).map((m: { club_id: string }) => m.club_id)
    );

    const interestsByClub: Record<string, string[]> = {};
    (ciData ?? []).forEach(
      ({ club_id, interest }: { club_id: string; interest: string }) => {
        if (!interestsByClub[club_id]) interestsByClub[club_id] = [];
        interestsByClub[club_id].push(interest);
      }
    );

    const enriched: Club[] = (clubsData ?? []).map(
      (c: Omit<Club, "matchScore" | "joined">) => {
        const ci = interestsByClub[c.id] ?? [];
        const matches = ci.filter((i) => userInterestSet.has(i)).length;
        return {
          ...c,
          matchScore: ci.length > 0 ? matches / ci.length : 0,
          joined: joinedSet.has(c.id),
        };
      }
    );

    // Sort: matched first, then alphabetical
    enriched.sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return a.name.localeCompare(b.name);
    });

    setClubs(enriched);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    loadClubs();
  }, [loadClubs]);

  async function handleJoin(club: Club) {
    if (club.joined) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      showToast("Please log in to join clubs.", "error");
      return;
    }

    const { error } = await supabase
      .from("club_members")
      .insert({ club_id: club.id, user_id: user.id, role: "member" });

    if (error) {
      showToast("Could not join club. Try again.", "error");
      return;
    }

    setClubs((prev) =>
      prev.map((c) =>
        c.id === club.id
          ? { ...c, joined: true, member_count: c.member_count + 1 }
          : c
      )
    );
    showToast(`${club.name} joined! 🎉`, "success");
  }

  async function handleDone() {
    setFinishing(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      await supabase
        .from("profiles")
        .update({ onboarding_complete: true })
        .eq("id", user.id);

      router.push("/dashboard");
    } catch {
      showToast("Something went wrong. Please try again.", "error");
      setFinishing(false);
    }
  }

  const filtered = clubs.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );
  const matched = filtered.filter((c) => c.matchScore > 0);
  const others = filtered.filter((c) => c.matchScore === 0);
  const displayMatched = showAll ? matched : matched.slice(0, 6);
  const displayOthers = showAll ? others : others.slice(0, 6);

  return (
    <main className="min-h-screen bg-[#FEFCF0] px-4 py-6">
      {toast && <Toast message={toast.message} type={toast.type} />}

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          {/* Logo */}
          <Image src="/logo.png" alt="We Glue" width={36} height={36} />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDone}
              disabled={finishing}
              className="bg-[#0FA6A6] text-white font-semibold text-sm px-5 py-1.5 rounded-full hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center gap-1.5"
            >
              {finishing && (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              Done
            </button>
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="border border-black/20 text-black text-sm font-medium px-4 py-1.5 rounded-full hover:bg-black/5 transition-colors"
            >
              {showAll ? "Less" : "View All"}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5F5D5D] text-sm">
            🔍
          </span>
          <input
            type="text"
            placeholder="Search clubs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border border-black/15 rounded-full h-11 pl-10 pr-10 text-sm text-black placeholder:text-black/35 outline-none focus:border-[#0FA6A6] transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-[#5F5D5D] hover:text-black"
            >
              ✕
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <span className="w-8 h-8 border-4 border-[#0FA6A6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Matched clubs */}
            {matched.length > 0 && (
              <section className="mb-8">
                <h2 className="text-xl font-bold text-black mb-1">
                  Clubs matched for you
                </h2>
                <p className="text-xs text-[#5F5D5D] mb-4 leading-relaxed">
                  Based on your interests, we think you'd love these clubs. Tap
                  to join now. You can leave anytime.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {displayMatched.map((club) => (
                    <ClubCard
                      key={club.id}
                      club={club}
                      onJoin={handleJoin}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Other clubs */}
            {others.length > 0 && (
              <section className="mb-8">
                <h2 className="text-xl font-bold text-black mb-4">
                  Other clubs you might like
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {displayOthers.map((club) => (
                    <ClubCard
                      key={club.id}
                      club={club}
                      onJoin={handleJoin}
                    />
                  ))}
                </div>
              </section>
            )}

            {filtered.length === 0 && (
              <p className="text-center text-[#5F5D5D] py-16">
                No clubs found matching &quot;{search}&quot;
              </p>
            )}

            <div className="flex justify-center mt-4 mb-8">
              <Link
                href="/onboarding/interests"
                className="text-sm text-[#0FA6A6] font-medium underline hover:opacity-80"
              >
                Doesn&apos;t match your interests? Click here
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
