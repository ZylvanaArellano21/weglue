"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { todayInAppTz } from "../datetime";
import { invalidateEventState } from "./eventSync";
import {
  bucketCalendarEvents,
  type CalendarEvent,
  type CalendarSection,
} from "./useCalendar";
import type { AttendeePreview } from "./useHomeEventsFeed";

// Web port of apps/mobile/services/savedEventsService.ts + hooks/useSavedEvents.ts.
// Saved Events is independent of RSVP/attendance — it lists the user's saved_events
// rows, split into upcoming (bucketed) and past, exactly like mobile.

const EVENT_COLS = `
  id, title, emoji, event_date, start_time, end_time,
  location, building, room, cover_image_url,
  clubs!inner(id, name, avatar_url)
`;

async function enrichSaved(rawEvents: any[], userId: string): Promise<CalendarEvent[]> {
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

async function savedEventIds(userId: string): Promise<string[]> {
  const supabase = getSupabaseBrowser();
  const { data } = await supabase.from("saved_events").select("event_id").eq("user_id", userId);
  return ((data ?? []) as any[]).map((r) => r.event_id);
}

export interface SavedEventsData {
  upcoming: CalendarSection[];
  past: CalendarEvent[];
}

export function useSavedEvents(userId: string | undefined) {
  return useQuery({
    queryKey: ["savedEventsUpcoming", userId],
    queryFn: async (): Promise<SavedEventsData> => {
      const supabase = getSupabaseBrowser();
      const today = todayInAppTz();
      const ids = await savedEventIds(userId!);
      if (ids.length === 0) return { upcoming: [], past: [] };

      const [{ data: upcomingRaw }, { data: pastRaw }] = await Promise.all([
        supabase
          .from("events")
          .select(EVENT_COLS)
          .in("id", ids)
          .gte("event_date", today)
          .order("event_date", { ascending: true })
          .order("start_time", { ascending: true }),
        supabase
          .from("events")
          .select(EVENT_COLS)
          .in("id", ids)
          .lt("event_date", today)
          .order("event_date", { ascending: false })
          .order("start_time", { ascending: false })
          .limit(40),
      ]);

      const [upcomingEnriched, pastEnriched] = await Promise.all([
        enrichSaved((upcomingRaw ?? []) as any[], userId!),
        enrichSaved((pastRaw ?? []) as any[], userId!),
      ]);

      return { upcoming: bucketCalendarEvents(upcomingEnriched, today), past: pastEnriched };
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

async function toggleSaveEvent(userId: string, eventId: string): Promise<boolean> {
  const supabase = getSupabaseBrowser();
  const { data: existing } = await supabase
    .from("saved_events")
    .select("id")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (existing) {
    await supabase.from("saved_events").delete().eq("user_id", userId).eq("event_id", eventId);
    return false;
  }
  await supabase.from("saved_events").insert({ user_id: userId, event_id: eventId });
  return true;
}

export function useUnsaveEvent(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => toggleSaveEvent(userId!, eventId),
    onSuccess: () => invalidateEventState(queryClient, userId),
  });
}
