import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
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

// These are the cache roots whose payloads can embed this user's display name
// or avatar: profile/post/comment/event surfaces, member/officer lists,
// messages and conversation participants, notifications, discovery results,
// and saved/RSVP'd content. Keep this scoped list complete without refreshing
// unrelated query data after an edit.
const PROFILE_EMBEDDING_QUERY_ROOTS = [
  'homePostsFeed',
  'postDetail',
  'postComments',
  'ownPosts',
  'userPosts',
  'userPostsFeed',
  'clubPhotoFeed',
  'homeEventsFeed',
  'eventDetail',
  'eventAttendees',
  'clubEventsFeed',
  'calendarEvents',
  'calendarDayEvents',
  'savedEventsUpcoming',
  'savedEventsPast',
  'ownThisWeekEvents',
  'userWeeklyEvents',
  'ownGluemates',
  'ownProfile',
  'userProfile',
  'clubProfile',
  'clubDetail',
  'clubMembers',
  'myChats',
  'messages',
  'conversationHub',
  'clubChannels',
  'chatDetails',
  'notifications',
  'discoveryClubs',
  'discoveryEvents',
  'discoverySearch',
] as const;

function invalidateProfileEmbeddingQueries(queryClient: QueryClient): void {
  for (const root of PROFILE_EMBEDDING_QUERY_ROOTS) {
    void queryClient.invalidateQueries({ queryKey: [root] });
  }
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
      // Refresh every cache root that can embed this user's name or avatar.
      invalidateProfileEmbeddingQueries(queryClient);
    },
  });
}

export function useUpdateInterests(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    // `interestKeys` are catalog slugs (or active labels) — resolved by the RPC.
    mutationFn: (interestKeys: string[]) => updateUserInterests(userId!, interestKeys),
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
      // Refresh the profile-embedding roots (feeds, comments, attendee/member
      // lists, chats, notifications, discovery and saved/RSVP'd content) so
      // no stale name/avatar survives outside the auth store.
      invalidateProfileEmbeddingQueries(queryClient);
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
