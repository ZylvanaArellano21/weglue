import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSavedEventsUpcoming,
  getSavedEventsPast,
} from '../services/savedEventsService';
import { toggleSaveEvent } from '../services/eventService';

export function useSavedEventsUpcoming(userId: string | undefined) {
  return useQuery({
    queryKey: ['savedEventsUpcoming', userId],
    queryFn:  () => getSavedEventsUpcoming(userId!),
    enabled:  !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useSavedEventsPast(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey:      ['savedEventsPast', userId],
    queryFn:       ({ pageParam = 0 }) => getSavedEventsPast(userId!, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === 20 ? allPages.length : undefined,
    enabled:  !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

export function useUnsaveEvent(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => toggleSaveEvent(userId!, eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['savedEventsUpcoming', userId] });
      queryClient.invalidateQueries({ queryKey: ['savedEventsPast', userId] });
      // Also invalidate home feed and calendar so save badges update
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
      queryClient.invalidateQueries({ queryKey: ['calendarEvents', userId] });
    },
  });
}
