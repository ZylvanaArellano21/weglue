"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { todayInAppTz, isEventPast } from "../datetime";
import { invalidateEventState } from "./eventSync";

// Web port of apps/mobile/services/eventService.ts (getHomeEventsFeed,
// rsvpToEvent, toggleSaveEvent) + apps/mobile/hooks/useHomeEventsFeed.ts.
// Same tables, same visibility gate (mirrors the events RLS from migration
// 029), same tiering ("Your Clubs" first, then "Recommended for You" with
// activity-matched events floated to the top). Web reads the SAME rows mobile
// does, so an RSVP/save/join on either platform is reflected on both.

export type EventTier = "your_clubs" | "recommended";

export interface AttendeePreview {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface HomeFeedEvent {
  id: string;
  club_id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  building: string | null;
  room: string | null;
  activity_tags: string[];
  interest_tags: string[];
  club: { id: string; name: string; logo_url: string | null };
  attendee_count: number;
  attendee_preview: AttendeePreview[];
  user_rsvp_status: "going" | "cant" | null;
  is_saved: boolean;
  is_today: boolean;
  user_has_joined_club: boolean;
  tier: EventTier;
}

export interface HomeEventsFeedSection {
  label: string;
  data: HomeFeedEvent[];
}

export interface HomeEventsFeedPage {
  sections: HomeEventsFeedSection[];
  hasMore: boolean;
}

const EVENTS_PAGE_SIZE = 20;

async function getHomeEventsFeed(
  userId: string,
  page = 0
): Promise<HomeEventsFeedPage> {
  const supabase = getSupabaseBrowser();
  const today = todayInAppTz();
  const offset = page * EVENTS_PAGE_SIZE;

  const [
    { data: memberships },
    { data: userActivities },
    { data: savedEvents },
    { data: userRsvps },
  ] = await Promise.all([
    supabase.from("club_members").select("club_id, role").eq("user_id", userId),
    supabase.from("user_activities").select("activity").eq("user_id", userId),
    supabase.from("saved_events").select("event_id").eq("user_id", userId),
    supabase.from("event_rsvps").select("event_id, status").eq("user_id", userId),
  ]);

  const joinedClubIds = new Set((memberships ?? []).map((m: any) => m.club_id));
  const officerClubIds = new Set(
    (memberships ?? [])
      .filter((m: any) => m.role === "officer")
      .map((m: any) => m.club_id)
  );
  const userActivitySet = new Set((userActivities ?? []).map((a: any) => a.activity));
  const savedSet = new Set((savedEvents ?? []).map((s: any) => s.event_id));
  const rsvpMap = new Map<string, "going" | "cant">(
    (userRsvps ?? []).map((r: any) => [r.event_id, r.status as "going" | "cant"])
  );

  const { data: rawEvents, error } = await supabase
    .from("events")
    .select(
      `
      id, title, description, cover_image_url, event_date, start_time, end_time,
      location, building, room, club_id, created_by, visibility, specific_user_ids,
      clubs!inner(id, name, avatar_url),
      event_interests(interest),
      event_activities(activity)
    `
    )
    .gte("event_date", today)
    .order("event_date", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + EVENTS_PAGE_SIZE - 1);

  if (error || !rawEvents) return { sections: [], hasMore: false };

  const eventIds = (rawEvents as any[]).map((e) => e.id);

  const { data: goingRsvps } = await supabase
    .from("event_rsvps")
    .select("event_id, user_id, profiles!inner(id, username, avatar_url)")
    .in("event_id", eventIds)
    .eq("status", "going");

  const attendeeCountMap = new Map<string, number>();
  const attendeePreviewMap = new Map<string, AttendeePreview[]>();

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

  const yourClubs: HomeFeedEvent[] = [];
  const recommendedMatched: HomeFeedEvent[] = [];
  const recommendedOther: HomeFeedEvent[] = [];

  for (const e of rawEvents as any[]) {
    const visibility = e.visibility as "everyone" | "members" | "specific";
    const specificIds: string[] = e.specific_user_ids ?? [];
    const isInJoinedClub = joinedClubIds.has(e.club_id);
    const isOfficerOfClub = officerClubIds.has(e.club_id);
    const isCreator = e.created_by === userId;

    if (visibility === "members" && !isInJoinedClub && !isOfficerOfClub && !isCreator) {
      continue;
    }
    if (visibility === "specific" && !isCreator && !isOfficerOfClub && !specificIds.includes(userId)) {
      continue;
    }

    const activityTags: string[] = (e.event_activities ?? []).map((a: any) => a.activity);
    const interestTags: string[] = (e.event_interests ?? []).map((i: any) => i.interest);

    const event: HomeFeedEvent = {
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
      activity_tags: activityTags,
      interest_tags: interestTags,
      club: { id: e.clubs.id, name: e.clubs.name, logo_url: e.clubs.avatar_url },
      attendee_count: attendeeCountMap.get(e.id) ?? 0,
      attendee_preview: attendeePreviewMap.get(e.id) ?? [],
      user_rsvp_status: rsvpMap.get(e.id) ?? null,
      is_saved: savedSet.has(e.id),
      is_today: e.event_date === today,
      user_has_joined_club: isInJoinedClub,
      tier: isInJoinedClub ? "your_clubs" : "recommended",
    };

    if (isInJoinedClub) {
      yourClubs.push(event);
    } else {
      const hasOverlap = activityTags.some((t) => userActivitySet.has(t));
      if (hasOverlap) recommendedMatched.push(event);
      else recommendedOther.push(event);
    }
  }

  const recommended = [...recommendedMatched, ...recommendedOther];

  const sections: HomeEventsFeedSection[] = [];
  if (yourClubs.length > 0) sections.push({ label: "Your Clubs", data: yourClubs });
  if (recommended.length > 0)
    sections.push({ label: "Recommended for You", data: recommended });

  return { sections, hasMore: (rawEvents as any[]).length === EVENTS_PAGE_SIZE };
}

/** Merge same-label sections across pages, in first-seen order. */
export function mergeEventFeedPages(
  pages: HomeEventsFeedPage[]
): HomeEventsFeedSection[] {
  const order: string[] = [];
  const byLabel = new Map<string, HomeEventsFeedSection>();
  for (const page of pages) {
    for (const section of page.sections) {
      const existing = byLabel.get(section.label);
      if (existing) existing.data = existing.data.concat(section.data);
      else {
        byLabel.set(section.label, { label: section.label, data: [...section.data] });
        order.push(section.label);
      }
    }
  }
  return order.map((label) => byLabel.get(label)!);
}

export function useHomeEventsFeed(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["homeEventsFeed", userId],
    queryFn: ({ pageParam }) => getHomeEventsFeed(userId!, pageParam),
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length : undefined,
    initialPageParam: 0,
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

// ─── RSVP ────────────────────────────────────────────────────────────────────

async function rsvpToEvent(
  userId: string,
  eventId: string,
  status: "going" | "cant"
): Promise<void> {
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

export function useRsvpToEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      eventId,
      status,
    }: {
      userId: string;
      eventId: string;
      status: "going" | "cant";
    }) => rsvpToEvent(userId, eventId, status),
    onSuccess: (_data, { userId }) => invalidateEventState(queryClient, userId),
  });
}

// ─── Save / unsave ───────────────────────────────────────────────────────────

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

export function useToggleSaveEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, eventId }: { userId: string; eventId: string }) =>
      toggleSaveEvent(userId, eventId),
    onSuccess: (_saved, { userId }) => invalidateEventState(queryClient, userId),
  });
}
