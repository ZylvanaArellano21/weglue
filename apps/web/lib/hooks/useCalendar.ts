"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { todayInAppTz, isEventPast } from "../datetime";
import { invalidateEventState } from "./eventSync";
import type { AttendeePreview } from "./useHomeEventsFeed";

// Web port of apps/mobile/services/calendarService.ts + hooks/useCalendar.ts.
// Upcoming Events AND the calendar both derive from the user's 'going' RSVP
// events (today onward) — so they always agree, and they match mobile because
// they read the same event_rsvps + events rows.

export interface CalendarEvent {
  id: string;
  title: string;
  emoji: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  building: string | null;
  room: string | null;
  cover_image_url: string | null;
  club: { id: string; name: string; avatar_url: string | null };
  attendee_count: number;
  attendee_preview: AttendeePreview[];
  user_rsvp_status: "going" | "cant" | null;
  is_saved: boolean;
}

export type CalendarBucketKey =
  | "today"
  | "this_week"
  | "next_week"
  | "this_month"
  | "next_month";

const CALENDAR_BUCKET_LABELS: Record<CalendarBucketKey, string> = {
  today: "Today",
  this_week: "This Week",
  next_week: "Next Week",
  this_month: "This Month",
  next_month: "Next Month",
};

export interface CalendarSection {
  key: CalendarBucketKey;
  label: string;
  data: CalendarEvent[];
}

const EVENT_COLS = `
  id, title, emoji, event_date, start_time, end_time,
  location, building, room, cover_image_url,
  clubs!inner(id, name, avatar_url)
`;

async function enrichWithAttendees(rawEvents: any[], userId: string): Promise<CalendarEvent[]> {
  if (rawEvents.length === 0) return [];
  const supabase = getSupabaseBrowser();
  const ids = rawEvents.map((e) => e.id);

  const [{ data: goingRsvps }, { data: savedRows }, { data: userRsvps }] = await Promise.all([
    supabase
      .from("event_rsvps")
      .select("event_id, profiles!inner(id, username, avatar_url)")
      .in("event_id", ids)
      .eq("status", "going"),
    supabase.from("saved_events").select("event_id").eq("user_id", userId).in("event_id", ids),
    supabase.from("event_rsvps").select("event_id, status").eq("user_id", userId).in("event_id", ids),
  ]);

  const countMap = new Map<string, number>();
  const previewMap = new Map<string, AttendeePreview[]>();
  const savedSet = new Set<string>((savedRows ?? []).map((s: any) => s.event_id));
  const rsvpMap = new Map<string, "going" | "cant">(
    (userRsvps ?? []).map((r: any) => [r.event_id, r.status])
  );

  for (const row of ((goingRsvps as any[]) ?? [])) {
    countMap.set(row.event_id, (countMap.get(row.event_id) ?? 0) + 1);
    const list = previewMap.get(row.event_id) ?? [];
    if (list.length < 4) {
      list.push({ id: row.profiles.id, username: row.profiles.username, avatar_url: row.profiles.avatar_url });
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
    user_rsvp_status: rsvpMap.get(e.id) ?? null,
    is_saved: savedSet.has(e.id),
  }));
}

async function goingEventIds(userId: string): Promise<string[]> {
  const supabase = getSupabaseBrowser();
  const { data } = await supabase
    .from("event_rsvps")
    .select("event_id")
    .eq("user_id", userId)
    .eq("status", "going");
  return ((data ?? []) as any[]).map((r) => r.event_id);
}

