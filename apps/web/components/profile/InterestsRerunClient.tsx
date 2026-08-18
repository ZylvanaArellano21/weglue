"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "../home/AppHeader";
import { ToastProvider, useToast } from "../shared/Toast";
import { useOwnProfile } from "../../lib/hooks/useOwnProfile";
import { useInterestsRerun, type ClubRecommendationOutcome } from "../../lib/hooks/useInterestsRerun";

// Canonical taxonomy — MUST match onboarding exactly or the DB CHECK
// constraints reject the values (see the onboarding interests/activities pages).
const INTERESTS = [
  "Finance & Business", "Social Events", "Music", "Fashion", "Art & Culture",
  "Social Justice & Activism", "Numbers & Economics", "Gaming", "Health & Wellness",
  "Environment", "Sports & Athletics", "Community Service", "Crafts", "Religion",
  "Technology and Computer", "Film & Media", "Photography", "Strategy and Critical Thinking",
  "Writing", "Theater", "Travel & Languages", "Debate & Politics",
];
const ACTIVITIES = [
  "Projects", "Volunteering", "Workshops", "Campus Fairs", "Trips",
  "Study Groups", "Networking", "Tournaments", "Social Events", "Campus Tours",
];

// Interests rerun (spec §2): Home → Interests → Activities → Finish →
// Congratulations → See my matches → Home Events. Uses the authenticated header
// (not the pre-signup Survey header). Requires ≥1 interest and ≥1 activity.
export function InterestsRerunClient({ userId }: { userId: string }): JSX.Element {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-cream pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <AppHeader userId={userId} />
        <Body userId={userId} />
      </div>
    </ToastProvider>
  );
}

type Step = "interests" | "activities" | "congrats";

