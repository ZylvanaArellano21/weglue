"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOnboardingStore } from "@weglue/shared";

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

export default function WebInterestsPage() {
  const router = useRouter();
  const { selectedInterests, toggleInterest } = useOnboardingStore();

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex items-start justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        {/* Back */}
        <Link href="/" className="inline-flex items-center text-black mb-4 hover:opacity-70 transition-opacity">
          <span className="text-3xl leading-none">‹</span>
        </Link>

        {/* Progress bar */}
        <div className="mb-2">
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden flex">
            <div className="h-full bg-[#0FA6A6] rounded-full w-1/2" />
            <div className="h-full w-1/2" />
          </div>
          <p className="text-xs font-medium text-[#5F5D5D] mt-1.5">Step 1 of 2</p>
        </div>

        {/* Heading */}
        <h1 className="text-[28px] font-bold text-black leading-tight mb-2 mt-4">
          What are your interests?
        </h1>
        <p className="text-sm text-[#5F5D5D] mb-6 leading-relaxed">
          Select everything that excites you. We will match you to clubs that fit.
        </p>

        {/* Chips */}
        <div className="flex flex-wrap gap-2.5 mb-10">
          {INTERESTS.map((item) => {
            const selected = selectedInterests.includes(item);
            return (
              <button
                key={item}
                onClick={() => toggleInterest(item)}
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

        {/* Next button */}
        <div className="flex justify-end">
          <button
            onClick={() => router.push("/onboarding/activities")}
            className="h-[52px] px-12 bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-[40px] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </main>
  );
}
