import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getHomeEventsFeed,
  rsvpToEvent,
  setEventSaved,
  type HomeEventsFeedSection,
} from '../services/eventService';
import {
  applyOptimisticRsvp,
  invalidateRsvpQueries,
  invalidateSaveQueries,
  restoreRsvpSnapshot,
  snapshotRsvpQueries,
  type DesiredRsvp,
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

// `desired` is the explicit end-state the card computed
// (`event.user_rsvp_status === tapped ? null : tapped`).
export function useRsvpToEvent() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { userId: string; eventId: string; desired: DesiredRsvp },
    RsvpSnapshot
  >({
    mutationFn: ({ userId, eventId, desired }) => rsvpToEvent(userId, eventId, desired),
    onMutate: async ({ eventId, desired }) => {
      await queryClient.cancelQueries({ queryKey: ['homeEventsFeed'] });
      const snapshot = snapshotRsvpQueries(queryClient);
      applyOptimisticRsvp(queryClient, eventId, desired);
      return snapshot;
    },
    onError: (_err, _vars, snapshot) => {
      if (snapshot) restoreRsvpSnapshot(queryClient, snapshot);
    },
    onSuccess: () => invalidateRsvpQueries(queryClient),
  });
}

// `desired` is the target saved state (`!event.is_saved`).
export function useToggleSaveEvent() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { userId: string; eventId: string; desired: boolean }>({
    mutationFn: ({ userId, eventId, desired }) => setEventSaved(userId, eventId, desired),
    // Refresh Saved Events too — not just the feed the bookmark was tapped in.
    onSettled: () => invalidateSaveQueries(queryClient),
  });
}