export function bucketCalendarEvents(events: CalendarEvent[], todayStr: string): CalendarSection[] {
  const todayMs = new Date(todayStr + "T00:00:00").getTime();
  const buckets: Record<CalendarBucketKey, CalendarEvent[]> = {
    today: [], this_week: [], next_week: [], this_month: [], next_month: [],
  };
  for (const event of events) {
    const eventMs = new Date(event.event_date + "T00:00:00").getTime();
    const dayDiff = Math.round((eventMs - todayMs) / 86_400_000);
    let key: CalendarBucketKey;
    if (dayDiff === 0) key = "today";
    else if (dayDiff <= 7) key = "this_week";
    else if (dayDiff <= 14) key = "next_week";
    else if (dayDiff <= 30) key = "this_month";
    else key = "next_month";
    buckets[key].push(event);
  }
  return (["today", "this_week", "next_week", "this_month", "next_month"] as CalendarBucketKey[])
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: CALENDAR_BUCKET_LABELS[k], data: buckets[k] }));
}

// ─── Upcoming Events / calendar section list (going events, today onward) ────

export function useCalendarSections(userId: string | undefined) {
  return useQuery<CalendarEvent[], Error, CalendarSection[]>({
    queryKey: ["calendarEvents", userId],
    queryFn: async () => {
      const supabase = getSupabaseBrowser();
      const ids = await goingEventIds(userId!);
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from("events")
        .select(EVENT_COLS)
        .in("id", ids)
        .gte("event_date", todayInAppTz())
        .order("event_date", { ascending: true })
        .order("start_time", { ascending: true });
      return enrichWithAttendees((data ?? []) as any[], userId!);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
    select: (events) => bucketCalendarEvents(events, todayInAppTz()),
  });
}

// ─── Month markers (dates in a month with a going RSVP) ──────────────────────

export function useCalendarMonthMarkers(
  userId: string | undefined,
  year: number,
  month: number // 1-indexed
) {
  return useQuery({
    queryKey: ["calendarMonthMarkers", userId, year, month],
    queryFn: async (): Promise<string[]> => {
      const supabase = getSupabaseBrowser();
      const pad = (n: number) => String(n).padStart(2, "0");
      const firstDay = `${year}-${pad(month)}-01`;
      const lastDay = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
      const ids = await goingEventIds(userId!);
      if (ids.length === 0) return [];
      const { data: events } = await supabase
        .from("events")
        .select("event_date")
        .in("id", ids)
        .gte("event_date", firstDay)
        .lte("event_date", lastDay);
      return [...new Set<string>(((events ?? []) as any[]).map((e) => e.event_date))];
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

// ─── Day events (going events on a specific date) ────────────────────────────

export function useCalendarDayEvents(userId: string | undefined, date: string | undefined) {
  return useQuery({
    queryKey: ["calendarDayEvents", userId, date],
    queryFn: async (): Promise<CalendarEvent[]> => {
      const supabase = getSupabaseBrowser();
      const ids = await goingEventIds(userId!);
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from("events")
        .select(EVENT_COLS)
        .in("id", ids)
        .eq("event_date", date!)
        .order("start_time", { ascending: true });
      return enrichWithAttendees((data ?? []) as any[], userId!);
    },
    enabled: !!userId && !!date,
    staleTime: 60 * 1000,
  });
}

// ─── RSVP from calendar (kept in sync with feed/detail via invalidateEventState)

async function rsvpToEvent(userId: string, eventId: string, status: "going" | "cant"): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { data: eventRow } = await supabase
    .from("events")
    .select("event_date, end_time")
    .eq("id", eventId)
    .maybeSingle();
  if (eventRow && isEventPast((eventRow as any).event_date, (eventRow as any).end_time)) {
    throw new Error("This event has ended");
  }
  const { data: existing } = await supabase
    .from("event_rsvps")
    .select("status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if ((existing as any)?.status === status) {
    await supabase.from("event_rsvps").delete().eq("event_id", eventId).eq("user_id", userId);
  } else {
    await supabase
      .from("event_rsvps")
      .upsert({ event_id: eventId, user_id: userId, status }, { onConflict: "event_id,user_id" });
  }
}

export function useCalendarRsvp(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, status }: { eventId: string; status: "going" | "cant" }) =>
      rsvpToEvent(userId!, eventId, status),
    onSuccess: () => invalidateEventState(queryClient, userId),
  });
}
