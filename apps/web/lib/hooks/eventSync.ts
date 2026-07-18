import type { QueryClient } from "@tanstack/react-query";

// One place that lists every cache an RSVP or save/unsave can affect, so the
// Home feed, Upcoming Events, the calendar (list + month markers + day view),
// Saved Events and any open event-detail overlay all refresh together — the
// same cross-surface sync mobile gets from invalidateRsvpQueries. Because these
// all read the same Supabase rows, mobile sees the change too.
export function invalidateEventState(
  queryClient: QueryClient,
  userId: string | undefined
): void {
  for (const key of [
    ["homeEventsFeed", userId],
    ["calendarEvents", userId],
    ["calendarMonthMarkers", userId],
    ["calendarDayEvents", userId],
    ["savedEventsUpcoming", userId],
    ["savedEventsPast", userId],
    ["ownThisWeekEvents", userId],
  ]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
  // Event-detail overlays are keyed by eventId; invalidate them all.
  void queryClient.invalidateQueries({ queryKey: ["eventDetail"] });
}
