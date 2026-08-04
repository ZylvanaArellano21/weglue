// Shared event/location display + past-vs-upcoming rules. Every surface that
// shows an event location or splits events by time MUST go through these
// helpers so all clubs — current and future — behave identically.

import { todayInAppTz, nowTimeInAppTz } from './timezone';

// "Building F, Room 219" — never raw "F, 219, Building F, Room 219" joins.
// Structured building/room win over the free-text location so the same data
// is never rendered twice; free text is the fallback when structure is absent.
export function formatEventLocation(
  building: string | null | undefined,
  room: string | null | undefined,
  location: string | null | undefined,
): string {
  const b = building?.trim();
  const r = room?.trim();
  if (b && r) return `Building ${b}, Room ${r}`;
  if (b) return `Building ${b}`;
  if (r) return `Room ${r}`;
  return location?.trim() ?? '';
}

// An event is "past" only once its real end datetime (event_date + end_time,
// America/Chicago wall clock) is behind now — date-only comparisons would
// flip today's still-running events to past at midnight.
export function isEventPast(
  eventDate: string,
  endTime: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const today = todayInAppTz(now);
  if (eventDate < today) return true;
  if (eventDate > today) return false;
  // Same calendar day: compare wall-clock end time. Missing end time is
  // treated as end-of-day so the event never disappears early.
  if (!endTime) return false;
  // Equality is past: an event ends at the exact end wall-clock instant.
  return endTime <= nowTimeInAppTz(now);
}

/**
 * `event_end_at` is the canonical UTC instant derived in PostgreSQL from the
 * event's America/Chicago wall-clock date and end time. Prefer it everywhere
 * it is present; the date/time helper above remains only for legacy rows.
 */
export function isEventPastAt(
  eventEndAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!eventEndAt) return false;
  const endMs = Date.parse(eventEndAt);
  return Number.isFinite(endMs) && endMs <= now.getTime();
}

export interface EventTimeFields {
  event_date: string;
  start_time: string;
  end_time: string;
  event_end_at?: string | null;
}

// One event source → both sections. Upcoming keeps events whose end is strictly
// later than now (soonest first); past includes the exact end boundary.
export function splitPastAndUpcoming<T extends EventTimeFields>(
  events: T[],
  now: Date = new Date(),
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const e of events) {
    const hasEnded = e.event_end_at
      ? isEventPastAt(e.event_end_at, now)
      : isEventPast(e.event_date, e.end_time, now);
    (hasEnded ? past : upcoming).push(e);
  }
  upcoming.sort(
    (a, b) =>
      a.event_date.localeCompare(b.event_date) ||
      a.start_time.localeCompare(b.start_time),
  );
  past.sort(
    (a, b) =>
      b.event_date.localeCompare(a.event_date) ||
      b.start_time.localeCompare(a.start_time),
  );
  return { upcoming, past };
}
