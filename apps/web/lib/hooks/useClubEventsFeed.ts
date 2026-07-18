"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { splitPastAndUpcoming } from "../datetime";
import type { HomeFeedEvent, AttendeePreview } from "./useHomeEventsFeed";

// Club-scoped events feed for the Club Profile Home tab. Returns the SAME rich
// HomeFeedEvent shape the Home feed uses (attendees, going count, rsvp, saved,
// joined-club) so the existing EventCard renders identically, split into
// upcoming vs past by real end datetime. Applies the same members/specific
// visibility gate as the events RLS (migration 029) as defence-in-depth.

export interface ClubEventsFeed {
  upcoming: HomeFeedEvent[];
  past: HomeFeedEvent[];
}

async function getClubEventsFeed(clubId: string, userId: string): Promise<ClubEventsFeed> {
  const supabase = getSupabaseBrowser();

  const [{ data: membership }, { data: savedEvents }, { data: userRsvps }] = await Promise.all([
    supabase
      .from("club_members")
      .select("role")
      .eq("user_id", userId)
      .eq("club_id", clubId)
      .maybeSingle(),
    supabase.from("saved_events").select("event_id").eq("user_id", userId),
    supabase.from("event_rsvps").select("event_id, status").eq("user_id", userId),
  ]);

  const isMember = !!membership;
  const isOfficer = (membership as { role?: string } | null)?.role === "officer";
  const savedSet = new Set((savedEvents ?? []).map((s: any) => s.event_id));
  const rsvpMap = new Map<string, "going" | "cant">(
    (userRsvps ?? []).map((r: any) => [r.event_id, r.status as "going" | "cant"])
  );

  const { data: rawEvents } = await supabase
    .from("events")
    .select(
      `id, title, description, cover_image_url, event_date, start_time, end_time,
       location, building, room, club_id, created_by, visibility, specific_user_ids,
       clubs!inner(id, name, avatar_url),
       event_interests(interest),
       event_activities(activity)`
    )
    .eq("club_id", clubId)
    .order("event_date", { ascending: true });

  const events = (rawEvents ?? []) as any[];
  const eventIds = events.map((e) => e.id);

  const attendeeCountMap = new Map<string, number>();
  const attendeePreviewMap = new Map<string, AttendeePreview[]>();
  if (eventIds.length > 0) {
    const { data: goingRsvps } = await supabase
      .from("event_rsvps")
      .select("event_id, user_id, profiles!inner(id, username, avatar_url)")
      .in("event_id", eventIds)
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
    const specificIds: string[] = e.specific_user_ids ?? [];
    const isCreator = e.created_by === userId;
    if (visibility === "members" && !isMember && !isOfficer && !isCreator) continue;
    if (visibility === "specific" && !isCreator && !isOfficer && !specificIds.includes(userId)) continue;

    mapped.push({
      id: e.id,
      club_id: e.club_id,
      title: e.title,
      description: e.description,
      cover_image_url: e.cover_image_url,
      event_date: e.event_date,
      start_time: e.start_time,
      end_time: e.end_time,
      location: e.location,
      building: e.building,
      room: e.room,
      activity_tags: (e.event_activities ?? []).map((a: any) => a.activity),
      interest_tags: (e.event_interests ?? []).map((i: any) => i.interest),
      club: { id: e.clubs.id, name: e.clubs.name, logo_url: e.clubs.avatar_url },
      attendee_count: attendeeCountMap.get(e.id) ?? 0,
      attendee_preview: attendeePreviewMap.get(e.id) ?? [],
      user_rsvp_status: rsvpMap.get(e.id) ?? null,
      is_saved: savedSet.has(e.id),
      is_today: false,
      user_has_joined_club: isMember,
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
