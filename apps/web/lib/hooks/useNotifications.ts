"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { dateInAppTz, dayDiff, todayInAppTz } from "../datetime";

// Web port of apps/mobile/services/notificationService.ts + hooks/useNotifications.ts
// + lib/notifications/routes.ts. Same canonical notifications table, same types,
// grouping, read semantics and follow actions — so read state and badge counts
// stay consistent with mobile (shared records).

export type NotificationGroup = "New" | "Yesterday" | "Last week" | "Earlier";
export type ActorFollowState = "not_following" | "pending" | "following";

export interface NotificationSender {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface AppNotification {
  id: string;
  type: string;
  sender: NotificationSender | null;
  reference_id: string | null;
  entity_type: "event" | "club" | "message" | "post" | null;
  message: string | null;
  route: Record<string, unknown> | null;
  group_count: number;
  actor_follow_state: ActorFollowState;
  is_read: boolean;
  created_at: string;
}

export interface NotificationSection {
  group: NotificationGroup;
  data: AppNotification[];
}

async function getNotifications(userId: string): Promise<NotificationSection[]> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from("notifications")
    .select(
      `id, type, entity_id, entity_type, read, created_at, message, route, group_count,
       profiles!notifications_actor_id_fkey(id, username, avatar_url)`
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return [];

  const actorIds = [
    ...new Set((data as any[]).map((n) => n.profiles?.id).filter(Boolean) as string[]),
  ];
  const followStateMap = new Map<string, ActorFollowState>();
  if (actorIds.length > 0) {
    const { data: myFollows } = await supabase
      .from("follows")
      .select("following_id, status")
      .eq("follower_id", userId)
      .in("following_id", actorIds);
    for (const f of (myFollows ?? []) as any[]) {
      followStateMap.set(f.following_id, f.status === "accepted" ? "following" : "pending");
    }
  }

  const today = todayInAppTz();
  const groups: Record<NotificationGroup, AppNotification[]> = {
    New: [],
    Yesterday: [],
    "Last week": [],
    Earlier: [],
  };

  for (const n of data as any[]) {
    const notifDay = dateInAppTz(new Date(n.created_at));
    const daysAgo = dayDiff(notifDay, today);
    const notification: AppNotification = {
      id: n.id,
      type: n.type,
      sender: n.profiles
        ? { id: n.profiles.id, username: n.profiles.username, avatar_url: n.profiles.avatar_url }
        : null,
      reference_id: n.entity_id ?? null,
      entity_type: n.entity_type ?? null,
      message: n.message ?? null,
      route: n.route ?? null,
      group_count: n.group_count ?? 1,
      actor_follow_state: n.profiles ? followStateMap.get(n.profiles.id) ?? "not_following" : "not_following",
      is_read: n.read,
      created_at: n.created_at,
    };
    if (daysAgo <= 0) groups["New"].push(notification);
    else if (daysAgo === 1) groups["Yesterday"].push(notification);
    else if (daysAgo <= 7) groups["Last week"].push(notification);
    else groups["Earlier"].push(notification);
  }

  return (Object.entries(groups) as [NotificationGroup, AppNotification[]][])
    .filter(([, items]) => items.length > 0)
    .map(([group, data]) => ({ group, data }));
}

export function useNotifications(userId: string | undefined) {
  return useQuery({
    queryKey: ["notifications", userId],
    queryFn: () => getNotifications(userId!),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

/** Text copy, mirroring mobile's notificationDescription. */
export function notificationDescription(item: AppNotification): string {
  const others = Math.max((item.group_count ?? 1) - 1, 0);
  const grouped = (verb: string) =>
    others > 0 ? `and ${others} other${others === 1 ? "" : "s"} ${verb}` : verb;
  switch (item.type) {
    case "follow_request": return "requested to follow you";
    case "follow_accepted": return "accepted your follow request";
    case "new_follower": return "started following you";
    case "like": return grouped("liked your photo");
    case "comment": return grouped("commented on your photo");
    case "event_rsvp": return "is going to an event you posted";
    case "new_event": return "posted a new event";
    case "new_message": return "sent you a message";
    case "gluemate": return "is now your Gluemate! 🎉";
    default: return "interacted with you";
  }
}

// ─── Deep-link resolution (allowlist, mirrors routes.ts) ─────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NotificationTarget =
  | { kind: "event"; id: string }
  | { kind: "user"; id: string }
  | { kind: "post"; id: string }
  | { kind: "club"; id: string }
  | { kind: "chat"; id: string; channelId?: string }
  | { kind: "notifications" };

/** Resolves where a notification opens — server route first, then legacy fallback. */
export function resolveNotificationTarget(item: AppNotification): NotificationTarget | null {
  const route = item.route;
  if (route && typeof route === "object") {
    const screen = String((route as any).screen);
    const idFor = (key: string) => {
      const v = (route as any)[key];
      return typeof v === "string" && UUID_RE.test(v) ? v : null;
    };
    if (screen === "event" && idFor("eventId")) return { kind: "event", id: idFor("eventId")! };
    if (screen === "profile" && idFor("userId")) return { kind: "user", id: idFor("userId")! };
    if (screen === "post" && idFor("postId")) return { kind: "post", id: idFor("postId")! };
    if (screen === "club" && idFor("clubId")) return { kind: "club", id: idFor("clubId")! };
    if (screen === "chat" && idFor("chatId")) {
      const channelId = idFor("channelId");
      return channelId ? { kind: "chat", id: idFor("chatId")!, channelId } : { kind: "chat", id: idFor("chatId")! };
    }
    if (screen === "notifications") return { kind: "notifications" };
  }
  const ref = item.reference_id;
  if ((item.type === "like" || item.type === "comment") && ref) return { kind: "post", id: ref };
  if (item.type === "new_event" && ref) return { kind: "event", id: ref };
  if (
    ["club_chat_added", "officer_chat_added", "officer_role", "officer_removed", "club_joined", "member_joined"].includes(item.type) &&
    ref
  )
    return { kind: "club", id: ref };
  if (item.sender?.id) return { kind: "user", id: item.sender.id };
  return null;
}

// ─── Read state ──────────────────────────────────────────────────────────────

async function markNotificationRead(notificationId: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  await supabase.from("notifications").update({ read: true }).eq("id", notificationId).eq("read", false);
}

export function useMarkNotificationRead(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
      void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
    },
  });
}

export function useMarkAllNotificationsRead(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseBrowser();
      await supabase.from("notifications").update({ read: true }).eq("user_id", userId!).eq("read", false);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
      void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
    },
  });
}

