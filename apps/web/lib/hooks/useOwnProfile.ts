"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { todayInAppTz, addDaysToDateString } from "../datetime";
import { bucketCalendarEvents, type CalendarEvent, type CalendarSection } from "./useCalendar";
import { uploadAvatar } from "../imageUpload";

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

// ─── Gluemates (mutual accepted follows) ─────────────────────────────────────

export interface Gluemate {
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
}

export function useOwnGluemates(userId: string | undefined) {
  return useQuery({
    queryKey: ["ownGluemates", userId],
    queryFn: async (): Promise<Gluemate[]> => {
      const supabase = getSupabaseBrowser();
      const { data: following } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", userId!)
        .eq("status", "accepted");
      if (!following || following.length === 0) return [];
      const followingIds = (following as any[]).map((r) => r.following_id);
      // The follower_id FK hint is REQUIRED — follows has two FKs to profiles;
      // an unhinted embed returns PGRST201 and silently empties the list.
      const { data: mutuals } = await supabase
        .from("follows")
        .select("follower_id, profiles!follows_follower_id_fkey(id, username, full_name, avatar_url)")
        .eq("following_id", userId!)
        .in("follower_id", followingIds)
        .eq("status", "accepted");
      return ((mutuals ?? []) as any[]).map((r) => ({
        user_id: r.profiles.id,
        username: r.profiles.username,
        full_name: r.profiles.full_name,
        avatar_url: r.profiles.avatar_url,
      }));
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

// ─── Weekly Events (THIS WEEK, going RSVPs, dayDiff 0-7) ──────────────────────

export function useOwnThisWeekEvents(userId: string | undefined) {
  return useQuery({
    queryKey: ["ownThisWeekEvents", userId],
    queryFn: async (): Promise<CalendarSection[]> => {
      const supabase = getSupabaseBrowser();
      const today = todayInAppTz();
      const sevenOut = addDaysToDateString(today, 7);
      const { data: rsvps } = await supabase
        .from("event_rsvps")
        .select("event_id")
        .eq("user_id", userId!)
        .eq("status", "going");
      if (!rsvps || rsvps.length === 0) return [];
      const ids = (rsvps as any[]).map((r) => r.event_id);
      const { data: raw } = await supabase
        .from("events")
        .select(
          `id, title, emoji, event_date, start_time, end_time, location, building, room,
           cover_image_url, clubs!inner(id, name, avatar_url)`
        )
        .in("id", ids)
        .gte("event_date", today)
        .lte("event_date", sevenOut)
        .order("event_date", { ascending: true })
        .order("start_time", { ascending: true });
      const events: CalendarEvent[] = ((raw ?? []) as any[]).map((e) => ({
        id: e.id,
        title: e.title,
        emoji: e.emoji ?? null,
        event_date: e.event_date,
        start_time: e.start_time,
        end_time: e.end_time,
        location: e.location ?? null,
        building: e.building ?? null,
        room: e.room ?? null,
        cover_image_url: e.cover_image_url ?? null,
        club: { id: e.clubs.id, name: e.clubs.name, avatar_url: e.clubs.avatar_url ?? null },
        attendee_count: 0,
        attendee_preview: [],
        user_rsvp_status: "going",
        is_saved: false,
      }));
      return bucketCalendarEvents(events, today);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

// ─── Own posts grid ──────────────────────────────────────────────────────────

export interface GridPost {
  id: string;
  image_url: string | null;
  created_at: string;
}

export function useOwnPosts(userId: string | undefined) {
  return useQuery({
    queryKey: ["ownPosts", userId],
    queryFn: async (): Promise<GridPost[]> => {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase
        .from("posts")
        .select("id, image_url, created_at")
        .eq("author_id", userId!)
        .not("image_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(36);
      return (data ?? []) as GridPost[];
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000,
  });
}

// ─── Edit Profile mutations ──────────────────────────────────────────────────

export function useUpdateDisplayName(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (fullName: string) => {
      const trimmed = fullName.trim();
      if (!trimmed) throw new Error("Display name cannot be empty");
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.from("profiles").update({ full_name: trimmed }).eq("id", userId!);
      if (error) throw error;
    },
    // Display name is embedded in many caches; refresh everything.
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useUpdateProfileAvatar(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      avatarUrl,
      avatarType,
    }: {
      avatarUrl: string | null;
      avatarType: "photo" | "text" | null;
    }) => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl, avatar_type: avatarType })
        .eq("id", userId!);
      if (error) throw error;
    },
    // The avatar URL is embedded nearly everywhere (header, card, feeds,
    // comments, attendees…) — full invalidation is the safe way to update it,
    // and it clears the picture prompt once a custom avatar exists.
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/** Uploads a chosen photo to Storage then persists it as the avatar. */
export function useUploadAvatar(userId: string | undefined) {
  const updateAvatar = useUpdateProfileAvatar(userId);
  return useMutation({
    mutationFn: async (file: File) => {
      const url = await uploadAvatar(userId!, file);
      await updateAvatar.mutateAsync({ avatarUrl: url, avatarType: "photo" });
      return url;
    },
  });
}
