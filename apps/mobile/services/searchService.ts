import { supabase } from '../lib/supabase';

export interface DiscoveryClub {
  id: string;
  name: string;
  avatar_url: string | null;
  member_count: number;
  is_member: boolean;
  categories: string[];
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
    member_count: row.member_count ?? 0,
    is_member: row.is_member ?? false,
    categories: row.categories ?? [],
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

export async function joinClubAndRefetch(
  userId: string,
  clubId: string,
): Promise<void> {
  await supabase
    .from('club_members')
    .upsert({ user_id: userId, club_id: clubId, role: 'member' }, { onConflict: 'club_id,user_id' });
}
