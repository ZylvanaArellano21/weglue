"use client";

import { useQuery } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";

// Web port of apps/mobile/services/profileService.ts::getOwnProfile +
// apps/mobile/hooks/useOwnProfile.ts. Same tables, same shape — so the left
// profile card, gluemate count and club count match mobile exactly.

export interface OwnProfileData {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  avatar_type: string | null;
  bio: string | null;
  major: string | null;
  year: string | null;
  university: string | null;
  clubs_count: number;
  gluemates_count: number;
  interests: string[];
  activities: string[];
  club_roles: Array<{ club_id: string; club_name: string; role_title: string }>;
}

async function getGluematesCount(userId: string): Promise<number> {
  const supabase = getSupabaseBrowser();
  const { data: following } = await supabase
    .from("follows")
    .select("following_id")
    .eq("follower_id", userId)
    .eq("status", "accepted");

  if (!following || following.length === 0) return 0;
  const followingIds = (following as any[]).map((r) => r.following_id);

  // Gluemates = MUTUAL accepted follows only (they follow me back).
  const { count } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("following_id", userId)
    .in("follower_id", followingIds)
    .eq("status", "accepted");

  return count ?? 0;
}

export async function getOwnProfile(userId: string): Promise<OwnProfileData | null> {
  const supabase = getSupabaseBrowser();
  const [
    { data: profile },
    { data: interests },
    { data: activities },
    { data: memberships },
    { data: clubRoles },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, full_name, avatar_url, avatar_type, bio, major, year, university")
      .eq("id", userId)
      .single(),
    supabase.from("user_interests").select("interest").eq("user_id", userId),
    supabase.from("user_activities").select("activity").eq("user_id", userId),
    supabase.from("club_members").select("club_id").eq("user_id", userId),
    supabase
      .from("club_officers")
      .select("club_id, role_title, clubs!inner(id, name)")
      .eq("user_id", userId),
  ]);

  if (!profile) return null;

  const clubIds = (memberships ?? []).map((m: any) => m.club_id);
  const gluematesCount = await getGluematesCount(userId);

  return {
    id: (profile as any).id,
    username: (profile as any).username,
    full_name: (profile as any).full_name,
    avatar_url: (profile as any).avatar_url,
    avatar_type: (profile as any).avatar_type,
    bio: (profile as any).bio,
    major: (profile as any).major,
    year: (profile as any).year,
    university: (profile as any).university,
    clubs_count: clubIds.length,
    gluemates_count: gluematesCount,
    interests: (interests ?? []).map((i: any) => i.interest),
    activities: (activities ?? []).map((a: any) => a.activity),
    club_roles: (clubRoles ?? []).map((r: any) => ({
      club_id: r.clubs.id,
      club_name: r.clubs.name,
      role_title: r.role_title,
    })),
  };
}

export function useOwnProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ["ownProfile", userId],
    queryFn: () => getOwnProfile(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });
}

// ─── Club @handles for the profile card tags ─────────────────────────────────

export interface OwnClubHandle {
  club_id: string;
  club_name: string;
  club_handle: string | null;
  avatar_url: string | null;
  role: "member" | "officer";
}

export async function getOwnClubs(userId: string): Promise<OwnClubHandle[]> {
  const supabase = getSupabaseBrowser();
  const { data } = await supabase
    .from("club_members")
    .select("role, clubs!inner(id, name, handle, avatar_url)")
    .eq("user_id", userId);

  return ((data ?? []) as any[]).map((row) => ({
    club_id: row.clubs.id,
    club_name: row.clubs.name,
    club_handle: row.clubs.handle ?? null,
    avatar_url: row.clubs.avatar_url ?? null,
    role: row.role as "member" | "officer",
  }));
}

export function useOwnClubs(userId: string | undefined) {
  return useQuery({
    queryKey: ["ownClubs", userId],
    queryFn: () => getOwnClubs(userId!),
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}
