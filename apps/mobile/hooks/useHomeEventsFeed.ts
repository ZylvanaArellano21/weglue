import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getHomeEventsFeed,
  rsvpToEvent,
  toggleSaveEvent,
} from '../services/eventService';

export function useHomeEventsFeed(userId: string | undefined) {
  return useQuery({
    queryKey: ['homeEventsFeed', userId],
    queryFn: () => getHomeEventsFeed(userId!),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useRsvpToEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, eventId, status }: { userId: string; eventId: string; status: 'going' | 'cant' }) =>
      rsvpToEvent(userId, eventId, status),
    onSuccess: (_data, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
      queryClient.invalidateQueries({ queryKey: ['eventDetail'] });
      queryClient.invalidateQueries({ queryKey: ['calendarEvents', userId] });
      queryClient.invalidateQueries({ queryKey: ['calendarMonthMarkers', userId] });
      queryClient.invalidateQueries({ queryKey: ['calendarDayEvents', userId] });
    },
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
