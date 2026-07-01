"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOnboardingStore } from "@weglue/shared";
import { createClient } from "../../../lib/supabase/client";

const INTERESTS = [
  "Finance & Business",
  "Social Events",
  "Music",
  "Fashion",
  "Art & Culture",
  "Social Justice & Activism",
  "Numbers & Economics",
  "Gaming",
  "Health & Wellness",
  "Environment",
  "Sports & Athletics",
  "Community Service",
  "Crafts",
  "Religion",
  "Technology and Computer",
  "Film & Media",
  "Photography",
  "Strategy and Critical Thinking",
  "Writing",
  "Theater",
  "Travel & Languages",
  "Debate & Politics",
] as const;

function LegalFooter() {
  return (
    <p className="text-center text-[10px] text-[#5F5D5D] mt-6">
      <Link href="/privacy-policy" className="hover:text-[#0FA6A6] underline">
        Privacy Policy
      </Link>
      {" · "}
      <Link href="/terms-of-service" className="hover:text-[#0FA6A6] underline">
        Terms of Service
      </Link>
    </p>
  );
}

export default function InterestsPage(): JSX.Element {
  const router = useRouter();
  const { selectedInterests, toggleInterest, setMatchCount } =
    useOnboardingStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live-update matched club count with 300ms debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (selectedInterests.length === 0) {
        setMatchCount(0);
        return;
      }
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("club_interests")
          .select("club_id")
          .in("interest", selectedInterests);

        const unique = new Set(
          (data ?? []).map((r: { club_id: string }) => r.club_id)
        );
        setMatchCount(unique.size);
      } catch {
        setMatchCount(0);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedInterests, setMatchCount]);

  return (
    <main className="min-h-screen bg-[#FEFCF0] flex items-start justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-5">
          <Link
            href="/get-started"
            className="text-sm font-medium text-[#5F5D5D] hover:text-black transition-colors"
          >
            Cancel
          </Link>
          <span className="text-sm font-semibold text-black">Survey</span>
          <Link
            href="/login"
            className="bg-[#0FA6A6] text-white text-sm font-semibold px-4 py-1.5 rounded-full hover:bg-[#0d9494] transition-colors"
          >
            Log In
          </Link>
        </div>

        {/* Progress bar */}
        <div className="mb-2">
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden flex">
            <div className="h-full bg-[#0FA6A6] rounded-full w-1/2" />
            <div className="h-full w-1/2" />
          </div>
          <p className="text-xs font-medium text-[#5F5D5D] mt-1.5">Step 1 of 2</p>
        </div>

        {/* Heading */}
        <h1
          className="text-[26px] font-bold text-[#0FA6A6] leading-tight mb-1 mt-4"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          What are your interests?
        </h1>
        <p className="text-sm text-[#0FA6A6] mb-6 leading-relaxed">
          Select everything that excites you. We will match you to clubs that fit.
        </p>

        {/* Interest pills */}
        <div className="flex flex-wrap gap-2.5 mb-10">
          {INTERESTS.map((item) => {
            const selected = selectedInterests.includes(item);
            return (
              <button
                key={item}
                type="button"
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

        {/* Next */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => router.push("/onboarding/activities")}
            className="h-[52px] px-12 bg-[#0FA6A6] text-[#FEFCF0] font-semibold text-base rounded-[40px] shadow-[0px_4px_4px_rgba(0,0,0,0.25)] hover:bg-[#0d9494] transition-colors"
          >
            Next
          </button>
        </div>

        <LegalFooter />
      </div>
    </main>
  );
}
