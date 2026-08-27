"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SurveyChip,
  SurveyProgress,
  SurveyTopBar,
} from "../../../components/auth/SurveyChrome";
import {
  readOnboardingState,
  writeOnboardingState,
} from "../../../lib/onboardingState";
import { createClient } from "../../../lib/supabase/client";

// Same list and spelling as the mobile survey (the DB CHECK constraints on
// user_activities accept exactly these values).
const ACTIVITIES = [
  "Projects",
  "Volunteering",
  "Workshops",
  "Campus Fairs",
  "Trips",
  "Study Groups",
  "Networking",
  "Tournaments",
  "Social Events",
  "Campus Tours",
] as const;

export default function ActivitiesPage(): JSX.Element | null {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSelected(readOnboardingState().selectedActivities);
    setHydrated(true);
  }, []);

  function toggle(activity: string) {
    setError(null);
    setSelected((current) => {
      const next = current.includes(activity)
        ? current.filter((a) => a !== activity)
        : [...current, activity];
      writeOnboardingState({ selectedActivities: next });
      return next;
    });
  }

  async function handleFindMatches() {
    if (loading) return;
    if (selected.length === 0) {
      setError("Select at least one activity to find your matches.");
      return;
    }

    setLoading(true);
    const { selectedInterests } = readOnboardingState();
    try {
      // Same server-side ranking that will persist the recommendation batch at
      // signup, so the number shown is the number of clubs the account gets.
      // The server never returns 0 or 1 while the campus has at least two
      // eligible clubs — it tops the batch up with the best-ranked clubs.
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc(
        "preview_club_match_count",
        { p_interests: selectedInterests }
      );
      if (rpcError) throw rpcError;
      writeOnboardingState({
        selectedActivities: selected,
        matchCount: typeof data === "number" ? data : 0,
      });
    } catch {
      // Never strand the user on a network blip — the real batch is built
      // server-side at signup regardless of what we managed to preview here.
      writeOnboardingState({ selectedActivities: selected, matchCount: 0 });
    } finally {
      setLoading(false);
      router.push("/onboarding/profile-picture");
    }
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex justify-center px-4 py-5 sm:px-6 sm:py-8">
      <div className="w-full max-w-[820px]">
        <SurveyTopBar cancelHref="/onboarding/interests" />
        <SurveyProgress filled={2} step="Step 2 of 2" />

        <h1 className="text-[22px] sm:text-[27px] font-bold text-[#0FA6A6] leading-tight mt-6 sm:mt-9 mb-2 sm:mb-3">
          What do you enjoy doing?
        </h1>
        <p className="text-[14px] sm:text-[19px] text-[#0FA6A6] mb-6 sm:mb-9 leading-relaxed">
          Pick all the activities you love. This helps us personalize your feed.
        </p>

        <div
          role="group"
          aria-label="Activities"
          className="flex flex-wrap gap-x-2.5 gap-y-3 sm:gap-x-[22px] sm:gap-y-[26px] mb-8 sm:mb-10 sm:max-w-[790px]"
        >
          {ACTIVITIES.map((item) => (
            <SurveyChip
              key={item}
              label={item}
              selected={hydrated && selected.includes(item)}
              onToggle={() => toggle(item)}
            />
          ))}
        </div>

        <div className="flex items-center justify-end gap-3 sm:gap-5 pb-8 mt-8 sm:mt-24">
          <p aria-live="polite" className="text-[13px] sm:text-[15px] font-semibold text-[#F02719]">
            {error}
          </p>
          <button
            type="button"
            onClick={handleFindMatches}
            disabled={loading}
            className="h-[46px] px-6 sm:h-[56px] sm:px-10 bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-[15px] sm:text-[19px] rounded-full shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors disabled:opacity-60 flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            {loading && (
              <span
                aria-hidden
                className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
              />
            )}
            Find my matches
          </button>
        </div>
      </div>
    </main>
  );
}
