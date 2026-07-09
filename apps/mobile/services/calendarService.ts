import { supabase } from '../lib/supabase';
import { todayInAppTz } from '../lib/timezone';
import type { AttendeePreview } from './eventService';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  emoji: string | null;
  event_date: string;   // YYYY-MM-DD
  start_time: string;   // HH:MM:SS
  end_time: string;     // HH:MM:SS
  location: string | null;
  building: string | null;
  room: string | null;
  cover_image_url: string | null;
  club: { id: string; name: string; avatar_url: string | null };
  attendee_count: number;
  attendee_preview: AttendeePreview[];
  user_rsvp_status: 'going' | 'cant' | null;
  is_saved: boolean;
}

export type CalendarBucketKey =
  | 'today'
  | 'this_week'
  | 'next_week'
  | 'this_month'
  | 'next_month';

export const CALENDAR_BUCKET_LABELS: Record<CalendarBucketKey, string> = {
  today: 'Today',
  this_week: 'This Week',
  next_week: 'Next Week',
  this_month: 'This Month',
  next_month: 'Next Month',
};

export interface CalendarSection {
  key: CalendarBucketKey;
  label: string;
  data: CalendarEvent[];
}

// ─── Prop interface contract for Cursor Step 2 visual components ──────────────
//
// DotNavigatorProps — the visual dots row component Cursor will build.
//   currentIndex:  0-based index of the event currently on screen
//   totalEvents:   total events for this day (dots count)
//   onDotPress:    jump directly to event at that index (bypasses sequential order)
//
// The parent screen also exposes:
//   onSwipeDown(): void — advance to next event (capped at totalEvents-1, no wraparound)
//
// CalendarEventDetailParams (URL/navigation params):
//   date:            YYYY-MM-DD — the calendar day that was tapped
//   initialEventId:  UUID — the event to show first (earliest start_time for that day)
//   isPast:          'true' | 'false' — date < today (date-only, ignore time)
//                    When isPast='true' the detail screen renders read-only
//                    (no Going/Can't buttons)
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Internal helper ─────────────────────────────────────────────────────────

async function enrichWithAttendees(
  rawEvents: any[],
  userId: string,
): Promise<CalendarEvent[]> {
  if (rawEvents.length === 0) return [];

  const ids = rawEvents.map((e) => e.id);

  const [{ data: goingRsvps }, { data: savedRows }] = await Promise.all([
    supabase
      .from('event_rsvps')
      .select('event_id, profiles!inner(id, username, avatar_url)')
      .in('event_id', ids)
      .eq('status', 'going'),
    supabase
      .from('saved_events')
      .select('event_id')
      .eq('user_id', userId)
      .in('event_id', ids),
  ]);

  const countMap = new Map<string, number>();
  const previewMap = new Map<string, AttendeePreview[]>();
  const savedSet = new Set<string>((savedRows ?? []).map((s: any) => s.event_id));

  for (const row of (goingRsvps as any[]) ?? []) {
    countMap.set(row.event_id, (countMap.get(row.event_id) ?? 0) + 1);
    const list = previewMap.get(row.event_id) ?? [];
    if (list.length < 4) {
      list.push({
        id: row.profiles.id,
        username: row.profiles.username,
        avatar_url: row.profiles.avatar_url,
      });
      previewMap.set(row.event_id, list);
    }
  }

  return rawEvents.map((e): CalendarEvent => ({
    id: e.id,
    title: e.title,
    emoji: e.emoji ?? null,
    event_date: e.event_date,
    start_time: e.start_time,
    end_time: e.end_time,
    location: e.location ?? null,
    building: e.building ?? null,
    room: e.room ?? null,
    cover_image_url: e.cover_image_url ?? null,
    club: { id: e.clubs.id, name: e.clubs.name, avatar_url: e.clubs.avatar_url ?? null },
    attendee_count: countMap.get(e.id) ?? 0,
    attendee_preview: previewMap.get(e.id) ?? [],
    user_rsvp_status: 'going',
    is_saved: savedSet.has(e.id),
  }));
}

// ─── Public API ──────────────────────────────────────────────────────────────

