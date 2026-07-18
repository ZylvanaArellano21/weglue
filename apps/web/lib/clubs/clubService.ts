"use client";

import { getSupabaseBrowser } from "../supabase-browser";
import { todayInAppTz } from "../datetime";

// Web port of apps/mobile/services/clubTabService.ts + clubService.ts +
// searchService.ts. Every query reads the SAME tables/RPCs mobile reads so web
// and mobile can never disagree about membership, roles, catalog ranking, or
// club content. RLS enforces all visibility server-side.

// ─── Sidebar: my clubs (Officer / Member sections) ──────────────────────────

export interface SidebarNextEvent {
  id: string;
  title: string;
  emoji: string | null;
  event_date: string;
  start_time: string;
}

export interface SidebarMeetingSchedule {
  day: string;
  time_start: string | null;
  time_end: string | null;
  location: string | null;
  building: string | null;
  room: string | null;
}

export interface SidebarClub {
  id: string;
  name: string;
  handle: string;
  avatar_url: string | null;
  officer_role: string | null;
  next_event: SidebarNextEvent | null;
  meeting_schedule: SidebarMeetingSchedule | null;
}

export interface MyClubs {
  officer_clubs: SidebarClub[];
  member_clubs: SidebarClub[];
}

export async function getMyClubs(userId: string): Promise<MyClubs> {
  const supabase = getSupabaseBrowser();
  const PAGE_SIZE = 40;

  const { data: memberships } = await supabase
    .from("club_members")
    .select(
      "club_id, role, joined_at, clubs!inner(id, name, handle, avatar_url, meeting_day, meeting_time_start, meeting_time_end, meeting_location, meeting_building, meeting_room, is_active)"
    )
    .eq("user_id", userId)
    .eq("clubs.is_active", true)
    .order("joined_at", { ascending: false })
    .limit(PAGE_SIZE);

  const clubIds = ((memberships ?? []) as any[]).map((m) => m.club_id);

  const nextEvents: Record<string, SidebarNextEvent> = {};
  if (clubIds.length > 0) {
    const today = todayInAppTz();
    const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const { data: events } = await supabase
      .from("events")
      .select("id, club_id, title, emoji, event_date, start_time")
      .in("club_id", clubIds)
      .gte("event_date", today)
      .lte("event_date", weekEnd)
      .order("event_date", { ascending: true });

    (events ?? []).forEach((e: any) => {
      if (!nextEvents[e.club_id]) {
        nextEvents[e.club_id] = {
          id: e.id,
          title: e.title,
          emoji: e.emoji,
          event_date: e.event_date,
          start_time: e.start_time,
        };
      }
    });
  }

  // Officer role titles for the clubs where the viewer is an officer.
  const officerMembershipIds = ((memberships ?? []) as any[])
    .filter((m) => m.role === "officer")
    .map((m) => m.club_id);

  const roleByClub: Record<string, string | null> = {};
  if (officerMembershipIds.length > 0) {
    const { data: officerRows } = await supabase
      .from("club_officers")
      .select("club_id, role_title")
      .eq("user_id", userId)
      .in("club_id", officerMembershipIds);
    (officerRows ?? []).forEach((r: any) => {
      roleByClub[r.club_id] = r.role_title ?? null;
    });
  }

  const officerClubs: SidebarClub[] = [];
  const memberClubs: SidebarClub[] = [];

  for (const m of (memberships ?? []) as any[]) {
    const c = m.clubs;
    const item: SidebarClub = {
      id: c.id,
      name: c.name,
      handle: c.handle,
      avatar_url: c.avatar_url,
      officer_role: null,
      next_event: nextEvents[m.club_id] ?? null,
      meeting_schedule: c.meeting_day
        ? {
            day: c.meeting_day,
            time_start: c.meeting_time_start,
            time_end: c.meeting_time_end,
            location: c.meeting_location,
            building: c.meeting_building,
            room: c.meeting_room,
          }
        : null,
    };

    if (m.role === "officer") {
      item.officer_role = roleByClub[c.id] ?? "Officer";
      officerClubs.push(item);
    } else {
      memberClubs.push(item);
    }
  }

  return { officer_clubs: officerClubs, member_clubs: memberClubs };
}

// ─── Catalog: Suggested for you / Popular at your school ─────────────────────
// Both come from the SAME get_discovery_clubs RPC mobile uses. With category
// NULL the RPC orders by interest-overlap (personalized) — that IS "Suggested
// for you". "Popular at your school" is the same catalog re-sorted by real
// member_count. Single-campus mode means every club belongs to the one launch
// campus, so the whole catalog is genuinely "your school".

export interface CatalogClub {
  id: string;
  name: string;
  avatar_url: string | null;
  cover_image_url: string | null;
  member_count: number;
  is_member: boolean;
  categories: string[];
  meeting_day: string | null;
  meeting_time_start: string | null;
  meeting_time_end: string | null;
  meeting_building: string | null;
  meeting_room: string | null;
}

export async function getDiscoveryClubs(userId: string): Promise<CatalogClub[]> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("get_discovery_clubs", {
    p_user_id: userId,
    p_category: null,
    p_limit: 60,
    p_offset: 0,
  });
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    name: row.name,
    avatar_url: row.avatar_url ?? null,
    cover_image_url: row.cover_image_url ?? null,
    member_count: row.member_count ?? 0,
    is_member: row.is_member ?? false,
    categories: row.categories ?? [],
    meeting_day: row.meeting_day ?? null,
    meeting_time_start: row.meeting_time_start ?? null,
    meeting_time_end: row.meeting_time_end ?? null,
    meeting_building: row.meeting_building ?? null,
    meeting_room: row.meeting_room ?? null,
  }));
}
