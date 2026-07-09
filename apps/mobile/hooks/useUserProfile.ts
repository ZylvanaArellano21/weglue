import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getUserProfile,
  followUser,
  unfollowUser,
  getUserPosts,
  getUserWeeklyEvents,
  getUserGluematesList,
} from '../services/followService';
import { getOwnClubsList } from '../services/profileService';
import { timedQuery } from '../lib/timedQuery';

// Gluemates list for ANY profile user — opened by tapping the Gluemates count.
export function useUserGluematesList(targetUserId: string | undefined, enabled: boolean = false) {
  return useQuery({
    queryKey: ['userGluemates', targetUserId],
    queryFn: () => getUserGluematesList(targetUserId!),
    enabled: !!targetUserId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

// Clubs list for ANY profile user (uses the profile user's id, not the
// viewer's). Same fetch as the own-profile clubs sheet.
export function useUserClubsList(targetUserId: string | undefined, enabled: boolean = false) {
  return useQuery({
    queryKey: ['userClubsList', targetUserId],
    queryFn: () => getOwnClubsList(targetUserId!),
    enabled: !!targetUserId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useUserProfile(targetUserId: string | undefined, viewerUserId: string | undefined) {
  return useQuery({
    queryKey: ['userProfile', targetUserId, viewerUserId],
    queryFn: () => timedQuery('userProfile', getUserProfile(targetUserId!, viewerUserId!)),
    enabled: !!targetUserId && !!viewerUserId,
    staleTime: 60 * 1000,
  });
}

export function useUserPosts(userId: string | undefined, enabled: boolean = true) {
  return useInfiniteQuery({
    queryKey: ['userPosts', userId],
    queryFn: ({ pageParam = 0 }) => getUserPosts(userId!, pageParam),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 12 ? allPages.length : undefined,
    initialPageParam: 0,
    enabled: !!userId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useUserWeeklyEvents(userId: string | undefined, enabled: boolean = true) {
  return useInfiniteQuery({
    queryKey: ['userWeeklyEvents', userId],
    queryFn: ({ pageParam = 0 }) => getUserWeeklyEvents(userId!, pageParam),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 10 ? allPages.length : undefined,
    initialPageParam: 0,
    enabled: !!userId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useFollowMutation(viewerUserId: string | undefined, targetUserId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action }: { action: 'follow' | 'unfollow' }) =>
      action === 'follow'
        ? followUser(viewerUserId!, targetUserId!)
        : unfollowUser(viewerUserId!, targetUserId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userProfile', targetUserId, viewerUserId] });
    },
  });
}