// Returns the set of YYYY-MM-DD date strings within the given month where the
// user has at least one 'going' RSVP. Single round-trip: fetch the user's going
// event_ids, then filter by date range. UI maps over the result to render markers.
export async function getCalendarMonthMarkers(
  userId: string,
  year: number,
  month: number,  // 1-indexed (1=Jan, 12=Dec)
): Promise<string[]> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const firstDay = `${year}-${pad(month)}-01`;
  const lastDayNum = new Date(year, month, 0).getDate();
  const lastDay = `${year}-${pad(month)}-${pad(lastDayNum)}`;

  const { data: rsvps } = await supabase
    .from('event_rsvps')
    .select('event_id')
    .eq('user_id', userId)
    .eq('status', 'going');

  if (!rsvps || rsvps.length === 0) return [];

  const eventIds = (rsvps as any[]).map((r) => r.event_id);

  const { data: events } = await supabase
    .from('events')
    .select('event_date')
    .in('id', eventIds)
    .gte('event_date', firstDay)
    .lte('event_date', lastDay);

  if (!events) return [];

  return [...new Set<string>((events as any[]).map((e) => e.event_date as string))];
}

// All going events for the user from today onward, sorted chronologically.
// Used for the section list on the Calendar tab. The caller runs bucketCalendarEvents
// on the result so the bucketing always uses the live current date.
export async function getCalendarEvents(userId: string): Promise<CalendarEvent[]> {
  const today = todayInAppTz();

  const { data: rsvps } = await supabase
    .from('event_rsvps')
    .select('event_id')
    .eq('user_id', userId)
    .eq('status', 'going');

  if (!rsvps || rsvps.length === 0) return [];

  const eventIds = (rsvps as any[]).map((r) => r.event_id);

  const { data: rawEvents } = await supabase
    .from('events')
    .select(`
      id, title, emoji, event_date, start_time, end_time,
      location, building, room, cover_image_url,
      clubs!inner(id, name, avatar_url)
    `)
    .in('id', eventIds)
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (!rawEvents) return [];

  return enrichWithAttendees(rawEvents as any[], userId);
}

// Events for a specific calendar day, sorted by start_time. Used by the calendar
// event-detail screen for multi-event navigation (dots + swipe-down).
export async function getCalendarDayEvents(
  userId: string,
  date: string, // YYYY-MM-DD
): Promise<CalendarEvent[]> {
  const { data: rsvps } = await supabase
    .from('event_rsvps')
    .select('event_id')
    .eq('user_id', userId)
    .eq('status', 'going');

  if (!rsvps || rsvps.length === 0) return [];

  const eventIds = (rsvps as any[]).map((r) => r.event_id);

  const { data: rawEvents } = await supabase
    .from('events')
    .select(`
      id, title, emoji, event_date, start_time, end_time,
      location, building, room, cover_image_url,
      clubs!inner(id, name, avatar_url)
    `)
    .in('id', eventIds)
    .eq('event_date', date)
    .order('start_time', { ascending: true });

  if (!rawEvents) return [];

  return enrichWithAttendees(rawEvents as any[], userId);
}

// ─── Section bucketing ───────────────────────────────────────────────────────
//
// Pure function — no Supabase calls. Always computed from the live current date
// so buckets stay accurate without stale offsets between renders.
//
// Bucket boundaries (day-only comparison, time is stripped):
//   TODAY:      dayDiff === 0
//   THIS WEEK:  dayDiff  1–7
//   NEXT WEEK:  dayDiff  8–14
//   THIS MONTH: dayDiff 15–30
//   NEXT MONTH: dayDiff 31+  (uncapped)
//
// Events within each bucket are already chronologically sorted by the Supabase query.
export function bucketCalendarEvents(
  events: CalendarEvent[],
  todayStr: string, // YYYY-MM-DD
): CalendarSection[] {
  const todayMs = new Date(todayStr + 'T00:00:00').getTime();

  const buckets: Record<CalendarBucketKey, CalendarEvent[]> = {
    today: [],
    this_week: [],
    next_week: [],
    this_month: [],
    next_month: [],
  };

  for (const event of events) {
    const eventMs = new Date(event.event_date + 'T00:00:00').getTime();
    const dayDiff = Math.round((eventMs - todayMs) / 86_400_000);

    let key: CalendarBucketKey;
    if (dayDiff === 0) key = 'today';
    else if (dayDiff <= 7) key = 'this_week';
    else if (dayDiff <= 14) key = 'next_week';
    else if (dayDiff <= 30) key = 'this_month';
    else key = 'next_month';

    buckets[key].push(event);
  }

  return (
    (['today', 'this_week', 'next_week', 'this_month', 'next_month'] as CalendarBucketKey[])
      .filter((k) => buckets[k].length > 0)
      .map((k) => ({ key: k, label: CALENDAR_BUCKET_LABELS[k], data: buckets[k] }))
  );
}
