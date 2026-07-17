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

// Same list, order, and spelling as the mobile survey (the DB CHECK
// constraints on user_interests accept exactly these values).
const INTERESTS = [
  "Finance & Business",
  "Social Events",
  "Music",
  "Art & Culture",
  "Social Justice & Activism",
  "Numbers & Economics",
  "Sports & Athletics",
  "Gaming",
  "Health & Wellness",
  "Environment",
  "Community Service",
  "Crafts",
  "Religion",
  "Technology and Computer",
  "Film & Media",
  "Photography",
  "Strategy and Critical Thinking",
  "Writing",
  "Fashion",
  "Debate & Politics",
  "Theater",
  "Travel & Languages",
] as const;

export default function InterestsPage(): JSX.Element | null {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Restore selections (Back navigation, refresh, Terms round-trip).
  useEffect(() => {
    setSelected(readOnboardingState().selectedInterests);
    setHydrated(true);
  }, []);

  function toggle(interest: string) {
    setError(null);
    setSelected((current) => {
      const next = current.includes(interest)
        ? current.filter((i) => i !== interest)
        : [...current, interest];
      writeOnboardingState({ selectedInterests: next });
      return next;
    });
  }

  function handleNext() {
    if (selected.length === 0) {
      setError("Select at least one interest to continue.");
      return;
    }
    writeOnboardingState({ selectedInterests: selected });
    router.push("/onboarding/activities");
  }

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex justify-center px-6 py-8">
      <div className="w-full max-w-[820px]">
        <SurveyTopBar />
        <SurveyProgress filled={1} step="Step 1 of 2" />

        <h1 className="text-[27px] font-bold text-[#0FA6A6] leading-tight mt-9 mb-3">
          What are your interests?
        </h1>
        <p className="text-[19px] text-[#0FA6A6] mb-9 leading-relaxed">
          Select everything that excites you. We will match you to clubs that fit.
        </p>

        <div
          role="group"
          aria-label="Interests"
          className="flex flex-wrap gap-x-[22px] gap-y-[26px] mb-10"
        >
          {INTERESTS.map((item) => (
            <SurveyChip
              key={item}
              label={item}
              selected={hydrated && selected.includes(item)}
              onToggle={() => toggle(item)}
            />
          ))}
        </div>

        <div className="flex items-center justify-end gap-5 pb-8">
          <p aria-live="polite" className="text-[15px] font-semibold text-[#F02719]">
            {error}
          </p>
          <button
            type="button"
            onClick={handleNext}
            className="h-[56px] px-14 bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-[19px] rounded-full shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Next
          </button>
        </div>
      </div>
    </main>
  );
}
