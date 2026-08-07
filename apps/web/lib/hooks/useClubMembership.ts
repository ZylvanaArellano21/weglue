"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import {
  clubRecommendationsKey,
  type ClubRecommendationBatch,
} from "./useClubRecommendations";
import { invalidateEventState } from "./eventSync";

// Web port of the join half of apps/mobile/hooks/useClubMembership.ts. Joining
// is a plain upsert into club_members exactly like mobile — any private-club /
// approval rule is enforced by RLS server-side, so web can never bypass it.
// Joining ANY club in the active match batch completes the WHOLE batch (a DB
// trigger makes that stick across devices); we mirror it optimistically here.

async function joinClub(userId: string, clubId: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase
    .from("club_members")
    .upsert(
      { user_id: userId, club_id: clubId, role: "member" },
      { onConflict: "club_id,user_id" }
    );
  if (error) throw error;
}

/**
 * Whether the user is an officer of ANY club — gates the "Event" option in the
 * Share a Glue menu (event creation is officer-only, enforced by RLS + the
 * createEvent RPC on the backend, so hiding the button is defence-in-depth,
 * not the security boundary). Mirrors mobile's officer store.
 */
export function useIsOfficer(userId: string | undefined) {
  return useQuery({
    queryKey: ["isOfficer", userId],
    queryFn: async (): Promise<boolean> => {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase
        .from("club_members")
        .select("id")
        .eq("user_id", userId!)
        .eq("role", "officer")
        .limit(1);
      return (data?.length ?? 0) > 0;
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

export function useJoinClubMutation(userId: string | undefined) {
  const queryClient = useQueryClient();
  const recommendationsKey = clubRecommendationsKey(userId);

  return useMutation<void, Error, string, { previousBatch: ClubRecommendationBatch | null | undefined }>({
    mutationFn: (clubId: string) => joinClub(userId!, clubId),
    onMutate: async (clubId) => {
      await queryClient.cancelQueries({ queryKey: recommendationsKey });
      const previousBatch = queryClient.getQueryData<ClubRecommendationBatch | null>(
        recommendationsKey
      );
      if (previousBatch?.clubs.some((c) => c.id === clubId)) {
        queryClient.setQueryData(recommendationsKey, null);
      }
      return { previousBatch };
    },
    onError: (_err, _clubId, context) => {
      if (context?.previousBatch !== undefined) {
        queryClient.setQueryData(recommendationsKey, context.previousBatch);
      }
    },
    onSuccess: () => {
      invalidateEventState(queryClient, userId);
      void queryClient.invalidateQueries({ queryKey: ["ownProfile", userId] });
      void queryClient.invalidateQueries({ queryKey: ["ownClubs", userId] });
      void queryClient.invalidateQueries({ queryKey: recommendationsKey });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: recommendationsKey });
    },
  });
}
