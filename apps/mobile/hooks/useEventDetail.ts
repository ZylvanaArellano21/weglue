import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEventDetail, rsvpToEvent, toggleSaveEvent } from '../services/eventService';

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
  return useMutation({
    mutationFn: (status: 'going' | 'cant') =>
      rsvpToEvent(userId!, eventId!, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventDetail', eventId, userId] });
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
      queryClient.invalidateQueries({ queryKey: ['eventAttendees', eventId] });
    },
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
