"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { clubRecommendationsKey, type ClubRecommendationBatch } from "./useClubRecommendations";

export type ClubRecommendationOutcome =
  | { kind: "matches"; batch: ClubRecommendationBatch }
  | { kind: "all_joined" }
  | { kind: "none_available" };

// Interests rerun (spec §2): saves the updated interests + activities to the
// shared backend, then rebuilds the recommendation batch with the SAME
// server-side logic + minimum-two fallback mobile uses. Returns the fresh batch
// so the Congratulations screen can show the real matched-club count.

// Activities stay a raw table write (out of scope for the catalog work).
async function replaceRows(table: string, column: string, userId: string, values: string[]) {
  const supabase = getSupabaseBrowser();
  const { error: delErr } = await supabase.from(table).delete().eq("user_id", userId);
  if (delErr) throw delErr;
  if (values.length > 0) {
    const { error: insErr } = await supabase
      .from(table)
      .insert(values.map((v) => ({ user_id: userId, [column]: v })));
    // Surface CHECK-constraint failures instead of silently wiping the data.
    if (insErr) throw insErr;
  }
}

export function useInterestsRerun(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      interestKeys,
      activities,
    }: {
      /** Catalog slugs (or active labels) — resolved server-side by set_my_interests. */
      interestKeys: string[];
      activities: string[];
    }): Promise<ClubRecommendationOutcome> => {
      const supabase = getSupabaseBrowser();
      // Interests: one validated RPC that swaps the ID-backed rows atomically.
      const { error: setErr } = await supabase.rpc("set_my_interests", {
        p_slugs: interestKeys,
      });
      if (setErr) throw setErr;
      await replaceRows("user_activities", "activity", userId!, activities);

      const { error } = await supabase.rpc("regenerate_my_club_recommendations");
      if (error) throw error;
      const { data, error: outcomeError } = await supabase.rpc("get_my_club_recommendation_outcome");
      if (outcomeError) throw outcomeError;
      return data as ClubRecommendationOutcome;
    },
    onSuccess: (outcome) => {
      queryClient.setQueryData(clubRecommendationsKey(userId), outcome.kind === "matches" ? outcome.batch : null);
      void queryClient.invalidateQueries({ queryKey: ["ownProfile", userId] });
      void queryClient.invalidateQueries({ queryKey: ["homeEventsFeed", userId] });
    },
  });
}
