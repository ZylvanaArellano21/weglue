"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { getMyClubs, getDiscoveryClubs, type MyClubs, type CatalogClub } from "../clubs/clubService";
import { clubRecommendationsKey, type ClubRecommendationBatch } from "./useClubRecommendations";

// Club-tab data hooks. The sidebar (my Officer/Member clubs) and the catalog
// (Suggested/Popular, both from get_discovery_clubs) each get their own query so
// a join can optimistically flip a single card while realtime/invalidation keeps
// the two views consistent with each other, Home, and mobile.

export const myClubsKey = (userId?: string) => ["myClubs", userId] as const;
export const discoveryClubsKey = (userId?: string) => ["discoveryClubs", userId] as const;

export function useMyClubs(userId: string | undefined) {
  return useQuery<MyClubs>({
    queryKey: myClubsKey(userId),
    queryFn: () => getMyClubs(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

export function useDiscoveryClubs(userId: string | undefined) {
  return useQuery<CatalogClub[]>({
    queryKey: discoveryClubsKey(userId),
    queryFn: () => getDiscoveryClubs(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

/**
 * Join a club from the Club-tab catalog. Joining is a plain upsert into
 * club_members exactly like mobile — any private/approval rule is enforced by
 * RLS server-side, so web can never bypass it. Optimistically:
 *   • flip the catalog card to is_member=true (Popular shows "Joined",
 *     Suggested drops it — spec §7/§8),
 *   • clear the active recommendation batch if this club was in it (a DB trigger
 *     completes the whole batch, mirroring Home).
 * Then invalidate my-clubs / discovery / recommendations / home so the sidebar,
 * catalog, and Home all resync from the server.
 */
export function useJoinClubFromCatalog(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    string,
    { previousCatalog?: CatalogClub[]; previousBatch?: ClubRecommendationBatch | null }
  >({
    mutationFn: async (clubId: string) => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase
        .from("club_members")
        .upsert({ user_id: userId!, club_id: clubId, role: "member" }, { onConflict: "club_id,user_id" });
      if (error) throw error;
    },
    onMutate: async (clubId) => {
      const catKey = discoveryClubsKey(userId);
      const recKey = clubRecommendationsKey(userId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: catKey }),
        queryClient.cancelQueries({ queryKey: recKey }),
      ]);
      const previousCatalog = queryClient.getQueryData<CatalogClub[]>(catKey);
      const previousBatch = queryClient.getQueryData<ClubRecommendationBatch | null>(recKey);

      if (previousCatalog) {
        queryClient.setQueryData<CatalogClub[]>(
          catKey,
          previousCatalog.map((c) => (c.id === clubId ? { ...c, is_member: true } : c))
        );
      }
      if (previousBatch?.clubs.some((c) => c.id === clubId)) {
        queryClient.setQueryData(recKey, null);
      }
      return { previousCatalog, previousBatch };
    },
    onError: (_err, _clubId, context) => {
      if (context?.previousCatalog !== undefined) {
        queryClient.setQueryData(discoveryClubsKey(userId), context.previousCatalog);
      }
      if (context?.previousBatch !== undefined) {
        queryClient.setQueryData(clubRecommendationsKey(userId), context.previousBatch);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: myClubsKey(userId) });
      void queryClient.invalidateQueries({ queryKey: discoveryClubsKey(userId) });
      void queryClient.invalidateQueries({ queryKey: clubRecommendationsKey(userId) });
      void queryClient.invalidateQueries({ queryKey: ["homeEventsFeed", userId] });
      void queryClient.invalidateQueries({ queryKey: ["ownProfile", userId] });
    },
  });
}
