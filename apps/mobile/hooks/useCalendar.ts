import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCalendarMonthMarkers,
  getCalendarEvents,
  getCalendarDayEvents,
  bucketCalendarEvents,
  type CalendarEvent,
  type CalendarSection,
} from '../services/calendarService';
import { rsvpToEvent } from '../services/eventService';

// ─── Month markers ────────────────────────────────────────────────────────────
// Returns the array of YYYY-MM-DD date strings for which the current user has
// at least one 'going' RSVP in the given month. Feed into the grid component.

export function useCalendarMonthMarkers(
  userId: string | undefined,
  year: number,
  month: number,  // 1-indexed
) {
  return useQuery({
    queryKey: ['calendarMonthMarkers', userId, year, month],
    queryFn: () => getCalendarMonthMarkers(userId!, year, month),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

// ─── Section list ─────────────────────────────────────────────────────────────
// Returns the user's going events bucketed into CalendarSection[].
// The `select` transform runs the pure bucketing function on every render so
// the day-diff calculation always uses the live current date.

export function useCalendarSections(userId: string | undefined) {
  return useQuery<CalendarEvent[], Error, CalendarSection[]>({
    queryKey: ['calendarEvents', userId],
    queryFn: () => getCalendarEvents(userId!),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    select: (events) => {
      const today = new Date().toISOString().split('T')[0];
      return bucketCalendarEvents(events, today);
    },
  });
}

// ─── Day events (multi-event navigation) ─────────────────────────────────────
// Sorted by start_time. Used by the calendar event-detail screen to populate
// the dots navigator and swipe-down handler.

export function useCalendarDayEvents(
  userId: string | undefined,
  date: string | undefined,  // YYYY-MM-DD
) {
  return useQuery({
    queryKey: ['calendarDayEvents', userId, date],
    queryFn: () => getCalendarDayEvents(userId!, date!),
    enabled: !!userId && !!date,
    staleTime: 60 * 1000,
  });
}

// ─── RSVP with optimistic update ─────────────────────────────────────────────
//
// Shared RSVP mutation wired to all calendar entry points. Performs an
// OPTIMISTIC removal of the event from the calendar section list so the UI
// reflects the change instantly, then rolls back if the Supabase write fails.
//
// Going logic (matches eventService.rsvpToEvent):
//   - status='going' when already going  → deletes the row (toggle off)
//   - status='going' when no row exists  → upserts (new RSVP)
//   - status='cant'  when going row exists → upserts to 'cant'
//   - status='cant'  when no row exists  → no-op (the service handles this;
//     the mutation itself still calls through, the service does nothing)
//
// In all cases where the event's rsvp is removed or changed to 'cant',
// it should disappear from the calendar (which only shows 'going' events).
// The optimistic update handles this immediately; invalidation refreshes later.

export function useCalendarRsvp(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      eventId,
      status,
    }: {
      eventId: string;
      status: 'going' | 'cant';
    }) => rsvpToEvent(userId!, eventId, status),

    onMutate: async ({ eventId, status }) => {
      // Only optimistic-update when removing from calendar ('cant' or toggling off 'going')
      // Both cases should remove the event from the visible list immediately.
      await queryClient.cancelQueries({ queryKey: ['calendarEvents', userId] });
      await queryClient.cancelQueries({ queryKey: ['calendarDayEvents', userId] });

      const previousEvents = queryClient.getQueryData<CalendarEvent[]>([
        'calendarEvents',
        userId,
      ]);

      // Remove from the flat events list regardless of which action —
      // either the going row is deleted (toggle off) or set to cant.
      // Either way the event leaves the calendar view.
      queryClient.setQueryData<CalendarEvent[]>(
        ['calendarEvents', userId],
        (old = []) => old.filter((e) => e.id !== eventId),
      );

      // Also update the day-events cache if it exists
      queryClient.setQueryData<CalendarEvent[]>(
        // Note: date comes from the day's cache keys; cancel covers all variants
        ['calendarDayEvents', userId],
        (old = []) => {
          if (!old) return old;
          return old.filter((e) => e.id !== eventId);
        },
      );

      return { previousEvents };
    },

    onError: (_err, { eventId }, context) => {
      // Roll back the optimistic removal
      if (context?.previousEvents) {
        queryClient.setQueryData(['calendarEvents', userId], context.previousEvents);
      }
      // Let React Query refetch fresh state for day events
      queryClient.invalidateQueries({ queryKey: ['calendarDayEvents', userId] });
    },

    onSuccess: () => {
      // Invalidate all affected queries after the server write succeeds
      queryClient.invalidateQueries({ queryKey: ['calendarEvents', userId] });
      queryClient.invalidateQueries({ queryKey: ['calendarMonthMarkers', userId] });
      queryClient.invalidateQueries({ queryKey: ['calendarDayEvents', userId] });
      // Keep the home feed and event detail in sync
      queryClient.invalidateQueries({ queryKey: ['homeEventsFeed', userId] });
      queryClient.invalidateQueries({ queryKey: ['eventDetail'] });
      queryClient.invalidateQueries({ queryKey: ['eventAttendees'] });
    },
  });
}
