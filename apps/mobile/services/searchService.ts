import { supabase } from '../lib/supabase';

export interface DiscoveryClub {
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

export interface DiscoveryPerson {
  user_id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  club_name: string | null;
  club_id: string | null;
}

export interface SearchResult {
  result_type: 'person' | 'club';
  id: string;
  name: string;
  avatar_url: string | null;
  sub: string | null;
  is_member: boolean;
}

export async function getDistinctCategories(): Promise<string[]> {
  const { data, error } = await supabase
    .from('club_categories')
    .select('category')
    .order('category');

  if (error) throw error;

  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of (data ?? []) as any[]) {
    if (!seen.has(row.category)) {
      seen.add(row.category);
      result.push(row.category);
    }
  }
  return result;
}

export interface DiscoveryCategory {
  /** Stable interest slug — what the phone Discovery filter passes to the RPC. */
  value: string;
  /** Display label. */
  label: string;
}

// ── Native-phone Discovery (iPhone + Android phone only) ────────────────────
// Reads the club_interests source of truth (both Primary + Secondary tiers) via
// dedicated RPCs, so an Admin Dashboard interest/tier change updates phone
// Discovery with no app release. iPad-native and web keep using
// getDistinctCategories / getDiscoveryClubs above — Option B, unchanged.
//
// The get_phone_discovery_* RPCs ship in migration 126. Until that migration is
// deployed, PostgREST answers with "function not found" (PGRST202 / SQLSTATE
// 42883). That is NOT a client error to surface — we fall back to the legacy
// discovery functions so the tab keeps working. This does NOT restore the
// interest categories before the migration (club_categories is already empty in
// production); it only stops the branch from crashing/rejecting the query. The
// real category data comes from migrations 122 + 123 + 126.

function isMissingFunction(error: any): boolean {
  const code = error?.code ?? error?.details?.code;
  if (code === 'PGRST202' || code === '42883') return true;
  const msg = String(error?.message ?? '').toLowerCase();
  return (
    msg.includes('could not find the function') ||
    (msg.includes('does not exist') && msg.includes('function'))
  );
}

export async function getPhoneDiscoveryCategories(): Promise<DiscoveryCategory[]> {
  const { data, error } = await supabase.rpc('get_phone_discovery_categories');
  if (error) {
    if (isMissingFunction(error)) {
      return (await getDistinctCategories()).map((c) => ({ value: c, label: c }));
    }
    throw error;
  }
  return ((data ?? []) as any[]).map((row) => ({ value: row.slug, label: row.label }));
}

export async function getPhoneDiscoveryClubs(
  userId: string,
  interestSlug: string | null,
  page: number,
  pageSize = 20,
): Promise<DiscoveryClub[]> {
  const { data, error } = await supabase.rpc('get_phone_discovery_clubs', {
    p_user_id: userId,
    p_interest_slug: interestSlug ?? null,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });
  if (error) {
    if (isMissingFunction(error)) {
      return getDiscoveryClubs(userId, interestSlug, page, pageSize);
    }
    throw error;
  }
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

export async function getDiscoveryClubs(
  userId: string,
  category: string | null,
  page: number,
  pageSize = 20,
): Promise<DiscoveryClub[]> {
  const { data, error } = await supabase.rpc('get_discovery_clubs', {
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

export async function getDiscoveryPeople(userId: string): Promise<DiscoveryPerson[]> {
  const { data, error } = await supabase.rpc('get_discovery_people', {
    p_user_id: userId,
  });

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

export async function searchDiscovery(
  userId: string,
  query: string,
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabase.rpc('search_discovery', {
    p_user_id: userId,
    p_query: q,
  });

  if (error) throw error;

  return ((data ?? []) as any[]).map((row) => ({
    result_type: row.result_type as 'person' | 'club',
    id: row.id,
    name: row.name,
    avatar_url: row.avatar_url ?? null,
    sub: row.sub ?? null,
    is_member: row.is_member ?? false,
  }));
}

export interface DiscoveryEvent {
  id: string;
  title: string;
  club_name: string;
  club_id: string;
  club_avatar_url: string | null;
  event_date: string;
  event_time_start: string | null;
  event_time_end: string | null;
  location: string | null;
  cover_image_url: string | null;
  rsvp_count: number;
  is_rsvped: boolean;
  is_saved: boolean;
  match_count: number;
}

export async function getDiscoveryEvents(
  userId: string,
  page: number,
  pageSize = 20,
): Promise<DiscoveryEvent[]> {
  const { data, error } = await supabase.rpc('get_discovery_events', {
    p_user_id: userId,
    p_limit: pageSize,
    p_offset: page * pageSize,
  });

  if (error) throw error;

  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    title: row.title,
    club_name: row.club_name ?? '',
    club_id: row.club_id,
    club_avatar_url: row.club_avatar_url ?? null,
    event_date: row.event_date,
    event_time_start: row.event_time_start ?? null,
    event_time_end: row.event_time_end ?? null,
    location: row.location ?? null,
    cover_image_url: row.cover_image_url ?? null,
    rsvp_count: row.rsvp_count ?? 0,
    is_rsvped: row.is_rsvped ?? false,
    is_saved: row.is_saved ?? false,
    match_count: row.match_count ?? 0,
  }));
}

export async function joinClubAndRefetch(
  userId: string,
  clubId: string,
): Promise<void> {
  await supabase
    .from('club_members')
    .upsert({ user_id: userId, club_id: clubId, role: 'member' }, { onConflict: 'club_id,user_id' });
}
