import { useMutation, useQueryClient, QueryClient } from '@tanstack/react-query';
import { joinClub, leaveClub, type ClubProfileData, type LeaveClubResult } from '../services/clubService';
import type { EventDetail, HomeEventsFeedSection } from '../services/eventService';
import {
  clubRecommendationsKey,
  type ClubRecommendationBatch,
} from './useClubRecommendations';

// Centralizes join/leave so Home (event cards), Club Profile, and both
// Event Details screens never disagree about membership state. Each screen
// still owns its own confirm-leave modal + toast, but all of them call
// useJoinClubMutation/useLeaveClubMutation below.

const YOUR_CLUBS_LABEL = 'Your Clubs';
const RECOMMENDED_LABEL = 'Recommended for You';

// Moves events between the "Your Clubs" and "Recommended for You" sections
// of a single feed page so a join/leave is reflected in Home instantly,
// without waiting on a refetch — matches the tiering rule in
// eventService.getHomeEventsFeed (joined-club events always float to
// "Your Clubs"; everything else is "Recommended for You").
function reorderFeedSections(
  sections: HomeEventsFeedSection[],
  clubId: string,
  joined: boolean,
): HomeEventsFeedSection[] {
  let yourClubs = sections.find((s) => s.label === YOUR_CLUBS_LABEL)?.data ?? [];
  let recommended = sections.find((s) => s.label === RECOMMENDED_LABEL)?.data ?? [];
  const others = sections.filter((s) => s.label !== YOUR_CLUBS_LABEL && s.label !== RECOMMENDED_LABEL);

  if (joined) {
    const moving = recommended
      .filter((e) => e.club_id === clubId)
      .map((e) => ({ ...e, user_has_joined_club: true, tier: 'your_clubs' as const }));
    if (moving.length > 0) {
      recommended = recommended.filter((e) => e.club_id !== clubId);
      yourClubs = [...yourClubs, ...moving];
    }
  } else {
    const moving = yourClubs
      .filter((e) => e.club_id === clubId)
      .map((e) => ({ ...e, user_has_joined_club: false, tier: 'recommended' as const }));
    if (moving.length > 0) {
      yourClubs = yourClubs.filter((e) => e.club_id !== clubId);
      recommended = [...recommended, ...moving];
    }
  }

  const result: HomeEventsFeedSection[] = [];
  if (yourClubs.length > 0) result.push({ label: YOUR_CLUBS_LABEL, data: yourClubs });
  if (recommended.length > 0) result.push({ label: RECOMMENDED_LABEL, data: recommended });
  return [...result, ...others];
}

interface MembershipSnapshot {
  clubProfile: [readonly unknown[], unknown][];
  homeEventsFeed: [readonly unknown[], unknown][];
  eventDetail: [readonly unknown[], unknown][];
}

function snapshotMembershipQueries(queryClient: QueryClient): MembershipSnapshot {
  return {
    clubProfile: queryClient.getQueriesData({ queryKey: ['clubProfile'] }),
    homeEventsFeed: queryClient.getQueriesData({ queryKey: ['homeEventsFeed'] }),
    eventDetail: queryClient.getQueriesData({ queryKey: ['eventDetail'] }),
  };
}

function restoreMembershipSnapshot(queryClient: QueryClient, snapshot: MembershipSnapshot): void {
  for (const [key, data] of snapshot.clubProfile) queryClient.setQueryData(key, data);
  for (const [key, data] of snapshot.homeEventsFeed) queryClient.setQueryData(key, data);
  for (const [key, data] of snapshot.eventDetail) queryClient.setQueryData(key, data);
}

function applyOptimisticMembership(queryClient: QueryClient, clubId: string, joined: boolean): void {
  queryClient.setQueriesData<ClubProfileData | null | undefined>(
    { queryKey: ['clubProfile', clubId] },
    (old) => {
      if (!old) return old;
      const delta = old.is_member === joined ? 0 : joined ? 1 : -1;
      return { ...old, is_member: joined, member_count: Math.max(0, old.member_count + delta) };
    },
  );

  queryClient.setQueriesData<EventDetail | null | undefined>(
    { queryKey: ['eventDetail'] },
    (old) => (old && old.club_id === clubId ? { ...old, user_has_joined_club: joined } : old),
  );

  queryClient.setQueriesData<{ pages: { sections: HomeEventsFeedSection[]; hasMore: boolean }[] } | undefined>(
    { queryKey: ['homeEventsFeed'] },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          sections: reorderFeedSections(page.sections, clubId, joined),
        })),
      };
    },
  );
}

