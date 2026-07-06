import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOwnProfile,
  getOwnClubsList,
  getOwnGluematesList,
  getOwnThisWeekEvents,
  getOwnPosts,
  deleteOwnPost,
  updateDisplayName,
  updateUserInterests,
  updateUserActivities,
  updateProfileAvatar,
  removeEventRsvp,
} from '../services/profileService';
import { timedQuery } from '../lib/timedQuery';

export function useOwnProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['ownProfile', userId],
    queryFn:  () => timedQuery('ownProfile', getOwnProfile(userId!)),
    enabled:  !!userId,
    staleTime: 60 * 1000,
  });
}

export function useOwnClubsList(userId: string | undefined, enabled: boolean = false) {
  return useQuery({
    queryKey: ['ownClubs', userId],
    queryFn:  () => getOwnClubsList(userId!),
    enabled:  !!userId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useOwnGluematesList(userId: string | undefined, enabled: boolean = false) {
  return useQuery({
    queryKey: ['ownGluemates', userId],
    queryFn:  () => getOwnGluematesList(userId!),
    enabled:  !!userId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useOwnThisWeekEvents(userId: string | undefined) {
  return useQuery({
    queryKey: ['ownThisWeekEvents', userId],
    queryFn:  () => getOwnThisWeekEvents(userId!),
    enabled:  !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useOwnPosts(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey:      ['ownPosts', userId],
    queryFn:       ({ pageParam = 0 }) => getOwnPosts(userId!, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 12 ? allPages.length : undefined,
    enabled:  !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useDeleteOwnPost(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => deleteOwnPost(userId!, postId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ownPosts', userId] });
    },
  });
}

export function useUpdateDisplayName(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fullName: string) => updateDisplayName(userId!, fullName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ownProfile', userId] });
    },
  });
}

export function useUpdateInterests(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (interests: string[]) => updateUserInterests(userId!, interests),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ownProfile', userId] });
      // Invalidate discovery so the personalized sort recalculates immediately
      queryClient.invalidateQueries({ queryKey: ['discoveryClubs', userId] });
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
    },
  });
}

export function useUpdateActivities(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (activities: string[]) => updateUserActivities(userId!, activities),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ownProfile', userId] });
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
    },
  });
}

export function useUpdateProfileAvatar(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      avatarUrl,
      avatarType,
    }: {
      avatarUrl: string | null;
      avatarType: 'photo' | 'camera' | 'text' | null;
    }) => updateProfileAvatar(userId!, avatarUrl, avatarType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ownProfile', userId] });
      // Own avatar is also embedded in Home feed posts/RSVPs and post detail —
      // those are separate query caches with their own staleTime and won't
      // pick up the change until invalidated directly.
      queryClient.invalidateQueries({ queryKey: ['homePostsFeed'] });
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed'] });
      queryClient.invalidateQueries({ queryKey: ['postDetail'] });
    },
  });
}

export function useRemoveEventRsvp(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => removeEventRsvp(userId!, eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ownThisWeekEvents', userId] });
      queryClient.invalidateQueries({ queryKey: ['calendarEvents', userId] });
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
    },
  });
}
