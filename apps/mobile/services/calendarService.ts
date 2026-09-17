import { supabase } from '../lib/supabase';
import { currentWeekRange, addDaysToDateString } from '../lib/timezone';
import type { AttendeePreview, EventImage } from './eventService';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  emoji: string | null;
  event_date: string;   // YYYY-MM-DD
  start_time: string;   // HH:MM:SS
  end_time: string;     // HH:MM:SS
  event_end_at: string; // canonical UTC lifecycle boundary
  visibility: 'everyone' | 'members' | 'specific';
  location: string | null;
  building: string | null;
  room: string | null;
  cover_image_url: string | null;
  /** Ordered image set (task 4). getCalendarEvents (the tab's own list, kept
   *  lean like every other feed list) synthesizes this from cover_image_url
   *  alone with no extra query; getCalendarDayEvents (the detail screen's
   *  data source) fetches the real ordered set. */
  images: EventImage[];
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
  imagesByEvent?: Map<string, EventImage[]>,
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
    event_end_at: e.event_end_at,
    visibility: (e.visibility ?? 'everyone') as CalendarEvent['visibility'],
    location: e.location ?? null,
    building: e.building ?? null,
    room: e.room ?? null,
    cover_image_url: e.cover_image_url ?? null,
    images: imagesByEvent?.get(e.id) ?? (e.cover_image_url ? [{ path: e.cover_image_url, position: 0, width: null, height: null }] : []),
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
    .select('event_date, event_end_at')
    .in('id', eventIds)
    .gte('event_date', firstDay)
    .lte('event_date', lastDay)
    .gt('event_end_at', new Date().toISOString());

  if (!events) return [];

  return [...new Set<string>((events as any[]).map((e) => e.event_date as string))];
}

// All going events for the user from today onward, sorted chronologically.
// Used for the section list on the Calendar tab. The caller runs bucketCalendarEvents
// on the result so the bucketing always uses the live current date.
export async function getCalendarEvents(userId: string): Promise<CalendarEvent[]> {

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
      id, title, emoji, event_date, start_time, end_time, event_end_at, visibility,
      location, building, room, cover_image_url,
      clubs!inner(id, name, avatar_url)
    `)
    .in('id', eventIds)
    .gt('event_end_at', new Date().toISOString())
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
      id, title, emoji, event_date, start_time, end_time, event_end_at, visibility,
      location, building, room, cover_image_url,
      clubs!inner(id, name, avatar_url)
    `)
    .in('id', eventIds)
    .eq('event_date', date)
    .gt('event_end_at', new Date().toISOString())
    .order('start_time', { ascending: true });

  if (!rawEvents) return [];

  const dayEventIds = (rawEvents as any[]).map((e) => e.id);
  const { data: imageRows } = await supabase
    .from('event_images')
    .select('event_id, storage_path, position, width, height')
    .in('event_id', dayEventIds)
    .order('position', { ascending: true });
  const imagesByEvent = new Map<string, EventImage[]>();
  for (const row of (imageRows ?? []) as any[]) {
    const list = imagesByEvent.get(row.event_id) ?? [];
    list.push({ path: row.storage_path, position: row.position, width: row.width ?? null, height: row.height ?? null });
    imagesByEvent.set(row.event_id, list);
  }

  return enrichWithAttendees(rawEvents as any[], userId, imagesByEvent);
}

// ─── Section bucketing ───────────────────────────────────────────────────────
//
// Pure function — no Supabase calls. Always computed from the live current date
// so buckets stay accurate without stale offsets between renders.
//
// Bucket boundaries use TRUE Monday–Sunday calendar weeks (mirrors
// apps/web/lib/hooks/useCalendar.ts's bucketCalendarEvents), not a rolling
// 7/14/30-day window — a rolling window put next week's events under "This
// Week" whenever today wasn't a Monday.
//   TODAY:      event_date === today
//   THIS WEEK:  rest of the current Monday–Sunday week
//   NEXT WEEK:  the immediately following Monday–Sunday
//   THIS MONTH: remainder of the current calendar month
//   NEXT MONTH: everything after that (uncapped)
//
// Events within each bucket are already chronologically sorted by the Supabase query.
export function bucketCalendarEvents(
  events: CalendarEvent[],
  todayStr: string, // YYYY-MM-DD
): CalendarSection[] {
  const { end: weekEnd } = currentWeekRange(new Date(todayStr + 'T12:00:00Z'));
  const nextWeekEnd = addDaysToDateString(weekEnd, 7);

  const [y, m] = todayStr.split('-').map(Number) as [number, number];
  const thisMonthEnd = `${y}-${String(m).padStart(2, '0')}-${String(
    new Date(y, m, 0).getDate(),
  ).padStart(2, '0')}`;

  const buckets: Record<CalendarBucketKey, CalendarEvent[]> = {
    today: [],
    this_week: [],
    next_week: [],
    this_month: [],
    next_month: [],
  };

  for (const event of events) {
    const d = event.event_date;

    let key: CalendarBucketKey;
    if (d === todayStr) key = 'today';
    else if (d <= weekEnd) key = 'this_week';
    else if (d <= nextWeekEnd) key = 'next_week';
    else if (d <= thisMonthEnd) key = 'this_month';
    else key = 'next_month';

    buckets[key].push(event);
  }

  return (
    (['today', 'this_week', 'next_week', 'this_month', 'next_month'] as CalendarBucketKey[])
      .filter((k) => buckets[k].length > 0)
      .map((k) => ({ key: k, label: CALENDAR_BUCKET_LABELS[k], data: buckets[k] }))
  );
}
