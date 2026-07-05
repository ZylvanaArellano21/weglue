import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEventDetail, rsvpToEvent, toggleSaveEvent } from '../services/eventService';
import {
  applyOptimisticRsvp,
  getCurrentRsvpStatus,
  invalidateRsvpQueries,
  nextRsvpStatus,
  restoreRsvpSnapshot,
  snapshotRsvpQueries,
  type RsvpSnapshot,
} from './useEventRsvp';

export function useEventDetail(eventId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['eventDetail', eventId, userId],
    queryFn: () => getEventDetail(eventId!, userId!),
    enabled: !!eventId && !!userId,
    staleTime: 60 * 1000,
  });
}

export function useRsvpMutation(userId: string | undefined, eventId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, 'going' | 'cant', RsvpSnapshot>({
    mutationFn: (status: 'going' | 'cant') =>
      rsvpToEvent(userId!, eventId!, status),
    onMutate: async (status) => {
      await queryClient.cancelQueries({ queryKey: ['eventDetail'] });
      const snapshot = snapshotRsvpQueries(queryClient);
      const current = getCurrentRsvpStatus(queryClient, eventId!);
      applyOptimisticRsvp(queryClient, eventId!, nextRsvpStatus(current, status));
      return snapshot;
    },
    onError: (_err, _status, snapshot) => {
      if (snapshot) restoreRsvpSnapshot(queryClient, snapshot);
    },
    onSuccess: () => invalidateRsvpQueries(queryClient),
  });
}

export function useSaveEventMutation(userId: string | undefined, eventId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => toggleSaveEvent(userId!, eventId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventDetail', eventId, userId] });
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
    },
  });
}