// Invalidates everything that could have changed server-side: membership
// itself, plus — when leaving — RSVP/Calendar/Weekly Events, since the
// handle_club_leave_rsvp_cleanup DB trigger auto-cancels RSVPs for
// members-only events of the left club (Option A permissions rule).
function invalidateMembershipQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ['clubProfile'] });
  queryClient.invalidateQueries({ queryKey: ['homeEventsFeed'] });
  // Group-chat membership is synced by DB triggers on join/leave — the chat
  // list and its notification must appear/disappear immediately.
  queryClient.invalidateQueries({ queryKey: ['myChats'] });
  queryClient.invalidateQueries({ queryKey: ['notifications'] });
  queryClient.invalidateQueries({ queryKey: ['eventDetail'] });
  queryClient.invalidateQueries({ queryKey: ['myClubs'] });
  queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
  queryClient.invalidateQueries({ queryKey: ['calendarMonthMarkers'] });
  queryClient.invalidateQueries({ queryKey: ['calendarDayEvents'] });
  queryClient.invalidateQueries({ queryKey: ['ownThisWeekEvents'] });
  // Profile clubs count + clubs sheets (own and as seen by others)
  queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
  queryClient.invalidateQueries({ queryKey: ['ownClubs'] });
  queryClient.invalidateQueries({ queryKey: ['userClubsList'] });
  queryClient.invalidateQueries({ queryKey: ['userProfile'] });
}

export function useJoinClubMutation(userId: string | undefined) {
  const queryClient = useQueryClient();
  const recommendationsKey = clubRecommendationsKey(userId);

  return useMutation<void, Error, string, MembershipSnapshot>({
    mutationFn: (clubId: string) => joinClub(userId!, clubId),
    onMutate: async (clubId) => {
      await queryClient.cancelQueries({ queryKey: ['clubProfile'] });
      await queryClient.cancelQueries({ queryKey: ['homeEventsFeed'] });
      await queryClient.cancelQueries({ queryKey: recommendationsKey });
      const snapshot = snapshotMembershipQueries(queryClient);
      applyOptimisticMembership(queryClient, clubId, true);

      // Joining ANY club in the active match batch completes the WHOLE batch —
      // the entire matches section disappears at once, never just the one card.
      // A DB trigger does this server-side so it holds no matter where the join
      // happened (matched card, Club Profile, Discovery, another device); this
      // is only the optimistic mirror of that.
      const batch = queryClient.getQueryData<ClubRecommendationBatch | null>(
        recommendationsKey,
      );
      if (batch?.clubs.some((c) => c.id === clubId)) {
        queryClient.setQueryData(recommendationsKey, null);
      }

      return snapshot;
    },
    onError: (_err, _clubId, snapshot) => {
      if (snapshot) restoreMembershipSnapshot(queryClient, snapshot);
      void queryClient.invalidateQueries({ queryKey: recommendationsKey });
    },
    onSuccess: () => {
      invalidateMembershipQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: recommendationsKey });
    },
  });
}

export function useLeaveClubMutation(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<LeaveClubResult, Error, string, MembershipSnapshot>({
    mutationFn: (clubId: string) => leaveClub(userId!, clubId),
    onMutate: async (clubId) => {
      await queryClient.cancelQueries({ queryKey: ['clubProfile'] });
      await queryClient.cancelQueries({ queryKey: ['homeEventsFeed'] });
      const snapshot = snapshotMembershipQueries(queryClient);
      applyOptimisticMembership(queryClient, clubId, false);
      return snapshot;
    },
    onError: (_err, _clubId, snapshot) => {
      if (snapshot) restoreMembershipSnapshot(queryClient, snapshot);
    },
    onSuccess: () => invalidateMembershipQueries(queryClient),
  });
}
