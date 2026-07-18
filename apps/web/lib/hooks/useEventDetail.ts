"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { isEventPast } from "../datetime";
import { invalidateEventState } from "./eventSync";
import type { AttendeePreview } from "./useHomeEventsFeed";

// Web port of apps/mobile/services/eventService.ts::getEventDetail +
// hooks/useEventDetail.ts. Same rows, same shape — the overlay stays in sync
// with the feed, calendar, upcoming and saved lists (and mobile).

export interface EventDetail {
  id: string;
  club_id: string;
  title: string;
  emoji: string | null;
  description: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  building: string | null;
  room: string | null;
  visibility: "everyone" | "members" | "specific";
  club: { id: string; name: string; avatar_url: string | null };
  attendee_count: number;
  attendee_preview: AttendeePreview[];
  user_rsvp_status: "going" | "cant" | null;
  is_saved: boolean;
  user_has_joined_club: boolean;
}

async function getEventDetail(eventId: string, userId: string): Promise<EventDetail | null> {
  const supabase = getSupabaseBrowser();
  const [{ data: event }, { data: savedRow }, { data: rsvpRow }] = await Promise.all([
    supabase
      .from("events")
      .select(
        `id, club_id, title, emoji, description, cover_image_url,
         event_date, start_time, end_time, location, building, room, visibility,
         clubs!inner(id, name, avatar_url)`
      )
      .eq("id", eventId)
      .maybeSingle(),
    supabase.from("saved_events").select("id").eq("user_id", userId).eq("event_id", eventId).maybeSingle(),
    supabase.from("event_rsvps").select("status").eq("user_id", userId).eq("event_id", eventId).maybeSingle(),
  ]);

  if (!event) return null;
  const e = event as any;

  const [{ data: goingRsvps }, { data: memberCheck }] = await Promise.all([
    supabase
      .from("event_rsvps")
      .select("user_id, profiles!inner(id, username, avatar_url)")
      .eq("event_id", eventId)
      .eq("status", "going"),
    supabase.from("club_members").select("id").eq("club_id", e.club_id).eq("user_id", userId).maybeSingle(),
  ]);

  const previews: AttendeePreview[] = ((goingRsvps ?? []) as any[])
    .slice(0, 4)
    .map((r) => ({ id: r.profiles.id, username: r.profiles.username, avatar_url: r.profiles.avatar_url }));

  return {
    id: e.id,
    club_id: e.club_id,
    title: e.title,
    emoji: e.emoji,
    description: e.description,
    cover_image_url: e.cover_image_url,
    event_date: e.event_date,
    start_time: e.start_time,
    end_time: e.end_time,
    location: e.location,
    building: e.building,
    room: e.room,
    visibility: (e.visibility ?? "everyone") as EventDetail["visibility"],
    club: { id: e.clubs.id, name: e.clubs.name, avatar_url: e.clubs.avatar_url ?? null },
    attendee_count: (goingRsvps ?? []).length,
    attendee_preview: previews,
    user_rsvp_status: ((rsvpRow as any)?.status as "going" | "cant" | null) ?? null,
    is_saved: !!savedRow,
    user_has_joined_club: !!memberCheck,
  };
}

export function useEventDetail(eventId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["eventDetail", eventId, userId],
    queryFn: () => getEventDetail(eventId!, userId!),
    enabled: !!eventId && !!userId,
    staleTime: 60 * 1000,
  });
}

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

export function useRsvpMutation(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, status }: { eventId: string; status: "going" | "cant" }) =>
      rsvpToEvent(userId!, eventId, status),
    onSuccess: () => invalidateEventState(queryClient, userId),
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

export function useSaveEventMutation(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => toggleSaveEvent(userId!, eventId),
    onSuccess: () => invalidateEventState(queryClient, userId),
  });
}
