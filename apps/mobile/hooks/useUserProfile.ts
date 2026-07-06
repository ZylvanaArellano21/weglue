import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUserProfile, followUser, unfollowUser, getUserPosts, getUserWeeklyEvents } from '../services/followService';
import { timedQuery } from '../lib/timedQuery';

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
