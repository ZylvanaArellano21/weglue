import { InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSavedEventsUpcoming,
  getSavedEventsPast,
} from '../services/savedEventsService';
import { toggleSaveEvent } from '../services/eventService';
import type { CalendarEvent, CalendarSection } from '../services/calendarService';

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

interface UnsaveSnapshot {
  prevUpcoming: CalendarSection[] | undefined;
  prevPast: InfiniteData<CalendarEvent[]> | undefined;
}

// Optimistic unsave: the event disappears from Saved Events instantly; if the
// backend call fails, the snapshot restores it and the screen shows an error.
export function useUnsaveEvent(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation<boolean, Error, string, UnsaveSnapshot>({
    mutationFn: (eventId: string) => toggleSaveEvent(userId!, eventId),
    onMutate: async (eventId) => {
      await queryClient.cancelQueries({ queryKey: ['savedEventsUpcoming', userId] });
      await queryClient.cancelQueries({ queryKey: ['savedEventsPast', userId] });

      const prevUpcoming = queryClient.getQueryData<CalendarSection[]>([
        'savedEventsUpcoming',
        userId,
      ]);
      const prevPast = queryClient.getQueryData<InfiniteData<CalendarEvent[]>>([
        'savedEventsPast',
        userId,
      ]);

      queryClient.setQueryData<CalendarSection[]>(
        ['savedEventsUpcoming', userId],
        (old) =>
          old
            ?.map((section) => ({
              ...section,
              data: section.data.filter((e) => e.id !== eventId),
            }))
            .filter((section) => section.data.length > 0),
      );

      queryClient.setQueryData<InfiniteData<CalendarEvent[]>>(
        ['savedEventsPast', userId],
        (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => page.filter((e) => e.id !== eventId)),
              }
            : old,
      );

      return { prevUpcoming, prevPast };
    },
    onError: (_err, _eventId, snapshot) => {
      // Restore the saved state so nothing silently disappears on failure.
      if (snapshot?.prevUpcoming !== undefined) {
        queryClient.setQueryData(['savedEventsUpcoming', userId], snapshot.prevUpcoming);
      }
      if (snapshot?.prevPast !== undefined) {
        queryClient.setQueryData(['savedEventsPast', userId], snapshot.prevPast);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['savedEventsUpcoming', userId] });
      queryClient.invalidateQueries({ queryKey: ['savedEventsPast', userId] });
      // Also refresh home feed, calendar, and any open event detail so save
      // badges stay in sync everywhere.
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
      queryClient.invalidateQueries({ queryKey: ['calendarEvents', userId] });
      queryClient.invalidateQueries({ queryKey: ['eventDetail'] });
    },
  });
}
