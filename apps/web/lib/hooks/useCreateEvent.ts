"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { uploadToBucket } from "../imageUpload";
import { invalidateEventState } from "./eventSync";
import type { TagClub } from "./useCreatePost";

// Web port of the New Event flow (apps/mobile/app/home/new-event.tsx +
// eventService.createEvent). Event creation is officer-ONLY: the host dropdown
// only lists clubs where the user is an officer, and createEvent re-checks that
// server-side — so a non-officer can't create an event by manipulating the UI
// or the request (RLS on events is the ultimate backstop).

export type Visibility = "everyone" | "members" | "specific";

/** Clubs where the signed-in user is an officer (the only valid event hosts). */
export function useOfficerClubs(userId: string | undefined) {
  return useQuery({
    queryKey: ["officerClubs", userId],
    queryFn: async (): Promise<TagClub[]> => {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase
        .from("club_members")
        .select("clubs!inner(id, name, avatar_url)")
        .eq("user_id", userId!)
        .eq("role", "officer");
      return ((data ?? []) as any[]).map((m) => ({
        id: m.clubs.id,
        name: m.clubs.name,
        avatar_url: m.clubs.avatar_url,
      }));
    },
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

/** Search members of the viewer's campus (for restricted "specific" audiences). */
export function useMemberSearch(userId: string | undefined, query: string) {
  return useQuery({
    queryKey: ["memberSearch", userId, query],
    queryFn: async () => {
      const supabase = getSupabaseBrowser();
      // Migration 057 moved people search behind a SECURITY DEFINER RPC. Two
      // reasons, both load-bearing:
      //
      //  1. CORRECTNESS — search_students() excludes blocked students in BOTH
      //     directions, using auth.uid() rather than anything the browser sends.
      //  2. PERFORMANCE — ILIKE (texticlike) is not leakproof, so once profiles
      //     carries a real RLS policy the table becomes a security barrier and
      //     PostgreSQL can no longer push an ILIKE down to the trigram indexes.
      //     Measured on a 200k-profile shadow database, a typeahead fragment
      //     matching nothing cost 81.7 ms as a client-side query (Seq Scan) vs
      //     2.9 ms through this RPC.
      //
      // Same-campus scoping is applied inside the function, so the separate
      // `profiles.university` lookup this replaced is no longer needed.
      const { data, error } = await supabase.rpc("search_students", {
        p_query: query,
        p_limit: 10,
      });
      if (error) throw error;
      return (data ?? []) as { id: string; username: string; full_name: string; avatar_url: string | null }[];
    },
    enabled: !!userId && query.trim().length > 0,
    staleTime: 30 * 1000,
  });
}

export interface CreateEventInput {
  file: File;
  club_id: string;
  title: string;
  description: string;
  event_date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  building: string;
  room: string;
  visibility: Visibility;
  specific_user_ids: string[];
}

async function createEvent(userId: string, input: CreateEventInput): Promise<string> {
  const supabase = getSupabaseBrowser();

  // Defence-in-depth officer check (RLS also enforces this server-side).
  const { data: officer } = await supabase
    .from("club_members")
    .select("id")
    .eq("club_id", input.club_id)
    .eq("user_id", userId)
    .eq("role", "officer")
    .maybeSingle();
  if (!officer) throw new Error("Only club officers can create events");

  const coverUrl = await uploadToBucket("posts", `${userId}/events/${Date.now()}.jpg`, input.file);

  const { data: event, error } = await supabase
    .from("events")
    .insert({
      club_id: input.club_id,
      created_by: userId,
      title: input.title,
      description: input.description,
      cover_image_url: coverUrl,
      event_date: input.event_date,
      start_time: `${input.start_time}:00`,
      end_time: `${input.end_time}:00`,
      building: input.building,
      room: input.room,
      visibility: input.visibility,
      specific_user_ids:
        input.visibility === "specific" && input.specific_user_ids.length
          ? input.specific_user_ids
          : null,
    })
    .select("id")
    .single();
  if (error || !event) throw error ?? new Error("Failed to create event");
  return (event as any).id;
}

export function useCreateEvent(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) => createEvent(userId!, input),
    onSuccess: () => invalidateEventState(queryClient, userId),
  });
}

// ─── Edit existing event (officers only) ─────────────────────────────────────
// Web port of eventService.getEventForEdit + updateEvent. A partial UPDATE that
// touches only the officer's changed fields, so it never resets untouched data
// and never disturbs existing RSVPs/saves. The events UPDATE trigger
// (trg_event_updated_notify, migration 046) fires the same event_updated
// notifications to going RSVPs on date/time/location changes — identical to
// mobile. Officer authorization is re-checked here AND by the events RLS.

export interface EventForEdit {
  id: string;
  club_id: string;
  club_name: string;
  title: string;
  emoji: string | null;
  description: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  building: string | null;
  room: string | null;
  visibility: Visibility;
  specific_user_ids: string[];
  specific_members: { id: string; username: string; full_name: string; avatar_url: string | null }[];
}

export function useEventForEdit(eventId: string | undefined) {
  return useQuery({
    queryKey: ["eventForEdit", eventId],
    queryFn: async (): Promise<EventForEdit | null> => {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase
        .from("events")
        .select(
          `id, club_id, title, emoji, description, cover_image_url, event_date,
           start_time, end_time, building, room, visibility, specific_user_ids,
           clubs!inner(name)`
        )
        .eq("id", eventId!)
        .maybeSingle();
      if (error || !data) return null;
      const e = data as any;
      const ids: string[] = e.specific_user_ids ?? [];
      let specific_members: EventForEdit["specific_members"] = [];
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, username, full_name, avatar_url")
          .in("id", ids);
        specific_members = (profs ?? []) as any[];
      }
      return {
        id: e.id,
        club_id: e.club_id,
        club_name: e.clubs?.name ?? "",
        title: e.title,
        emoji: e.emoji,
        description: e.description,
        cover_image_url: e.cover_image_url,
        event_date: e.event_date,
        start_time: e.start_time,
        end_time: e.end_time,
        building: e.building,
        room: e.room,
        visibility: (e.visibility ?? "everyone") as Visibility,
        specific_user_ids: ids,
        specific_members,
      };
    },
    enabled: !!eventId,
    staleTime: 0,
  });
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  cover_image_url?: string | null;
  event_date?: string;
  start_time?: string; // HH:MM(:SS)
  end_time?: string;
  building?: string | null;
  room?: string | null;
  visibility?: Visibility;
  specific_user_ids?: string[] | null;
}

async function updateEvent(userId: string, eventId: string, updates: UpdateEventInput): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { data: eventRow } = await supabase.from("events").select("club_id").eq("id", eventId).maybeSingle();
  if (!eventRow) throw new Error("Event not found");

  const { data: officer } = await supabase
    .from("club_members")
    .select("id")
    .eq("club_id", (eventRow as any).club_id)
    .eq("user_id", userId)
    .eq("role", "officer")
    .maybeSingle();
  if (!officer) throw new Error("Only club officers can edit events");

  const { error } = await supabase.from("events").update(updates).eq("id", eventId);
  if (error) throw error;
}

export function useUpdateEvent(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, updates }: { eventId: string; updates: UpdateEventInput }) =>
      updateEvent(userId!, eventId, updates),
    onSuccess: () => {
      invalidateEventState(queryClient, userId);
      void queryClient.invalidateQueries({ queryKey: ["eventForEdit"] });
    },
  });
}
