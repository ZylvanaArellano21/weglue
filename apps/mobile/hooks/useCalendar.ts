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
import {
  applyOptimisticRsvp,
  getCurrentRsvpStatus,
  invalidateRsvpQueries,
  nextRsvpStatus,
  restoreRsvpSnapshot,
  snapshotRsvpQueries,
  type RsvpSnapshot,
} from './useEventRsvp';
import { timedQuery } from '../lib/timedQuery';

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
    queryFn: () => timedQuery('calendarMonthMarkers', getCalendarMonthMarkers(userId!, year, month)),
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
    queryFn: () => timedQuery('calendarEvents', getCalendarEvents(userId!)),
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
// Delegates to the shared helpers in useEventRsvp.ts (see there for toggle
// semantics and exactly which caches get patched) so this stays in sync with
// the Home feed and Event Details RSVP mutations.

export function useCalendarRsvp(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { eventId: string; status: 'going' | 'cant' }, RsvpSnapshot>({
    mutationFn: ({ eventId, status }) => rsvpToEvent(userId!, eventId, status),

    onMutate: async ({ eventId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['calendarEvents'] });
      await queryClient.cancelQueries({ queryKey: ['calendarDayEvents'] });
      const snapshot = snapshotRsvpQueries(queryClient);
      const current = getCurrentRsvpStatus(queryClient, eventId);
      applyOptimisticRsvp(queryClient, eventId, nextRsvpStatus(current, status));
      return snapshot;
    },

    onError: (_err, _vars, snapshot) => {
      if (snapshot) restoreRsvpSnapshot(queryClient, snapshot);
    },

    onSuccess: () => invalidateRsvpQueries(queryClient),
  });
}
