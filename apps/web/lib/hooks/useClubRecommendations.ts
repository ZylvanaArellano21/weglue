"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";

// Web port of apps/mobile/hooks/useClubRecommendations.ts. The batch lives in
// the database (club_recommendation_batches) and is read/dismissed/regenerated
// through the SAME server-side RPCs mobile uses. The server self-heals the
// batch on read (drops deleted/joined/inaccessible clubs, backfills the next
// best-ranked) so the promised count and the minimum-two fallback are enforced
// server-side identically for web and mobile — never a fake "2" on the client.

export interface RecommendedClub {
  id: string;
  name: string;
  avatar_url: string | null;
  cover_image_url: string | null;
}

export interface ClubRecommendationBatch {
  batch_id: string;
  count: number;
  source: "onboarding" | "interest_update";
  clubs: RecommendedClub[];
}

export const clubRecommendationsKey = (userId?: string) =>
  ["clubRecommendations", userId] as const;

async function fetchClubRecommendations(): Promise<ClubRecommendationBatch | null> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("get_my_club_recommendations");
  if (error) throw error;
  if (!data) return null; // dismissed, completed, or never created
  return data as ClubRecommendationBatch;
}

export function useClubRecommendations(userId?: string) {
  return useQuery({
    queryKey: clubRecommendationsKey(userId),
    queryFn: fetchClubRecommendations,
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useDismissClubRecommendations(userId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batchId: string) => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.rpc("dismiss_club_recommendation_batch", {
        p_batch_id: batchId,
      });
      if (error) throw error;
    },
    onMutate: async () => {
      const key = clubRecommendationsKey(userId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ClubRecommendationBatch | null>(key);
      queryClient.setQueryData(key, null);
      return { previous };
    },
    onError: (_err, _batchId, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(clubRecommendationsKey(userId), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: clubRecommendationsKey(userId) });
    },
  });
}

/** Rebuilds the batch from freshly saved interests/activities (interests rerun). */
export function useRegenerateClubRecommendations(userId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<ClubRecommendationBatch | null> => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.rpc("regenerate_my_club_recommendations");
      if (error) throw error;
      return fetchClubRecommendations();
    },
    onSuccess: (batch) => {
      queryClient.setQueryData(clubRecommendationsKey(userId), batch);
    },
  });
}
