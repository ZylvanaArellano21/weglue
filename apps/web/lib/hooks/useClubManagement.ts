"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  updateClubProfile,
  updateClubGoals,
  addOfficer,
  removeOfficer,
  removeMember,
  getClubMemberList,
  searchUniversityUsers,
  removePostFromClub,
  deleteClubPhotoEverywhere,
  type UpdateClubInput,
} from "../clubs/clubManagement";
import { clubProfileKey } from "./useClubProfile";
import { myClubsKey, discoveryClubsKey } from "./useClubTab";

// Every officer mutation invalidates the club profile (and the sidebar/catalog
// where a name/avatar/role change shows) so web + mobile stay in sync.
function useClubInvalidation(clubId?: string, userId?: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: clubProfileKey(clubId, userId) });
    void queryClient.invalidateQueries({ queryKey: ["clubMemberList", clubId] });
    void queryClient.invalidateQueries({ queryKey: myClubsKey(userId) });
    void queryClient.invalidateQueries({ queryKey: discoveryClubsKey(userId) });
  };
}

export function useUpdateClub(clubId: string, userId: string) {
  const invalidate = useClubInvalidation(clubId, userId);
  return useMutation({
    mutationFn: async ({ profile, goals }: { profile: UpdateClubInput; goals?: string[] }) => {
      await updateClubProfile(clubId, profile);
      if (goals) await updateClubGoals(clubId, goals);
    },
    onSuccess: invalidate,
  });
}

export function useAddOfficer(clubId: string, userId: string) {
  const invalidate = useClubInvalidation(clubId, userId);
  return useMutation({
    mutationFn: ({ targetUserId, roleTitle }: { targetUserId: string; roleTitle: string }) =>
      addOfficer(clubId, targetUserId, roleTitle),
    onSuccess: invalidate,
  });
}

export function useRemoveOfficer(clubId: string, userId: string) {
  const invalidate = useClubInvalidation(clubId, userId);
  return useMutation({
    mutationFn: (targetUserId: string) => removeOfficer(clubId, targetUserId),
    onSuccess: invalidate,
  });
}

export function useRemoveMember(clubId: string, userId: string) {
  const invalidate = useClubInvalidation(clubId, userId);
  return useMutation({
    mutationFn: (targetUserId: string) => removeMember(clubId, targetUserId),
    onSuccess: invalidate,
  });
}

export function useClubMemberList(clubId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["clubMemberList", clubId],
    queryFn: () => getClubMemberList(clubId!),
    enabled: !!clubId && enabled,
    staleTime: 30 * 1000,
  });
}

export function useUniversityUserSearch(viewerId: string, query: string, enabled: boolean) {
  return useQuery({
    queryKey: ["universityUserSearch", viewerId, query],
    queryFn: () => searchUniversityUsers(viewerId, query),
    enabled: enabled && !!viewerId,
    staleTime: 20 * 1000,
  });
}

/**
 * Removing something from a club's Photos that Glue. Exactly the two operations
 * mobile has — see lib/clubs/clubPhotoRemoval.ts for why there is no third.
 *
 *   removePost   detaches a tagged post from THIS club only (the post itself
 *                is never touched, so Home and the creator's profile keep it);
 *   deleteUpload deletes an officer-uploaded club photo row.
 */
export function useManageClubPhoto(clubId: string, userId: string) {
  const invalidate = useClubInvalidation(clubId, userId);
  const queryClient = useQueryClient();

  // Mirrors mobile's invalidatePhotoQueries: detaching a club tag changes what
  // renders on the club profile AND on every surface that draws the post, since
  // the post's club attribution disappears from all of them at once.
  const afterChange = () => {
    invalidate();
    void queryClient.invalidateQueries({ queryKey: ["clubPhotoFeed", clubId] });
    void queryClient.invalidateQueries({ queryKey: ["homePostsFeed"] });
    void queryClient.invalidateQueries({ queryKey: ["ownPosts"] });
    void queryClient.invalidateQueries({ queryKey: ["userPosts"] });
    // Post detail + shared-message cards resolve the same post by id — the
    // removed club tag must disappear from every rendering.
    void queryClient.invalidateQueries({ queryKey: ["postDetail"] });
  };

  return {
    removePost: useMutation({
      mutationFn: (postId: string) => removePostFromClub(postId, clubId),
      onSuccess: afterChange,
    }),
    deleteUpload: useMutation({
      mutationFn: (photoId: string) => deleteClubPhotoEverywhere(photoId),
      onSuccess: afterChange,
    }),
  };
}
