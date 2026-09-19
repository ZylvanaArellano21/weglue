"use client";

import { getSupabaseBrowser } from "../supabase-browser";
import {
  currentWeekRange,
  isEventPast,
  isEventPastAt,
  parseMeetingSchedule,
  todayInAppTz,
  type MeetingSlot,
} from "../datetime";

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

export interface SidebarClub {
  id: string;
  name: string;
  handle: string;
  avatar_url: string | null;
  officer_role: string | null;
  /** The next event still to come THIS Monday–Sunday week, if there is one. */
  next_event: SidebarNextEvent | null;
  /** The club's recurring meeting slots — shown when next_event is null. */
  meeting_schedule: MeetingSlot[];
  meeting_building: string | null;
  meeting_room: string | null;
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
      "club_id, role, joined_at, clubs!inner(id, name, handle, avatar_url, meeting_schedule, meeting_day, meeting_time_start, meeting_time_end, meeting_building, meeting_room, is_active)"
    )
    .eq("user_id", userId)
    .eq("clubs.is_active", true)
    .order("joined_at", { ascending: false })
    .limit(PAGE_SIZE);

  const clubIds = ((memberships ?? []) as any[]).map((m) => m.club_id);

  // The sidebar's event line is scoped to the CURRENT Monday–Sunday week — not
  // a rolling "next 7 days", which used to spill next week's events into this
  // week's row. Within that window we take the next event that has not ended
  // yet, so once an event finishes the following one takes over automatically.
  const nextEvents: Record<string, SidebarNextEvent> = {};
  if (clubIds.length > 0) {
    const now = new Date();
    const today = todayInAppTz(); // events earlier in the week are already over
    const { end: weekEnd } = currentWeekRange(now);

    const { data: events } = await supabase
      .from("events")
      .select("id, club_id, title, emoji, event_date, start_time, end_time, event_end_at")
      .in("club_id", clubIds)
      .gte("event_date", today)
      .lte("event_date", weekEnd)
      .order("event_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(PAGE_SIZE * 5);

    (events ?? []).forEach((e: any) => {
      if (nextEvents[e.club_id]) return;
      const hasEnded = e.event_end_at
        ? isEventPastAt(e.event_end_at, now)
        : isEventPast(e.event_date, e.end_time, now);
      if (hasEnded) return;
      nextEvents[e.club_id] = {
        id: e.id,
        title: e.title,
        emoji: e.emoji,
        event_date: e.event_date,
        start_time: e.start_time,
      };
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
      // Multi-day clubs live in the meeting_schedule jsonb (033); the legacy
      // single-day columns remain the fallback for clubs never migrated.
      meeting_schedule: parseMeetingSchedule(
        c.meeting_schedule,
        c.meeting_day,
        c.meeting_time_start,
        c.meeting_time_end
      ),
      meeting_building: c.meeting_building ?? null,
      meeting_room: c.meeting_room ?? null,
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
