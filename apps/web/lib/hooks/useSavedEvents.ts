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
  id, title, emoji, event_date, start_time, end_time, event_end_at, visibility,
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
    event_end_at: e.event_end_at,
    visibility: (e.visibility ?? "everyone") as CalendarEvent["visibility"],
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

/** A small canonical query for the Home sidebar.  It reads saved_events itself
 * rather than deriving the number from the currently loaded (and paginated)
 * Saved Events screen. */
export function useSavedEventsCount(userId: string | undefined) {
  return useQuery({
    queryKey: ["savedEventsCount", userId],
    queryFn: async (): Promise<number> => {
      const supabase = getSupabaseBrowser();
      const { count, error } = await supabase
        .from("saved_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId!);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
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
          .gt("event_end_at", new Date().toISOString())
          .order("event_end_at", { ascending: true }),
        supabase
          .from("events")
          .select(EVENT_COLS)
          .in("id", ids)
          .lte("event_end_at", new Date().toISOString())
          .order("event_end_at", { ascending: false })
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

// This screen only ever removes a save; explicit desired-state so a retry is an
// idempotent no-op, and the delete is error-checked (a rejected unsave must not
// report success).
async function unsaveEvent(userId: string, eventId: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase
    .from("saved_events")
    .delete()
    .eq("user_id", userId)
    .eq("event_id", eventId);
  if (error) throw error;
}

export function useUnsaveEvent(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => unsaveEvent(userId!, eventId),
    onMutate: (eventId) => {
      queryClient.setQueriesData({ queryKey: ["savedEventsCount", userId] }, (count: number | undefined) =>
        typeof count === "number" ? Math.max(0, count - 1) : count
      );
      return { eventId };
    },
    onError: () => invalidateEventState(queryClient, userId),
    onSuccess: () => invalidateEventState(queryClient, userId),
  });
}
