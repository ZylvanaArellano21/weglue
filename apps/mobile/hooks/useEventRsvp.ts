import { QueryClient } from '@tanstack/react-query';
import type { EventDetail, HomeEventsFeedSection } from '../services/eventService';
import type { CalendarEvent, CalendarSection } from '../services/calendarService';

export type RsvpStatus = 'going' | 'cant';
/** The explicit end-state an RSVP action targets: a status, or null to clear. */
export type DesiredRsvp = RsvpStatus | null;

// Centralizes the cache-sync side of RSVP so Home, Event Details, Calendar,
// and Profile → Weekly Events never disagree about whether the user is
// going. Individual screens keep their own useMutation wrapper (matching
// their existing call signatures) but all delegate onMutate/onError/onSuccess
// to the helpers below.
//
// The RSVP contract is explicit desired-state, not a toggle: the component
// computes the target here (a second tap on the active choice targets null) and
// passes it to both the optimistic patch and the service, so a retry re-applies
// the same end-state rather than flipping it.
export function nextRsvpStatus(
  current: RsvpStatus | null | undefined,
  tapped: RsvpStatus,
): DesiredRsvp {
  return current === tapped ? null : tapped;
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

/**
 * The save/unsave counterpart of invalidateRsvpQueries: ONE place listing every
 * cache a bookmark changes, so the Saved Events screen and every bookmark icon
 * refresh together. Mirrors the web's invalidateEventState.
 *
 * Saving used to invalidate only the Home feed. Because savedEventsUpcoming
 * carries a 2-minute staleTime, an already-cached (empty) Saved Events list was
 * served straight from cache after a save — the row was in the database, the
 * bookmark icon was filled, and Saved Events still said "No upcoming saved
 * events". It only appeared to be a persistence bug.
 */
export function invalidateSaveQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ['savedEventsUpcoming'] });
  queryClient.invalidateQueries({ queryKey: ['savedEventsPast'] });
  queryClient.invalidateQueries({ queryKey: ['eventDetail'] });
  queryClient.invalidateQueries({ queryKey: ['homeEventsFeed'] });
  // Every other surface that renders an is_saved bookmark icon.
  queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
  queryClient.invalidateQueries({ queryKey: ['calendarDayEvents'] });
  queryClient.invalidateQueries({ queryKey: ['ownThisWeekEvents'] });
  queryClient.invalidateQueries({ queryKey: ['userWeeklyEvents'] });
  queryClient.invalidateQueries({ queryKey: ['discoveryEvents'] });
  queryClient.invalidateQueries({ queryKey: ['discoverySearch'] });
}
