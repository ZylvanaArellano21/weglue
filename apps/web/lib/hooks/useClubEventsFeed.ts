"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { splitPastAndUpcoming } from "../datetime";
import type { HomeFeedEvent, AttendeePreview } from "./useHomeEventsFeed";

// Club-scoped events feed for the Club Profile Home tab. Returns the SAME rich
// HomeFeedEvent shape the Home feed uses (attendees, going count, rsvp, saved,
// joined-club) so the existing EventCard renders identically, split into
// upcoming vs past by canonical event_end_at. The query is a narrow RPC because
// a club non-member may see a members-only *card* here, but must never receive
// the detail row or attendance payload that normal events RLS protects.

export interface ClubEventsFeed {
  upcoming: HomeFeedEvent[];
  past: HomeFeedEvent[];
}

async function getClubEventsFeed(clubId: string, userId: string): Promise<ClubEventsFeed> {
  const supabase = getSupabaseBrowser();

  const [{ data: membership }, { data: savedEvents }, { data: userRsvps }, { data: club }] = await Promise.all([
    supabase
      .from("club_members")
      .select("role")
      .eq("user_id", userId)
      .eq("club_id", clubId)
      .maybeSingle(),
    supabase.from("saved_events").select("event_id").eq("user_id", userId),
    supabase.from("event_rsvps").select("event_id, status").eq("user_id", userId),
    supabase.from("clubs").select("id, name, avatar_url").eq("id", clubId).maybeSingle(),
  ]);

  const isMember = !!membership;
  const savedSet = new Set((savedEvents ?? []).map((s: any) => s.event_id));
  const rsvpMap = new Map<string, "going" | "cant">(
    (userRsvps ?? []).map((r: any) => [r.event_id, r.status as "going" | "cant"])
  );

  const { data: rawEvents, error } = await supabase.rpc("get_club_profile_events", {
    p_club_id: clubId,
  });
  if (error) throw error;

  const events = (rawEvents ?? []) as any[];
  const openEventIds = events.filter((e) => e.can_open).map((e) => e.id);

  const attendeeCountMap = new Map<string, number>();
  const attendeePreviewMap = new Map<string, AttendeePreview[]>();
  if (openEventIds.length > 0) {
    const { data: goingRsvps } = await supabase
      .from("event_rsvps")
      .select("event_id, user_id, profiles!inner(id, username, avatar_url)")
      .in("event_id", openEventIds)
      .eq("status", "going");
    for (const rsvp of ((goingRsvps as any[]) ?? [])) {
      attendeeCountMap.set(rsvp.event_id, (attendeeCountMap.get(rsvp.event_id) ?? 0) + 1);
      const previews = attendeePreviewMap.get(rsvp.event_id) ?? [];
      if (previews.length < 4) {
        previews.push({
          id: rsvp.profiles.id,
          username: rsvp.profiles.username,
          avatar_url: rsvp.profiles.avatar_url,
        });
        attendeePreviewMap.set(rsvp.event_id, previews);
      }
    }
  }

  const mapped: HomeFeedEvent[] = [];
  for (const e of events) {
    const visibility = e.visibility as "everyone" | "members" | "specific";
    mapped.push({
      id: e.id,
      club_id: e.club_id,
      title: e.title,
      description: e.description,
      cover_image_url: e.cover_image_url,
      event_date: e.event_date,
      start_time: e.start_time,
      end_time: e.end_time,
      event_end_at: e.event_end_at,
      location: e.location,
      building: e.building,
      room: e.room,
      activity_tags: e.activity_tags ?? [],
      interest_tags: e.interest_tags ?? [],
      club: { id: clubId, name: (club as any)?.name ?? "Club", logo_url: (club as any)?.avatar_url ?? null },
      attendee_count: e.can_open ? attendeeCountMap.get(e.id) ?? 0 : 0,
      attendee_preview: e.can_open ? attendeePreviewMap.get(e.id) ?? [] : [],
      user_rsvp_status: rsvpMap.get(e.id) ?? null,
      is_saved: savedSet.has(e.id),
      is_today: false,
      user_has_joined_club: isMember,
      visibility,
      can_open: !!e.can_open,
      can_view_attendees: !!e.can_open,
      tier: "your_clubs",
    });
  }

  return splitPastAndUpcoming(mapped);
}

export const clubEventsFeedKey = (clubId?: string, userId?: string) =>
  ["clubEventsFeed", clubId, userId] as const;

export function useClubEventsFeed(clubId: string | undefined, userId: string | undefined) {
  return useQuery<ClubEventsFeed>({
    queryKey: clubEventsFeedKey(clubId, userId),
    queryFn: () => getClubEventsFeed(clubId!, userId!),
    enabled: !!clubId && !!userId,
    staleTime: 60 * 1000,
  });
}
