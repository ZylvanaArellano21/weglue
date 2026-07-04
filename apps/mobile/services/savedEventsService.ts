import { supabase } from '../lib/supabase';
import { bucketCalendarEvents, type CalendarEvent, type CalendarSection } from './calendarService';
import type { AttendeePreview } from './eventService';

// ─── Saved Events (fully independent of event_rsvps / attendance) ────────────
//
// toggleSaveEvent lives in eventService.ts — use that for save/unsave.
// This service covers the Saved Events screen's data needs only.
//

export interface SavedEventsData {
  upcoming: CalendarSection[];   // bucketed by TODAY / THIS WEEK / etc.
  past:     CalendarEvent[];     // past saved events, most-recent-first
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function enrichSavedEvents(
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

  const countMap  = new Map<string, number>();
  const previewMap = new Map<string, AttendeePreview[]>();
  const savedSet  = new Set<string>((savedRows ?? []).map((s: any) => s.event_id));

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

  // Check the user's own RSVP status for each event
  const { data: userRsvps } = await supabase
    .from('event_rsvps')
    .select('event_id, status')
    .eq('user_id', userId)
    .in('event_id', ids);

  const rsvpMap = new Map(
    (userRsvps ?? []).map((r: any) => [r.event_id, r.status as 'going' | 'cant']),
  );

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
    user_rsvp_status: rsvpMap.get(e.id) ?? null,
    is_saved: savedSet.has(e.id),
  }));
}

// ─── Fetch saved event IDs for this user ─────────────────────────────────────

async function getSavedEventIds(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('saved_events')
    .select('event_id')
    .eq('user_id', userId);

  return ((data ?? []) as any[]).map((r) => r.event_id);
}

// ─── Public API ──────────────────────────────────────────────────────────────

// All upcoming saved events, bucketed using the same logic as Calendar tab.
export async function getSavedEventsUpcoming(userId: string): Promise<CalendarSection[]> {
  const today = new Date().toISOString().split('T')[0];
  const savedIds = await getSavedEventIds(userId);
  if (savedIds.length === 0) return [];

  const { data: rawEvents } = await supabase
    .from('events')
    .select(`
      id, title, emoji, event_date, start_time, end_time,
      location, building, room, cover_image_url,
      clubs!inner(id, name, avatar_url)
    `)
    .in('id', savedIds)
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (!rawEvents || rawEvents.length === 0) return [];

  const enriched = await enrichSavedEvents(rawEvents as any[], userId);
  return bucketCalendarEvents(enriched, today);
}

// Past saved events, most-recent-first.
export async function getSavedEventsPast(
  userId: string,
  page: number = 0,
  pageSize: number = 20,
): Promise<CalendarEvent[]> {
  const today = new Date().toISOString().split('T')[0];
  const savedIds = await getSavedEventIds(userId);
  if (savedIds.length === 0) return [];

  const { data: rawEvents } = await supabase
    .from('events')
    .select(`
      id, title, emoji, event_date, start_time, end_time,
      location, building, room, cover_image_url,
      clubs!inner(id, name, avatar_url)
    `)
    .in('id', savedIds)
    .lt('event_date', today)
    .order('event_date', { ascending: false })
    .order('start_time', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  if (!rawEvents || rawEvents.length === 0) return [];
  return enrichSavedEvents(rawEvents as any[], userId);
}

// ─── Prop / Callback interfaces for Cursor (Step 2) ──────────────────────────
//
// SavedEventsScreenProps (apps/mobile/app/saved-events/index.tsx):
//   upcomingSections: CalendarSection[]     — from getSavedEventsUpcoming
//   pastEvents:       CalendarEvent[]       — from getSavedEventsPast
//   isLoadingUpcoming: boolean
//   isLoadingPast:     boolean
//   onUnsave: (eventId: string) => Promise<void>  — calls toggleSaveEvent from eventService
//   onEventPress: (eventId: string) => void
//   onLoadMorePast: () => void