// ─── Follow actions on notification rows ─────────────────────────────────────

function invalidateRelationship(queryClient: ReturnType<typeof useQueryClient>, userId: string | undefined) {
  for (const key of [["notifications", userId], ["ownProfile", userId], ["ownGluemates", userId], ["userProfile"]])
    void queryClient.invalidateQueries({ queryKey: key });
}

export function useAcceptFollowRequest(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requesterId: string) => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase
        .from("follows")
        .update({ status: "accepted" })
        .eq("follower_id", requesterId)
        .eq("following_id", userId!)
        .eq("status", "pending");
      if (error) throw error;
    },
    onSuccess: () => invalidateRelationship(queryClient, userId),
  });
}

export function useDeclineFollowRequest(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requesterId: string) => {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", requesterId)
        .eq("following_id", userId!)
        .eq("status", "pending");
      if (error) throw error;
    },
    onSuccess: () => invalidateRelationship(queryClient, userId),
  });
}

export function useFollowBack(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (targetUserId: string) => followUser(userId!, targetUserId),
    onSuccess: () => invalidateRelationship(queryClient, userId),
  });
}

// Follow (respects private accounts: pending vs accepted) — DB triggers create
// the notification, never the client. Shared with the profile follow button.
export async function followUser(followerId: string, followingId: string): Promise<void> {
  if (followerId === followingId) return;
  const supabase = getSupabaseBrowser();
  const { data: existing } = await supabase
    .from("follows")
    .select("status")
    .eq("follower_id", followerId)
    .eq("following_id", followingId)
    .maybeSingle();
  if (existing) return;
  const { data: privacy } = await supabase
    .from("user_privacy")
    .select("is_private")
    .eq("user_id", followingId)
    .maybeSingle();
  const status = (privacy as any)?.is_private ? "pending" : "accepted";
  const { error } = await supabase
    .from("follows")
    .upsert(
      { follower_id: followerId, following_id: followingId, status },
      { onConflict: "follower_id,following_id", ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", followerId)
    .eq("following_id", followingId);
  if (error) throw error;
}

// ─── Realtime: new notifications refresh the list + badges live ──────────────

export function useRealtimeNotifications(userId: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
          void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
