"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getClubMembers, type ClubMembersPage } from "../clubs/clubMembersService";

export const clubMembersKey = (
  clubId: string | undefined,
  viewerId: string | undefined,
  search: string,
  page: number,
  gluematesOnly: boolean
) => ["clubMembers", clubId, viewerId, search, page, gluematesOnly] as const;

/** One page of a club's Members (or Gluemates) list, mobile-identical. */
export function useClubMembers(
  clubId: string | undefined,
  viewerId: string | undefined,
  search: string,
  page: number,
  gluematesOnly: boolean
) {
  return useQuery<ClubMembersPage>({
    queryKey: clubMembersKey(clubId, viewerId, search, page, gluematesOnly),
    queryFn: () => getClubMembers(clubId!, viewerId!, search, page, gluematesOnly),
    enabled: !!clubId && !!viewerId,
    // Follow state is part of every row, so keep it fresh rather than cached
    // long enough to disagree with the buttons the viewer just pressed.
    staleTime: 15 * 1000,
  });
}

/** Refetch every page/filter of this club's list after a follow/unfollow. */
export function useRefreshClubMembers(clubId: string | undefined) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === "clubMembers" && query.queryKey[1] === clubId,
    });
  };
}
