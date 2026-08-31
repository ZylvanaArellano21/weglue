import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEventDetail, rsvpToEvent, setEventSaved } from '../services/eventService';
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

export function useEventDetail(eventId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['eventDetail', eventId, userId],
    queryFn: () => timedQuery('eventDetail', getEventDetail(eventId!, userId!)),
    enabled: !!eventId && !!userId,
    staleTime: 60 * 1000,
  });
}

// The mutation variable is the DESIRED end-state, not the tapped button —
// components pass `event.user_rsvp_status === tapped ? null : tapped`.
export function useRsvpMutation(userId: string | undefined, eventId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, DesiredRsvp, RsvpSnapshot>({
    mutationFn: (desired: DesiredRsvp) => rsvpToEvent(userId!, eventId!, desired),
    onMutate: async (desired) => {
      await queryClient.cancelQueries({ queryKey: ['eventDetail'] });
      const snapshot = snapshotRsvpQueries(queryClient);
      applyOptimisticRsvp(queryClient, eventId!, desired);
      return snapshot;
    },
    onError: (_err, _desired, snapshot) => {
      if (snapshot) restoreRsvpSnapshot(queryClient, snapshot);
    },
    onSuccess: () => invalidateRsvpQueries(queryClient),
  });
}

// The mutation variable is the DESIRED saved state (`!event.is_saved`).
export function useSaveEventMutation(userId: string | undefined, eventId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, boolean>({
    mutationFn: (desired: boolean) => setEventSaved(userId!, eventId!, desired),
    // Refresh Saved Events too — not just this detail screen and the feed.
    onSettled: () => invalidateSaveQueries(queryClient),
  });
}