function Body({ userId }: { userId: string }): JSX.Element {
  const router = useRouter();
  const show = useToast();

  // "See my matches" ALWAYS lands on Home → Events, where the club
  // recommendation strip ("We found N clubs you'll love") renders. It used to
  // branch on `?from=clubs` and send Club-tab entrants back to /clubs, which is
  // the catalog — NOT the matches area — so the survey appeared to dump the
  // user somewhere unrelated. Home is now the single destination no matter
  // where the survey was launched from (Home, Clubs, Interests, anywhere).
  const seeMatchesHref = "/home?tab=events";
  const { data: profile } = useOwnProfile(userId);
  const rerun = useInterestsRerun(userId);

  const [step, setStep] = useState<Step>("interests");
  const [interests, setInterests] = useState<string[]>([]);
  const [activities, setActivities] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ClubRecommendationOutcome | null>(null);
  const [seeded, setSeeded] = useState(false);

  // Seed the current selections once (don't clobber edits on refetch).
  useEffect(() => {
    if (!seeded && profile) {
      setInterests(profile.interests ?? []);
      setActivities(profile.activities ?? []);
      setSeeded(true);
    }
  }, [profile, seeded]);

  const toggle = (list: string[], set: (v: string[]) => void, item: string) =>
    set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const finish = () => {
    if (activities.length === 0) {
      show("Pick at least one activity.", "error");
      return;
    }
    rerun.mutate(
      { interests, activities },
      {
        onSuccess: (result) => {
          setOutcome(result);
          setStep("congrats");
        },
        onError: () => show("Could not update your matches. Please try again.", "error"),
      }
    );
  };

  if (step === "congrats") {
    const matches = outcome?.kind === "matches" ? outcome.batch : null;
    if (outcome?.kind !== "matches") {
      const allJoined = outcome?.kind === "all_joined";
      return (
        <main className="mx-auto flex max-w-xl flex-col items-center px-6 py-16 text-center">
          <div className="w-full rounded-2xl bg-white p-10 shadow-sm">
            <h1 className="text-2xl font-bold text-gray-900 font-zain">{allJoined ? "You’ve already joined all the clubs!" : "No clubs are available right now."}</h1>
            <p className="mx-auto mt-4 max-w-sm text-sm font-semibold text-gray-800">{allJoined ? "You’re all caught up. Check out upcoming events and see what’s happening next." : "Check out upcoming events and see what’s happening next."}</p>
            <button type="button" onClick={() => router.push("/home?tab=events")} className="mt-10 w-full rounded-full py-3 text-[15px] font-semibold text-white" style={{ background: "#0FA6A6" }}>Check out events</button>
          </div>
        </main>
      );
    }
    return (
      <main className="mx-auto flex max-w-xl flex-col items-center px-6 py-16 text-center">
        <div className="w-full rounded-2xl bg-white p-10 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900 font-zain">🎉 Congratulations! 🎉</h1>
          <p className="mt-4 text-lg font-bold" style={{ color: "#0FA6A6" }}>
            You matched with
          </p>
          <p className="text-4xl font-extrabold underline" style={{ color: "#0FA6A6" }}>
            {matches!.count} club{matches!.count === 1 ? "" : "s"}!
          </p>
          <p className="mx-auto mt-4 max-w-xs text-sm font-semibold text-gray-800">
            We found new clubs based on your interests and activities. Your matches are waiting for you.
          </p>
          <button
            type="button"
            onClick={() => router.push(seeMatchesHref)}
            className="mt-10 w-full rounded-full py-3 text-[15px] font-semibold text-white"
            style={{ background: "#0FA6A6" }}
          >
            See my matches
          </button>
        </div>
      </main>
    );
  }

  const isInterests = step === "interests";
  const list = isInterests ? INTERESTS : ACTIVITIES;
  const selected = isInterests ? interests : activities;
  const setSelected = isInterests ? setInterests : setActivities;

  return (
    <main className="mx-auto max-w-lg px-6 py-8">
      <div className="mb-4">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full rounded-full" style={{ background: "#0FA6A6", width: isInterests ? "50%" : "100%" }} />
        </div>
        <p className="mt-1.5 text-xs font-medium text-gray-500">Step {isInterests ? 1 : 2} of 2</p>
      </div>

      <h1 className="mb-1 text-[26px] font-bold leading-tight font-zain" style={{ color: "#0FA6A6" }}>
        {isInterests ? "What are your interests?" : "What do you enjoy doing?"}
      </h1>
      <p className="mb-6 text-sm" style={{ color: "#0FA6A6" }}>
        {isInterests
          ? "Select everything that excites you. We'll match you to clubs that fit."
          : "Pick all the activities you love. This helps us personalize your feed."}
      </p>

      <div className="mb-10 flex flex-wrap gap-2.5">
        {list.map((item) => {
          const on = selected.includes(item);
          return (
            <button
              key={item}
              type="button"
              onClick={() => toggle(selected, setSelected, item)}
              className="rounded-[40px] border px-[18px] py-2.5 text-sm font-medium transition-colors"
              style={
                on
                  ? { background: "#0FA6A6", borderColor: "#0FA6A6", color: "#fff" }
                  : { background: "#fff", borderColor: "rgba(0,0,0,0.2)", color: "#000" }
              }
            >
              {item}
            </button>
          );
        })}
      </div>

      <div className="flex justify-end">
        {isInterests ? (
          <button
            type="button"
            onClick={() => {
              if (interests.length === 0) {
                show("Pick at least one interest.", "error");
                return;
              }
              setStep("activities");
            }}
            className="h-[52px] rounded-[40px] px-12 text-base font-semibold text-white"
            style={{ background: "#0FA6A6" }}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={finish}
            disabled={rerun.isPending}
            className="h-[52px] rounded-[40px] px-10 text-base font-semibold text-white disabled:opacity-60"
            style={{ background: "#0FA6A6" }}
          >
            {rerun.isPending ? "Finding matches…" : "Find my matches"}
          </button>
        )}
      </div>
    </main>
  );
}
