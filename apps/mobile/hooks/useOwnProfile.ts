import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
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
import { writeCachedProfile } from '../lib/profileCache';
import { removePostFromCaches } from './useHomePostsFeed';

// The current user's avatar and display name are read from two sources of
// truth: the zustand auth store (Home header, nav guard, cold-start cache)
// and dozens of React Query caches (feeds, comments, chats, member lists).
// After a profile mutation both must update immediately so every avatar/name
// reference in the app reflects the change in under a second.
function syncAuthStoreProfile(patch: { full_name?: string; avatar_url?: string | null }) {
  const { profile, isOnboarded, setProfile } = useAuthStore.getState();
  if (!profile) return;
  const updated = { ...profile, ...patch };
  setProfile(updated);
  void writeCachedProfile(profile.id, { profile: updated, isOnboarded });
}

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
    onSuccess: (_data, postId) => {
      // Drop the post from every cached list immediately, then refetch.
      removePostFromCaches(queryClient, postId);
      queryClient.invalidateQueries({ queryKey: ['ownPosts', userId] });
      queryClient.invalidateQueries({ queryKey: ['userPosts', userId] });
      queryClient.invalidateQueries({ queryKey: ['userPostsFeed', userId] });
      queryClient.invalidateQueries({ queryKey: ['homePostsFeed'] });
    },
  });
}

export function useUpdateDisplayName(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fullName: string) => updateDisplayName(userId!, fullName),
    onSuccess: (_data, fullName) => {
      syncAuthStoreProfile({ full_name: fullName.trim() });
      // The display name is embedded in many query caches (profile, chats,
      // member lists, attendees…) — refresh everything so no stale copy stays.
      queryClient.invalidateQueries();
    },
  });
}

export function useUpdateInterests(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (interests: string[]) => updateUserInterests(userId!, interests),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ownProfile', userId] });
      // Interests drive club recommendations + own profile display
      queryClient.invalidateQueries({ queryKey: ['discoveryClubs', userId] });
      queryClient.invalidateQueries({ queryKey: ['discoverySearch', userId] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', userId] });
    },
  });
}

export function useUpdateActivities(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (activities: string[]) => updateUserActivities(userId!, activities),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ownProfile', userId] });
      // Activities drive both club and event recommendations
      queryClient.invalidateQueries({ queryKey: ['discoveryClubs', userId] });
      queryClient.invalidateQueries({ queryKey: ['discoveryEvents', userId] });
      queryClient.invalidateQueries({ queryKey: ['discoverySearch', userId] });
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
      avatarType: 'photo' | 'camera' | 'text' | 'preset' | null;
    }) => updateProfileAvatar(userId!, avatarUrl, avatarType),
    onSuccess: (_data, { avatarUrl }) => {
      // Home header + sidebar read the auth store, not React Query — update it
      // directly so the new picture shows without navigating away.
      syncAuthStoreProfile({ avatar_url: avatarUrl });
      // The avatar URL is embedded in nearly every query cache (feeds, post
      // detail, comments, chats, member lists, attendees, search…). A profile
      // picture change is rare, so a full invalidation is the safe way to
      // guarantee no stale copy survives anywhere.
      queryClient.invalidateQueries();
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
