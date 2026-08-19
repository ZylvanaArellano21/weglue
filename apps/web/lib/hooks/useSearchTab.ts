"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import {
  getDiscoveryClubsPage,
  getDiscoveryPeople,
  getDistinctCategories,
  type SearchDiscoveryClub,
} from "../search/searchService";

const PAGE_SIZE = 20;

export function useDistinctCategories() {
  return useQuery({
    queryKey: ["searchCategories"],
    queryFn: getDistinctCategories,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSearchDiscoveryClubs(userId: string | undefined, category: string | null) {
  return useInfiniteQuery({
    queryKey: ["searchDiscoveryClubs", userId, category],
    queryFn: ({ pageParam }) => getDiscoveryClubsPage(userId!, category, pageParam as number, PAGE_SIZE),
    getNextPageParam: (lastPage: SearchDiscoveryClub[], allPages) => (lastPage.length === PAGE_SIZE ? allPages.length : undefined),
    initialPageParam: 0,
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useSearchDiscoveryPeople(userId: string | undefined) {
  return useQuery({
    queryKey: ["searchDiscoveryPeople", userId],
    queryFn: () => getDiscoveryPeople(userId!),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

// Plain upsert into club_members, exactly like mobile's joinClubAndRefetch and
// the Club-tab catalog's join — any private/approval rule is enforced by RLS
// server-side either way. Invalidates every view that shows membership state
// (this tab's own club grid, the global header's search panel, the Club tab
// sidebar/catalog, and Home's recommendation batch) so a join here is
// reflected everywhere without a page reload.
export function useJoinFromSearch(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (clubId: string) => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase
        .from("club_members")
        .upsert({ user_id: userId!, club_id: clubId, role: "member" }, { onConflict: "club_id,user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["searchDiscoveryClubs", userId] });
      void queryClient.invalidateQueries({ queryKey: ["discoverySearch", userId] });
      void queryClient.invalidateQueries({ queryKey: ["myClubs", userId] });
      void queryClient.invalidateQueries({ queryKey: ["discoveryClubs", userId] });
      void queryClient.invalidateQueries({ queryKey: ["clubRecommendations", userId] });
      void queryClient.invalidateQueries({ queryKey: ["homeEventsFeed", userId] });
    },
  });
}
