"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { addDaysToDateString, todayInAppTz } from "../datetime";
import { followUser, unfollowUser } from "./useNotifications";
import type { GridPost } from "./useOwnProfile";

// Web port of apps/mobile/services/followService.ts (getUserProfile, gluemates,
// posts, weekly events) + follow/unfollow. Powers the public profile opened
// from Gluemates and notification actors. Privacy (is_private / hide_interests /
// hide_events) is enforced server-side by RLS; these flags just drive the UI.

export type FollowStatus = "following" | "pending" | "not_following";

export interface UserProfileData {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  major: string | null;
  clubs_count: number;
  gluemates_count: number;
  is_private: boolean;
  hide_interests: boolean;
  hide_events: boolean;
  follow_status: FollowStatus;
  is_gluemate: boolean;
  interests: string[];
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
  const ids = (following as any[]).map((r) => r.following_id);
  const { count } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("following_id", userId)
    .in("follower_id", ids)
    .eq("status", "accepted");
  return count ?? 0;
}

export function useUserProfile(targetUserId: string | undefined, viewerUserId: string | undefined) {
  return useQuery({
    queryKey: ["userProfile", targetUserId, viewerUserId],
    queryFn: async (): Promise<UserProfileData | null> => {
      const supabase = getSupabaseBrowser();
      const [
        { data: profile },
        { data: privacy },
        { data: followRow },
        { data: reverseFollow },
        { data: interests },
        { data: memberships },
        { data: clubRoles },
      ] = await Promise.all([
        supabase.from("profiles").select("id, username, full_name, avatar_url, bio, major").eq("id", targetUserId!).single(),
        supabase.from("user_privacy").select("is_private, hide_interests, hide_events").eq("user_id", targetUserId!).maybeSingle(),
        supabase.from("follows").select("status").eq("follower_id", viewerUserId!).eq("following_id", targetUserId!).maybeSingle(),
        supabase.from("follows").select("id").eq("follower_id", targetUserId!).eq("following_id", viewerUserId!).eq("status", "accepted").maybeSingle(),
        supabase.from("user_interests").select("interest").eq("user_id", targetUserId!),
        supabase.from("club_members").select("club_id").eq("user_id", targetUserId!),
        supabase.from("club_officers").select("club_id, role_title, clubs!inner(id, name)").eq("user_id", targetUserId!),
      ]);

      if (!profile) return null;
      const p = profile as any;
      const gluematesCount = await getGluematesCount(targetUserId!);
      let followStatus: FollowStatus = "not_following";
      if (followRow) followStatus = (followRow as any).status === "accepted" ? "following" : "pending";

      return {
        id: p.id,
        username: p.username,
        full_name: p.full_name,
        avatar_url: p.avatar_url,
        bio: p.bio,
        major: p.major,
        clubs_count: (memberships ?? []).length,
        gluemates_count: gluematesCount,
        is_private: (privacy as any)?.is_private ?? false,
        hide_interests: (privacy as any)?.hide_interests ?? false,
        hide_events: (privacy as any)?.hide_events ?? false,
        follow_status: followStatus,
        is_gluemate: followStatus === "following" && !!reverseFollow,
        interests: (interests ?? []).map((i: any) => i.interest),
        club_roles: (clubRoles ?? []).map((r: any) => ({
          club_id: r.clubs.id,
          club_name: r.clubs.name,
          role_title: r.role_title,
        })),
      };
    },
    enabled: !!targetUserId && !!viewerUserId,
    staleTime: 60 * 1000,
  });
}

export function useUserPosts(targetUserId: string | undefined) {
  return useQuery({
    queryKey: ["userPosts", targetUserId],
    queryFn: async (): Promise<GridPost[]> => {
      const supabase = getSupabaseBrowser();
      const { data } = await supabase
        .from("posts")
        .select("id, image_url, created_at")
        .eq("author_id", targetUserId!)
        .not("image_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(36);
      return (data ?? []) as GridPost[];
    },
    enabled: !!targetUserId,
    staleTime: 60 * 1000,
  });
}

export interface UserWeeklyEvent {
  id: string;
  title: string;
  emoji: string | null;
  cover_image_url: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string | null;
  building: string | null;
  room: string | null;
  club: { id: string; name: string };
}

export function useUserWeeklyEvents(targetUserId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["userWeeklyEvents", targetUserId],
    queryFn: async (): Promise<UserWeeklyEvent[]> => {
      const supabase = getSupabaseBrowser();
      // "This week" is the SAME window mobile uses (getOwnThisWeekEvents):
      // today through today+7 in America/Chicago, `status = 'going'` only.
      // Without the upper bound this list showed every future RSVP forever,
      // which is not what "Weekly Events" means on either platform.
      const today = todayInAppTz();
      const sevenOut = addDaysToDateString(today, 7);
      const { data: rsvps } = await supabase
        .from("event_rsvps")
        .select("event_id")
        .eq("user_id", targetUserId!)
        .eq("status", "going");
      if (!rsvps || rsvps.length === 0) return [];
      const ids = (rsvps as any[]).map((r) => r.event_id);
      const { data } = await supabase
        .from("events")
        .select("id, title, emoji, cover_image_url, event_date, start_time, end_time, location, building, room, clubs!inner(id, name)")
        .in("id", ids)
        .gte("event_date", today)
        .lte("event_date", sevenOut)
        .order("event_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(20);
      return ((data ?? []) as any[]).map((e) => ({
        id: e.id,
        title: e.title,
        emoji: e.emoji,
        cover_image_url: e.cover_image_url,
        event_date: e.event_date,
        start_time: e.start_time,
        end_time: e.end_time,
        location: e.location,
        building: e.building ?? null,
        room: e.room ?? null,
        club: { id: e.clubs.id, name: e.clubs.name },
      }));
    },
    enabled: !!targetUserId && enabled,
    staleTime: 60 * 1000,
  });
}

function invalidateFollow(qc: ReturnType<typeof useQueryClient>, viewerId: string | undefined) {
  // Follow state is embedded in post author data too (media overlay + feeds),
  // so those must refetch or a Follow button won't flip to Following.
  for (const key of [
    ["userProfile"],
    ["ownProfile", viewerId],
    ["ownGluemates", viewerId],
    ["notifications", viewerId],
    ["postDetail"],
    ["homePostsFeed"],
  ])
    void qc.invalidateQueries({ queryKey: key });
}

export function useFollow(viewerUserId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetUserId: string) => followUser(viewerUserId!, targetUserId),
    onSuccess: () => invalidateFollow(qc, viewerUserId),
  });
}

export function useUnfollow(viewerUserId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetUserId: string) => unfollowUser(viewerUserId!, targetUserId),
    onSuccess: () => invalidateFollow(qc, viewerUserId),
  });
}
