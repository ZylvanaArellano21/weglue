import { QueryClient } from '@tanstack/react-query';
import type { EventDetail, HomeEventsFeedSection } from '../services/eventService';
import type { CalendarEvent, CalendarSection } from '../services/calendarService';

export type RsvpStatus = 'going' | 'cant';

// Centralizes the cache-sync side of RSVP so Home, Event Details, Calendar,
// and Profile → Weekly Events never disagree about whether the user is
// going. Individual screens keep their own useMutation wrapper (matching
// their existing call signatures) but all delegate onMutate/onError/onSuccess
// to the helpers below.
//
// Mirrors the toggle semantics of eventService.rsvpToEvent: tapping the same
// status again clears the RSVP entirely.
export function nextRsvpStatus(
  current: RsvpStatus | null | undefined,
  tapped: RsvpStatus,
): RsvpStatus | null {
  return current === tapped ? null : tapped;
}

// Reads the currently-cached RSVP status for an event from whichever cache
// has it, so onMutate can compute the correct toggle-off/toggle-on result
// without an extra network round trip.
export function getCurrentRsvpStatus(
  queryClient: QueryClient,
  eventId: string,
): RsvpStatus | null | undefined {
  for (const [, data] of queryClient.getQueriesData<EventDetail | null | undefined>({
    queryKey: ['eventDetail'],
  })) {
    if (data && data.id === eventId) return data.user_rsvp_status;
  }
  for (const [, data] of queryClient.getQueriesData<
    { pages: { sections: HomeEventsFeedSection[] }[] } | undefined
  >({ queryKey: ['homeEventsFeed'] })) {
    for (const page of data?.pages ?? []) {
      for (const section of page.sections) {
        const found = section.data.find((e) => e.id === eventId);
        if (found) return found.user_rsvp_status;
      }
    }
  }
  return undefined;
}

export interface RsvpSnapshot {
  eventDetail: [readonly unknown[], unknown][];
  homeEventsFeed: [readonly unknown[], unknown][];
  calendarEvents: [readonly unknown[], unknown][];
  calendarDayEvents: [readonly unknown[], unknown][];
  ownThisWeekEvents: [readonly unknown[], unknown][];
}

// Snapshots every cache this mutation may touch (across every userId/eventId
// variant currently in the cache) so onError can restore them verbatim.
export function snapshotRsvpQueries(queryClient: QueryClient): RsvpSnapshot {
  return {
    eventDetail: queryClient.getQueriesData({ queryKey: ['eventDetail'] }),
    homeEventsFeed: queryClient.getQueriesData({ queryKey: ['homeEventsFeed'] }),
    calendarEvents: queryClient.getQueriesData({ queryKey: ['calendarEvents'] }),
    calendarDayEvents: queryClient.getQueriesData({ queryKey: ['calendarDayEvents'] }),
    ownThisWeekEvents: queryClient.getQueriesData({ queryKey: ['ownThisWeekEvents'] }),
  };
}

export function restoreRsvpSnapshot(queryClient: QueryClient, snapshot: RsvpSnapshot): void {
  for (const [key, data] of snapshot.eventDetail) queryClient.setQueryData(key, data);
  for (const [key, data] of snapshot.homeEventsFeed) queryClient.setQueryData(key, data);
  for (const [key, data] of snapshot.calendarEvents) queryClient.setQueryData(key, data);
  for (const [key, data] of snapshot.calendarDayEvents) queryClient.setQueryData(key, data);
  for (const [key, data] of snapshot.ownThisWeekEvents) queryClient.setQueryData(key, data);
}

// Applies the optimistic patch: flips user_rsvp_status everywhere it's
// cached, and removes the event from Calendar / Weekly Events whenever the
// new status isn't 'going' (both surfaces only ever show going events).
// Adding a newly-'going' event to Calendar/Weekly Events optimistically isn't
// attempted here — those caches use a different shape (CalendarEvent) than
// EventDetail/HomeFeedEvent, and inventing a synthetic row risks visual
// glitches; onSuccess invalidation picks it up within one round trip.
export function applyOptimisticRsvp(
  queryClient: QueryClient,
  eventId: string,
  nextStatus: RsvpStatus | null,
): void {
  queryClient.setQueriesData<EventDetail | null | undefined>(
    { queryKey: ['eventDetail'] },
    (old) => (old && old.id === eventId ? { ...old, user_rsvp_status: nextStatus } : old),
  );

  queryClient.setQueriesData<{ pages: { sections: HomeEventsFeedSection[]; hasMore: boolean }[] } | undefined>(
    { queryKey: ['homeEventsFeed'] },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          sections: page.sections.map((section) => ({
            ...section,
            data: section.data.map((event) =>
              event.id === eventId ? { ...event, user_rsvp_status: nextStatus } : event,
            ),
          })),
        })),
      };
    },
  );

  if (nextStatus !== 'going') {
    queryClient.setQueriesData<CalendarEvent[] | undefined>(
      { queryKey: ['calendarEvents'] },
      (old) => old?.filter((e) => e.id !== eventId),
    );
    queryClient.setQueriesData<CalendarEvent[] | undefined>(
      { queryKey: ['calendarDayEvents'] },
      (old) => old?.filter((e) => e.id !== eventId),
    );
    queryClient.setQueriesData<CalendarSection[] | undefined>(
      { queryKey: ['ownThisWeekEvents'] },
      (old) =>
        old
          ?.map((section) => ({ ...section, data: section.data.filter((e) => e.id !== eventId) }))
          .filter((section) => section.data.length > 0),
    );
  }
}

// Every query that must eventually reflect the true server state — covers
// the "add to calendar/weekly events" case the optimistic patch above skips,
// plus attendee counts/previews which are never patched optimistically.
export function invalidateRsvpQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ['eventDetail'] });
  queryClient.invalidateQueries({ queryKey: ['homeEventsFeed'] });
  queryClient.invalidateQueries({ queryKey: ['eventAttendees'] });
  queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
  queryClient.invalidateQueries({ queryKey: ['calendarMonthMarkers'] });
  queryClient.invalidateQueries({ queryKey: ['calendarDayEvents'] });
  queryClient.invalidateQueries({ queryKey: ['ownThisWeekEvents'] });
}
