import { useInfiniteQuery } from '@tanstack/react-query';
import { getEventAttendees } from '../services/eventService';

export function useEventAttendees(
  eventId: string | undefined,
  viewerUserId: string | undefined,
  search: string = '',
) {
  return useInfiniteQuery({
    queryKey: ['eventAttendees', eventId, viewerUserId, search],
    queryFn: ({ pageParam = 0 }) =>
      getEventAttendees(eventId!, viewerUserId!, pageParam, search),
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.reduce((sum, p) => sum + p.attendees.length, 0);
      return fetched < (lastPage.total ?? 0) ? allPages.length : undefined;
    },
    initialPageParam: 0,
    enabled: !!eventId && !!viewerUserId,
    staleTime: 60 * 1000,
  });
}
