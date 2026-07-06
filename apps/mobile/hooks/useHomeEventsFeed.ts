import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getHomeEventsFeed,
  rsvpToEvent,
  toggleSaveEvent,
  type HomeEventsFeedSection,
} from '../services/eventService';
import {
  applyOptimisticRsvp,
  getCurrentRsvpStatus,
  invalidateRsvpQueries,
  nextRsvpStatus,
  restoreRsvpSnapshot,
  snapshotRsvpQueries,
  type RsvpSnapshot,
} from './useEventRsvp';
import { timedQuery } from '../lib/timedQuery';

// Merges same-label sections across pages (e.g. "Your Clubs" from page 0 and
// page 1) into one continuous section per label, in first-seen order.
export function mergeEventFeedPages(
  pages: { sections: HomeEventsFeedSection[]; hasMore: boolean }[],
): HomeEventsFeedSection[] {
  const order: string[] = [];
  const byLabel = new Map<string, HomeEventsFeedSection>();

  for (const page of pages) {
    for (const section of page.sections) {
      const existing = byLabel.get(section.label);
      if (existing) {
        existing.data = existing.data.concat(section.data);
      } else {
        byLabel.set(section.label, { label: section.label, data: [...section.data] });
        order.push(section.label);
      }
    }
  }

  return order.map((label) => byLabel.get(label)!);
}

export function useHomeEventsFeed(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['homeEventsFeed', userId],
    queryFn: ({ pageParam = 0 }) =>
      timedQuery(`homeEventsFeed p${pageParam}`, getHomeEventsFeed(userId!, pageParam)),
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length : undefined),
    initialPageParam: 0,
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useRsvpToEvent() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { userId: string; eventId: string; status: 'going' | 'cant' },
    RsvpSnapshot
  >({
    mutationFn: ({ userId, eventId, status }) => rsvpToEvent(userId, eventId, status),
    onMutate: async ({ eventId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['homeEventsFeed'] });
      const snapshot = snapshotRsvpQueries(queryClient);
      const current = getCurrentRsvpStatus(queryClient, eventId);
      applyOptimisticRsvp(queryClient, eventId, nextRsvpStatus(current, status));
      return snapshot;
    },
    onError: (_err, _vars, snapshot) => {
      if (snapshot) restoreRsvpSnapshot(queryClient, snapshot);
    },
    onSuccess: () => invalidateRsvpQueries(queryClient),
  });
}

export function useToggleSaveEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, eventId }: { userId: string; eventId: string }) =>
      toggleSaveEvent(userId, eventId),
    onSuccess: (_data, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
    },
  });
}
