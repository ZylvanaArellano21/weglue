"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase/client";

// Web mirror of the mobile Home club-match section
// (apps/mobile/components/home/ClubMatchesSection.tsx): the persistent batch
// generated at signup, read through the same self-healing RPC, hidden for
// good once dismissed or completed by joining one of its clubs.

interface RecommendedClub {
  id: string;
  name: string;
  avatar_url: string | null;
  cover_image_url: string | null;
}

interface ClubRecommendationBatch {
  batch_id: string;
  count: number;
  source: "onboarding" | "interest_update";
  clubs: RecommendedClub[];
}

export function ClubMatchesSection({ userId }: { userId: string }): JSX.Element | null {
  const [batch, setBatch] = useState<ClubRecommendationBatch | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    supabase.rpc("get_my_club_recommendations").then(({ data, error }) => {
      if (!cancelled && !error && data) {
        setBatch(data as ClubRecommendationBatch);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!batch || batch.clubs.length === 0) return null;

  async function handleJoin(clubId: string) {
    if (joining) return;
    setJoining(clubId);
    const supabase = createClient();
    // Same write as the mobile app; the DB trigger marks the batch completed,
    // so the section disappears everywhere once any matched club is joined.
    const { error } = await supabase
      .from("club_members")
      .upsert(
        { user_id: userId, club_id: clubId, role: "member" },
        { onConflict: "club_id,user_id" }
      );
    setJoining(null);
    if (!error) setBatch(null);
  }

  async function handleDismiss() {
    const current = batch;
    setBatch(null); // hide immediately; the RPC is idempotent
    const supabase = createClient();
    if (current) {
      await supabase.rpc("dismiss_club_recommendation_batch", {
        p_batch_id: current.batch_id,
      });
    }
  }

  return (
    <section className="bg-white rounded-xl shadow-sm border border-black/5 p-5 text-left max-w-2xl mx-auto mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-lg font-bold text-[#111827]"
          style={{ fontFamily: "var(--font-zain)" }}
        >
          We found {batch.count} clubs you&apos;ll love
        </h2>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss club matches"
          className="text-[#9CA3AF] hover:text-black text-xl leading-none px-1"
        >
          ×
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {batch.clubs.map((club) => {
          const image = club.avatar_url ?? club.cover_image_url;
          return (
            <div
              key={club.id}
              className="w-[148px] shrink-0 bg-white rounded-xl overflow-hidden shadow-[0px_4px_8px_rgba(0,0,0,0.12)]"
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt=""
                  className="w-full h-[92px] object-cover bg-[#E0F7F7]"
                />
              ) : (
                <div className="w-full h-[92px] bg-[#E0F7F7] flex items-center justify-center">
                  <span className="text-3xl font-bold text-[#0FA6A6]">
                    {club.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div className="px-2.5 pt-2 pb-2.5">
                <p className="text-sm font-semibold text-[#111827] text-center truncate">
                  {club.name}
                </p>
                <button
                  type="button"
                  onClick={() => handleJoin(club.id)}
                  disabled={!!joining}
                  className="mt-2 w-full h-[30px] rounded-full bg-[#0FA6A6] text-white text-[13px] font-semibold hover:bg-[#0d9494] transition-colors disabled:opacity-60"
                >
                  {joining === club.id ? "Joining…" : "Join"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Link
        href="/onboarding/explore-clubs"
        className="mt-3 flex items-center justify-center h-[40px] rounded-full border border-[#0FA6A6] text-[#0FA6A6] text-sm font-semibold hover:bg-[#E0F7F7] transition-colors"
      >
        See all clubs
      </Link>
    </section>
  );
}
