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
      const { data: me } = await supabase.from("profiles").select("university").eq("id", userId!).single();
      let q = supabase
        .from("profiles")
        .select("id, username, full_name, avatar_url")
        .neq("id", userId!)
        .ilike("username", `%${query}%`)
        .limit(10);
      if ((me as any)?.university) q = q.eq("university", (me as any).university);
      const { data } = await q;
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
