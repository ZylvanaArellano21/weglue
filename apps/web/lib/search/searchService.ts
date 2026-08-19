"use client";

import { getSupabaseBrowser } from "../supabase-browser";

// Web port of apps/mobile/services/searchService.ts's browse-mode queries
// (categories, paginated discovery clubs, discovery people). Same RPCs/table
// mobile reads (get_discovery_clubs, get_discovery_people, club_categories),
// so the Search tab can never disagree with mobile about who/what shows up.
// The query-mode search (search_discovery) already has a web port at
// lib/hooks/useDiscoverySearch.ts, reused as-is rather than duplicated here.

export interface SearchDiscoveryClub {
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

export interface SearchDiscoveryPerson {
  user_id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  club_name: string | null;
  club_id: string | null;
}

export async function getDistinctCategories(): Promise<string[]> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.from("club_categories").select("category").order("category");
  if (error) throw error;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of (data ?? []) as { category: string }[]) {
    if (!seen.has(row.category)) {
      seen.add(row.category);
      result.push(row.category);
    }
  }
  return result;
}

export async function getDiscoveryClubsPage(
  userId: string,
  category: string | null,
  page: number,
  pageSize = 20
): Promise<SearchDiscoveryClub[]> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("get_discovery_clubs", {
    p_user_id: userId,
    p_category: category ?? null,
    p_limit: pageSize,
    p_offset: page * pageSize,
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

export async function getDiscoveryPeople(userId: string): Promise<SearchDiscoveryPerson[]> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("get_discovery_people", { p_user_id: userId });
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({
    user_id: row.user_id,
    username: row.username,
    full_name: row.full_name ?? null,
    avatar_url: row.avatar_url ?? null,
    club_name: row.club_name ?? null,
    club_id: row.club_id ?? null,
  }));
}
