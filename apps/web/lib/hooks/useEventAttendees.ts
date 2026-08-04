"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";

export interface EventAttendee {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
}

/** Uses event_rsvps visibility RLS, so attendees who hide events remain hidden
 * exactly as they are on mobile. */
export function useEventAttendees(eventId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["eventAttendees", eventId],
    queryFn: async (): Promise<EventAttendee[]> => {
      const supabase = getSupabaseBrowser();
      // Check the event row first. An empty RSVP list and an unauthorized
      // direct attendees URL are different states; the latter must resolve to
      // a safe unavailable error rather than a misleading "No one" list.
      const { data: event, error: eventError } = await supabase
        .from("events")
        .select("id")
        .eq("id", eventId!)
        .maybeSingle();
      if (eventError) throw eventError;
      if (!event) throw new Error("event_unavailable");
      const { data, error } = await supabase
        .from("event_rsvps")
        .select("user_id, profiles!inner(id, username, full_name, avatar_url)")
        .eq("event_id", eventId!)
        .eq("status", "going")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const seen = new Set<string>();
      return ((data ?? []) as any[]).flatMap((row) => {
        const person = row.profiles;
        if (!person || seen.has(person.id)) return [];
        seen.add(person.id);
        return [{ id: person.id, username: person.username, full_name: person.full_name ?? null, avatar_url: person.avatar_url ?? null }];
      });
    },
    enabled: !!eventId && enabled,
    staleTime: 30 * 1000,
  });
}
