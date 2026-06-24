"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOnboardingStore } from "@weglue/shared";
import { createClient } from "../../../lib/supabase/client";

const ACTIVITIES = [
  "Projects",
  "Volunteering",
  "Trips",
  "Workshops",
  "Social Events",
  "Campus Tours",
  "Tournaments",
  "Networking",
  "Study Groups",
  "Campus Fairs",
] as const;

export default function WebActivitiesPage() {
  const router = useRouter();
  const { selectedActivities, toggleActivity, selectedInterests, setMatchCount } =
    useOnboardingStore();
  const [loading, setLoading] = useState(false);

  async function handleFindMatches() {
    setLoading(true);
    try {
      let count = 0;
      if (selectedInterests.length > 0) {
        const supabase = createClient();
        const { data } = await supabase
          .from("club_interests")
          .select("club_id")
          .in("interest", selectedInterests);
        if (data && data.length > 0) {
          const uniqueClubIds = new Set(data.map((r: { club_id: string }) => r.club_id));
          count = uniqueClubIds.size;
        }
      }
      setMatchCount(count);
    } catch {
      setMatchCount(0);
    } finally {
      setLoading(false);
      router.push("/onboarding/signup");
    }
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex items-start justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        {/* Back */}
        <Link
          href="/onboarding/interests"
          className="inline-flex items-center text-black mb-4 hover:opacity-70 transition-opacity"
        >
          <span className="text-3xl leading-none">‹</span>
        </Link>

        {/* Progress bar — both halves teal */}
        <div className="mb-2">
          <div className="h-1.5 bg-[#0FA6A6] rounded-full" />
          <p className="text-xs font-medium text-[#5F5D5D] mt-1.5">Step 2 of 2</p>
        </div>

        <h1 className="text-[28px] font-bold text-black leading-tight mb-2 mt-4">
          What do you enjoy doing?
        </h1>
        <p className="text-sm text-[#5F5D5D] mb-6 leading-relaxed">
          Pick all the activities you love. This helps us personalize your feed.
        </p>

        {/* Chips */}
        <div className="flex flex-wrap gap-2.5 mb-10">
          {ACTIVITIES.map((item) => {
            const selected = selectedActivities.includes(item);
            return (
              <button
                key={item}
                onClick={() => toggleActivity(item)}
                className={`px-[18px] py-2.5 rounded-[40px] border text-sm font-medium transition-colors ${
                  selected
                    ? "bg-[#0FA6A6] border-[#0FA6A6] text-white"
                    : "bg-white border-black/20 text-black hover:border-[#0FA6A6] hover:text-[#0FA6A6]"
                }`}
              >
                {item}
              </button>
            );
          })}
        </div>

        {/* Find my matches button */}
        <div className="flex justify-end">
          <button
            onClick={handleFindMatches}
            disabled={loading}
            className="h-[52px] px-10 bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-[40px] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {loading && (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            Find my matches
          </button>
        </div>
      </div>
    </main>
  );
}
