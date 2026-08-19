"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";

export interface EventAttendee {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  is_following: boolean;
  /** Mutual follow — same derivation as the Home Posts feed's relationship
   * pill (is_following && follows_me), since there is no dedicated
   * "gluemate" RPC on web. */
  is_gluemate: boolean;
}

/** Uses event_rsvps visibility RLS, so attendees who hide events remain hidden
 * exactly as they are on mobile. Follow-state (is_following/is_gluemate)
 * mirrors apps/mobile/app/home/attendees.tsx's Follow/Gluemate pill, using
 * the same batch follows-table pattern already established in
 * useHomePostsFeed. */
export function useEventAttendees(eventId: string | undefined, viewerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["eventAttendees", eventId, viewerId],
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

      const [{ data, error }, { data: followedRows }, { data: followerRows }] = await Promise.all([
        supabase
          .from("event_rsvps")
          .select("user_id, profiles!inner(id, username, full_name, avatar_url)")
          .eq("event_id", eventId!)
          .eq("status", "going")
          .order("created_at", { ascending: true }),
        viewerId
          ? supabase.from("follows").select("following_id").eq("follower_id", viewerId).eq("status", "accepted")
          : Promise.resolve({ data: [] as { following_id: string }[] }),
        viewerId
          ? supabase.from("follows").select("follower_id").eq("following_id", viewerId).eq("status", "accepted")
          : Promise.resolve({ data: [] as { follower_id: string }[] }),
      ]);
      if (error) throw error;

      const followedSet = new Set((followedRows ?? []).map((r: any) => r.following_id));
      const followerSet = new Set((followerRows ?? []).map((r: any) => r.follower_id));

      const seen = new Set<string>();
      return ((data ?? []) as any[]).flatMap((row) => {
        const person = row.profiles;
        if (!person || seen.has(person.id)) return [];
        seen.add(person.id);
        const isFollowing = followedSet.has(person.id);
        const followsMe = followerSet.has(person.id);
        return [{
          id: person.id,
          username: person.username,
          full_name: person.full_name ?? null,
          avatar_url: person.avatar_url ?? null,
          is_following: isFollowing,
          is_gluemate: isFollowing && followsMe,
        }];
      });
    },
    enabled: !!eventId && enabled,
    staleTime: 30 * 1000,
  });
}
