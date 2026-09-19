"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { dateInAppTz, dayDiff, todayInAppTz } from "../datetime";
import { resolveNotificationVisual, type NotificationVisual, type NotificationVisualActor, type NotificationVisualEntity } from "@weglue/shared";
import { publishNotificationInsert, type BannerNotificationRow } from "../notifications/bannerBus";

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

export interface NotificationActor {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
}

interface PersistedNotificationActorRow {
  notification_id: string;
  actor_id: string;
  created_at: string;
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
  actors: NotificationVisualActor[];
  actorCount: number;
  entity: NotificationVisualEntity | null;
  visual: NotificationVisual;
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
      `id, type, entity_id, entity_type, read, created_at, message, route, group_count, group_actors,
       actor_id,
       profiles!notifications_actor_id_fkey(id, username, avatar_url)`
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return [];

  const rows = data as any[];
  const notificationIds = rows.map((n) => n.id).filter(Boolean) as string[];
  const { data: persistedActorRows, error: persistedActorError } = notificationIds.length
    ? await supabase
      .from("notification_actors")
      .select("notification_id, actor_id, created_at")
      .in("notification_id", notificationIds)
      .order("created_at", { ascending: false })
    : { data: [] as any[], error: null };
  const persistedActorsByNotification = new Map<string, PersistedNotificationActorRow[]>();
  for (const actor of (persistedActorRows ?? []) as PersistedNotificationActorRow[]) {
    const actors = persistedActorsByNotification.get(actor.notification_id) ?? [];
    actors.push(actor);
    persistedActorsByNotification.set(actor.notification_id, actors);
  }
  const actorIdsForRow = (n: any): string[] => {
    const persisted = persistedActorsByNotification.get(n.id) ?? [];
    const legacy = Array.isArray(n.group_actors) ? n.group_actors : [];
    // The representative is the current actor_id; remaining actors are most
    // recent first. The legacy array is oldest-first because 046 appends.
    const useLegacy = Boolean(persistedActorError) || (persisted.length === 0 && legacy.length > 0);
    const candidates = useLegacy
      ? [n.profiles?.id ?? n.actor_id, ...legacy.slice().reverse()]
      : [n.profiles?.id ?? n.actor_id, ...persisted.map((a) => a.actor_id)];
    return [...new Set(candidates.filter(Boolean) as string[])];
  };
  const allActorIds = [...new Set(rows.flatMap(actorIdsForRow))];
  const eventTypes = ["new_event", "event_updated", "event_reminder_tomorrow", "event_reminder_hour", "event_reminder_now", "event_last_chance", "event_canceled", "event_rsvp"];
  const eventIds = [...new Set(rows.filter((n) => n.entity_type === "event" || eventTypes.includes(n.type)).map((n) => n.entity_id).filter(Boolean) as string[])];
  const postIds = [...new Set(rows.filter((n) => n.entity_type === "post" || n.type === "club_post").map((n) => n.entity_id).filter(Boolean) as string[])];
  const conversationIds = [...new Set(rows.filter((n) => n.entity_type === "message" || ["group_chat_added", "chat_invite_joined"].includes(n.type)).map((n) => n.entity_id).filter(Boolean) as string[])];
  // club_photo's entity_id is the club_photos ROW (migration 144), not the
  // club itself — resolved separately below via a club_photos join, same as
  // how message_reply's entity_id is a message id, not a conversation id.
  const clubIds = [...new Set(rows.filter((n) => n.type !== "club_photo" && (n.entity_type === "club" || ["club_joined", "member_joined", "club_chat_added", "officer_chat_added", "officer_role", "officer_removed", "club_removed", "club_inactive"].includes(n.type))).map((n) => n.entity_id).filter(Boolean) as string[])];
  const photoIds = [...new Set(rows.filter((n) => n.type === "club_photo").map((n) => n.entity_id).filter(Boolean) as string[])];
  // message_reply's entity_id is the reply MESSAGE (migration 129); resolve it
  // to its conversation so a tap opens that thread scrolled to the message.
  const replyMessageIds = [...new Set(rows.filter((n) => n.type === "message_reply").map((n) => n.entity_id).filter(Boolean) as string[])];
  const { data: replyMsgRows } = replyMessageIds.length
    ? await supabase.from("messages").select("id, conversation_id").in("id", replyMessageIds)
    : { data: [] as any[] };
  const replyMsgConversation = new Map<string, string>((replyMsgRows ?? []).map((m: any) => [m.id, m.conversation_id]));
  const [{ data: actorRows }, { data: eventRows }, { data: clubRows }, { data: postRows }, { data: conversationRows }, { data: photoRows }] = await Promise.all([
    allActorIds.length ? supabase.from("profiles").select("id, username, avatar_url").in("id", allActorIds) : Promise.resolve({ data: [] as any[] }),
    eventIds.length ? supabase.from("events").select("id, clubs!inner(id, name, avatar_url)").in("id", eventIds) : Promise.resolve({ data: [] as any[] }),
    clubIds.length ? supabase.from("clubs").select("id, name, avatar_url").in("id", clubIds) : Promise.resolve({ data: [] as any[] }),
    postIds.length ? supabase.from("posts").select("id, clubs(id, name, avatar_url)").in("id", postIds) : Promise.resolve({ data: [] as any[] }),
    conversationIds.length ? supabase.from("conversations").select("id, clubs(id, name, avatar_url)").in("id", conversationIds) : Promise.resolve({ data: [] as any[] }),
    photoIds.length ? supabase.from("club_photos").select("id, clubs(id, name, avatar_url)").in("id", photoIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const actorMap = new Map<string, NotificationVisualActor>((actorRows ?? []).map((p: any) => [p.id, { id: p.id, username: p.username, avatar_url: p.avatar_url ?? null }]));
  const eventMap = new Map<string, NotificationVisualEntity>((eventRows ?? []).map((e: any) => [e.id, { id: e.clubs.id, name: e.clubs.name, avatar_url: e.clubs.avatar_url ?? null }]));
  const clubMap = new Map<string, NotificationVisualEntity>((clubRows ?? []).map((c: any) => [c.id, { id: c.id, name: c.name, avatar_url: c.avatar_url ?? null }]));
  const postClubMap = new Map<string, NotificationVisualEntity>((postRows ?? []).filter((p: any) => p.clubs).map((p: any) => [p.id, { id: p.clubs.id, name: p.clubs.name, avatar_url: p.clubs.avatar_url ?? null }]));
  const conversationClubMap = new Map<string, NotificationVisualEntity>((conversationRows ?? []).filter((c: any) => c.clubs).map((c: any) => [c.id, { id: c.clubs.id, name: c.clubs.name, avatar_url: c.clubs.avatar_url ?? null }]));
  const photoClubMap = new Map<string, NotificationVisualEntity>((photoRows ?? []).filter((p: any) => p.clubs).map((p: any) => [p.id, { id: p.clubs.id, name: p.clubs.name, avatar_url: p.clubs.avatar_url ?? null }]));

  const actorIds = [...new Set((data as any[]).map((n) => n.profiles?.id).filter(Boolean) as string[])];
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

  for (const n of rows) {
    const notifDay = dateInAppTz(new Date(n.created_at));
    const daysAgo = dayDiff(notifDay, today);
    const actorIds = actorIdsForRow(n);
    const actorCount = actorIds.length;
    const actors = actorIds
      .map((id: string) => actorMap.get(id)).filter(Boolean) as NotificationVisualActor[];
    const entity = n.entity_type === "event"
      ? eventMap.get(n.entity_id) ?? null
      : n.type === "club_post" || n.entity_type === "post"
        ? postClubMap.get(n.entity_id) ?? null
        : n.type === "club_photo"
          ? photoClubMap.get(n.entity_id) ?? null
          : n.entity_type === "message" || ["group_chat_added", "chat_invite_joined"].includes(n.type)
            ? conversationClubMap.get(n.entity_id) ?? clubMap.get(n.entity_id) ?? null
            : clubMap.get(n.entity_id) ?? null;
    const sender = n.profiles ? { id: n.profiles.id, username: n.profiles.username, avatar_url: n.profiles.avatar_url } : null;
    const notification: AppNotification = {
      id: n.id,
      type: n.type,
      sender: n.profiles
        ? { id: n.profiles.id, username: n.profiles.username, avatar_url: n.profiles.avatar_url }
        : null,
      reference_id: n.entity_id ?? null,
      entity_type: n.entity_type ?? null,
      message: n.message ?? null,
      group_count: n.group_count ?? 1,
      actor_follow_state: n.profiles ? followStateMap.get(n.profiles.id) ?? "not_following" : "not_following",
      is_read: n.read,
      created_at: n.created_at,
      actors,
      actorCount,
      entity,
      route: actorCount > 1
        ? { screen: "notificationActors", notificationId: n.id }
        : n.type === "message_reply" && n.entity_id && replyMsgConversation.has(n.entity_id)
          ? { screen: "chat", chatId: replyMsgConversation.get(n.entity_id), messageId: n.entity_id }
          : n.route ?? null,
      visual: resolveNotificationVisual({ type: n.type, group_count: n.group_count, actor: sender, actors, entity }),
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

/**
 * Return the full persisted actor set for a grouped notification. The
 * representative is first, followed by the remaining actors in recency
 * order. Pagination is applied after that ordering so page boundaries are
 * stable even when the representative is the newest actor.
 */
export async function getNotificationActors(
  notificationId: string,
  limit = 50,
  offset = 0,
): Promise<NotificationActor[]> {
  const safeLimit = Math.max(0, Math.floor(limit));
  const safeOffset = Math.max(0, Math.floor(offset));
  if (!safeLimit) return [];

  const supabase = getSupabaseBrowser();
  const { data: notification } = await supabase
    .from("notifications")
    .select("actor_id, group_actors")
    .eq("id", notificationId)
    .maybeSingle();
  if (!notification) return [];

  const { data: persisted, error: persistedError } = await supabase
    .from("notification_actors")
    .select("actor_id, created_at")
    .eq("notification_id", notificationId)
    .order("created_at", { ascending: false });
  const legacy = Array.isArray((notification as any).group_actors)
    ? (notification as any).group_actors as string[]
    : [];
  const useLegacy = Boolean(persistedError) || ((persisted ?? []).length === 0 && legacy.length > 0);
  const candidates = useLegacy
    ? [(notification as any).actor_id, ...legacy.slice().reverse()]
    : [(notification as any).actor_id, ...(persisted ?? []).map((a: any) => a.actor_id)];
  const actorIds = [...new Set(candidates.filter(Boolean) as string[])].slice(safeOffset, safeOffset + safeLimit);
  if (!actorIds.length) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .in("id", actorIds);
  const profileMap = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
  return actorIds
    .map((id) => profileMap.get(id))
    .filter(Boolean)
    .map((profile: any) => ({
      id: profile.id,
      displayName: profile.full_name?.trim() || profile.username,
      username: profile.username,
      avatarUrl: profile.avatar_url ?? null,
    }));
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
    case "comment_reply": return "replied to your comment";
    case "event_rsvp": return "is going to an event you posted";
    case "new_event": return "posted a new event";
    case "new_message": return "sent you a message";
    case "message_reply": return "replied to your message";
    case "gluemate": return "is now your Gluemate! 🎉";
    default: return "interacted with you";
  }
}

// ─── Deep-link resolution (allowlist, mirrors routes.ts) ─────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NotificationTarget =
  | { kind: "event"; id: string }
  | { kind: "user"; id: string }
  | { kind: "post"; id: string; commentId?: string }
  | { kind: "club"; id: string }
  | { kind: "chat"; id: string; channelId?: string; messageId?: string }
  | { kind: "notification-actors"; id: string }
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
    if (screen === "post" && idFor("postId")) {
      const commentId = idFor("commentId");
      return commentId ? { kind: "post", id: idFor("postId")!, commentId } : { kind: "post", id: idFor("postId")! };
    }
    if (screen === "club" && idFor("clubId")) return { kind: "club", id: idFor("clubId")! };
    if (screen === "chat" && idFor("chatId")) {
      const channelId = idFor("channelId");
      const messageId = idFor("messageId");
      return {
        kind: "chat",
        id: idFor("chatId")!,
        ...(channelId ? { channelId } : {}),
        ...(messageId ? { messageId } : {}),
      };
    }
    if (screen === "notificationActors" && idFor("notificationId")) {
      return { kind: "notification-actors", id: idFor("notificationId")! };
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

// Both mutations below flip is_read in the cached notification list the
// instant the tap happens (onMutate), instead of waiting on the round trip +
// a follow-up refetch before the UI shows anything — that wait was the
// literal "Mark all as read feels slow" complaint. onError restores the exact
// previous cache on failure so a real backend rejection is never hidden;
// onSettled still reconciles with the server in the background.
export function useMarkNotificationRead(userId: string | undefined) {
  const queryClient = useQueryClient();
  const key = ["notifications", userId];
  return useMutation<void, Error, string, { previous?: NotificationSection[] }>({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationSection[]>(key);
      if (previous) {
        queryClient.setQueryData<NotificationSection[]>(key, (current) =>
          (current ?? []).map((section) => ({
            ...section,
            data: section.data.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
          }))
        );
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
    },
  });
}

export function useMarkAllNotificationsRead(userId: string | undefined) {
  const queryClient = useQueryClient();
  const key = ["notifications", userId];
  return useMutation<void, Error, void, { previous?: NotificationSection[] }>({
    mutationFn: async () => {
      const supabase = getSupabaseBrowser();
      await supabase.from("notifications").update({ read: true }).eq("user_id", userId!).eq("read", false);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationSection[]>(key);
      if (previous) {
        queryClient.setQueryData<NotificationSection[]>(key, (current) =>
          (current ?? []).map((section) => ({
            ...section,
            data: section.data.map((n) => (n.is_read ? n : { ...n, is_read: true })),
          }))
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
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

// The single always-on `notifications` subscription for the session. Sole owner
// of `notifications:<uid>` — `useUnreadSummary` used to open a second
// `notifications` INSERT channel (`unread-summary:<uid>`) for the same rows,
// doubling the free-plan Realtime per-row RLS-evaluation cost per active user.
// That channel is gone; this one carries INSERT (list + badge + banner +
// relationship refresh) and UPDATE (cross-device read sync).
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
        (payload: { new: BannerNotificationRow | null }) => {
          void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
          void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
          // Correction 3: the ONE feed for the foreground banner — no second
          // realtime subscription.
          if (payload.new) publishNotificationInsert(payload.new);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => {
          // A read on another device must flip this device's badge + list rows.
          void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
          void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
