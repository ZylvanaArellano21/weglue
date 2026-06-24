"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";

const INTERESTS = [
  "Finance & Business", "Social Events", "Music", "Fashion",
  "Art & Culture", "Social Justice & Activism", "Numbers & Economics",
  "Gaming", "Health & Wellness", "Environment", "Sports & Athletics",
  "Community Service", "Crafts", "Religion", "Technology and Computer",
  "Film & Media", "Photography", "Strategy and Critical Thinking",
  "Writing", "Theater", "Travel & Languages", "Debate & Politics",
] as const;

const ACTIVITIES = [
  "Projects", "Volunteering", "Workshops", "Campus Fairs",
  "Trips", "Study Groups", "Networking", "Tournaments",
  "Social Events", "Campus Tours",
] as const;

export default function SurveyPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [selectedInterests, setSelectedInterests] = useState<Set<string>>(new Set());
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  function toggle(set: Set<string>, item: string) {
    const next = new Set(set);
    next.has(item) ? next.delete(item) : next.add(item);
    return next;
  }

  async function handleSave() {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const interestRows = Array.from(selectedInterests).map((interest) => ({
      user_id: user.id,
      interest,
    }));
    const activityRows = Array.from(selectedActivities).map((activity) => ({
      user_id: user.id,
      activity,
    }));

    await Promise.all([
      interestRows.length > 0
        ? supabase.from("user_interests").insert(interestRows)
        : Promise.resolve(),
      activityRows.length > 0
        ? supabase.from("user_activities").insert(activityRows)
        : Promise.resolve(),
      supabase.from("user_privacy").upsert({
        user_id: user.id,
        is_private: false,
        hide_interests: false,
        hide_events: false,
      }),
    ]);

    setLoading(false);
    router.push("/home");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-cream px-4 py-12">
      <div className="max-w-2xl mx-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <Link href="/auth/avatar" className="text-teal text-sm">
            Cancel
          </Link>
          <h2 className="text-xl font-zain font-bold text-teal">Survey</h2>
          <div className="w-12" />
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-gray-200 rounded-full mb-2 overflow-hidden">
          <div
            className="h-full bg-teal rounded-full transition-all duration-300"
            style={{ width: step === 1 ? "50%" : "100%" }}
          />
        </div>
        <p className="text-center text-gray-500 text-sm mb-8">Step {step} of 2</p>

        {step === 1 ? (
          <>
            <h3 className="text-2xl font-zain font-bold text-teal mb-2">
              What are your interests?
            </h3>
            <p className="text-gray-500 text-sm mb-6">
              Select everything that excites you. We will match you to clubs that fit.
            </p>
            <div className="flex flex-wrap gap-2 mb-10">
              {INTERESTS.map((item) => {
                const selected = selectedInterests.has(item);
                return (
                  <button
                    key={item}
                    onClick={() => setSelectedInterests(toggle(selectedInterests, item))}
                    className={`px-4 py-2 rounded-full border text-sm transition-colors ${
                      selected
                        ? "bg-teal border-teal text-white"
                        : "bg-white border-gray-200 text-gray-700 hover:border-teal"
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="bg-teal text-white font-zain font-bold text-lg rounded-full px-8 py-3 hover:bg-teal/90 transition-colors"
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-2xl font-zain font-bold text-teal mb-2">
              What do you enjoy doing?
            </h3>
            <p className="text-gray-500 text-sm mb-6">
              Pick all the activities you love. This helps us personalize your feed.
            </p>
            <div className="flex flex-wrap gap-2 mb-10">
              {ACTIVITIES.map((item) => {
                const selected = selectedActivities.has(item);
                return (
                  <button
                    key={item}
                    onClick={() => setSelectedActivities(toggle(selectedActivities, item))}
                    className={`px-4 py-2 rounded-full border text-sm transition-colors ${
                      selected
                        ? "bg-teal border-teal text-white"
                        : "bg-white border-gray-200 text-gray-700 hover:border-teal"
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={loading}
                className="bg-teal text-white font-zain font-bold text-lg rounded-full px-8 py-3 hover:bg-teal/90 transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {loading ? (
                  <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
