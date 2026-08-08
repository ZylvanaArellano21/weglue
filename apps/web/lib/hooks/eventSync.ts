import type { QueryClient } from "@tanstack/react-query";

/** Applies a small event state change to every event-shaped cached value.  The
 * feeds use different envelopes (infinite pages, calendar sections, detail),
 * so keeping this traversal here avoids card/detail cache drift. */
export function patchCachedEvent(
  queryClient: QueryClient,
  eventId: string,
  patch: Record<string, unknown> | ((event: Record<string, any>) => Record<string, unknown>)
): void {
  const visit = (value: any): any => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const own = value.id === eventId && ("is_saved" in value || "user_rsvp_status" in value || "attendee_count" in value)
      ? { ...value, ...(typeof patch === "function" ? patch(value) : patch) }
      : value;
    let changed = own !== value;
    const next: Record<string, unknown> = { ...own };
    for (const [key, child] of Object.entries(own)) {
      const resolved = visit(child);
      if (resolved !== child) { next[key] = resolved; changed = true; }
    }
    return changed ? next : value;
  };
  for (const key of [["homeEventsFeed"], ["eventDetail"], ["savedEventsUpcoming"], ["calendarEvents"], ["calendarDayEvents"], ["clubEventsFeed"], ["clubCalendarEvents"]]) {
    queryClient.setQueriesData({ queryKey: key }, visit);
  }
}

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
    ["savedEventsCount", userId],
    ["ownThisWeekEvents", userId],
  ]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
  // Event-detail overlays are keyed by eventId; invalidate them all. Likewise
  // the club-scoped feeds + club calendar markers (Club Profile Home/Calendar).
  void queryClient.invalidateQueries({ queryKey: ["eventDetail"] });
  void queryClient.invalidateQueries({ queryKey: ["eventAttendees"] });
  void queryClient.invalidateQueries({ queryKey: ["clubEventsFeed"] });
  void queryClient.invalidateQueries({ queryKey: ["clubCalendarEvents"] });
}

/**
 * Drop event payloads before the next RLS-backed fetch when a capability is
 * lost. Invalidating alone leaves React Query's old successful value renderable
 * while a delayed refetch is in flight.
 *
 * `resetQueries`, NOT `removeQueries`: both discard the payload, but
 * `removeQueries` destroys a query that still has observers, so an in-flight
 * fetch resolves onto a discarded object and the screen is stranded in a
 * permanent loading state instead of refetching. That was reproduced on the
 * Messages route and is the same hazard here — these roots are cleared on every
 * client route transition, when the screens using them are mounted.
 */
export function clearPermissionSensitiveEventState(queryClient: QueryClient): void {
  for (const key of [
    ["homeEventsFeed"],
    ["eventDetail"],
    ["eventAttendees"],
    ["eventForEdit"],
    ["clubEventsFeed"],
    ["clubCalendarEvents"],
    ["calendarEvents"],
    ["calendarMonthMarkers"],
    ["calendarDayEvents"],
    ["savedEventsUpcoming"],
    ["savedEventsPast"],
    ["savedEventsCount"],
    ["ownThisWeekEvents"],
    ["userWeeklyEvents"],
    ["eventAudienceMemberSearch"],
  ]) {
    void queryClient.resetQueries({ queryKey: key });
  }
}

/** Clear first, then ask active observers to reload only authorized state. */
export function refreshPermissionSensitiveEventState(
  queryClient: QueryClient,
  userId: string | undefined
): void {
  clearPermissionSensitiveEventState(queryClient);
  invalidateEventState(queryClient, userId);
}
