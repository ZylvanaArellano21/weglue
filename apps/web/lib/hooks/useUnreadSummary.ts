"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseBrowser } from "../supabase-browser";
import { subscribeBroadcast } from "../realtime";

// Web port of apps/mobile/hooks/useUnreadSummary.ts. Same `get_unread_summary`
// RPC, same two counts — so web badges and mobile badges are driven by the
// exact same shared backend records.
//
// Product meaning (from mobile, do NOT invent new rules from the screenshots):
//   unread_notifications   → notification activity (Home icon + sidebar entry)
//   unread_threads         → unread THREAD count; still the source of the iOS
//                            app-icon badge on mobile. Left untouched.
//   unread_direct_messages → unread MESSAGES in one-to-one conversations
//   unread_group_messages  → unread MESSAGES in custom groups + club member
//                            chats + club officer chats
// Mobile has NO club-activity badge count, so the web Clubs icon shows none.
//
// The Message tab's three badges — Single, Groups, and the header Messages
// icon — all derive from the last two keys, so the icon count is always
// exactly Single + Groups by construction (migration 076).

export type UnreadConversationCount = {
  conversation_id: string;
  unread_count: number;
};

export type UnreadSummary = {
  unread_notifications: number;
  unread_threads: number;
  unread_direct_messages: number;
  unread_group_messages: number;
  /**
   * Fix 10 — exactly which conversations have unread activity, so a chat-list
   * row can show its own badge instead of only the aggregate Single/Group
   * counts above. Same source RPC as everything else here. Only entries with
   * unread_count > 0 are present.
   */
  unread_conversations: UnreadConversationCount[];
};

/** The single message-tab badge contract: total = Single + Groups. */
export function messageBadgeCounts(summary: UnreadSummary | undefined): {
  single: number;
  groups: number;
  total: number;
} {
  const single = Math.max(0, summary?.unread_direct_messages ?? 0);
  const groups = Math.max(0, summary?.unread_group_messages ?? 0);
  return { single, groups, total: single + groups };
}

async function fetchUnreadSummary(): Promise<UnreadSummary> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.rpc("get_unread_summary");
  if (error) throw error;
  const summary = (data ?? {}) as Partial<UnreadSummary>;
  return {
    unread_notifications: Math.max(0, summary.unread_notifications ?? 0),
    unread_threads: Math.max(0, summary.unread_threads ?? 0),
    unread_direct_messages: Math.max(0, summary.unread_direct_messages ?? 0),
    unread_group_messages: Math.max(0, summary.unread_group_messages ?? 0),
    unread_conversations: Array.isArray(summary.unread_conversations) ? summary.unread_conversations : [],
  };
}

/** O(1) per-conversation lookup for a chat-list row's own badge. */
export function unreadCountForConversation(
  summary: UnreadSummary | undefined,
  conversationId: string | undefined,
): number {
  if (!summary || !conversationId) return 0;
  return summary.unread_conversations.find((c) => c.conversation_id === conversationId)?.unread_count ?? 0;
}

/** Read-only value (no subscription). Use at extra render sites. */
export function useUnreadSummaryValue(userId: string | undefined) {
  return useQuery({
    queryKey: ["unreadSummary", userId],
    queryFn: fetchUnreadSummary,
    enabled: !!userId,
    staleTime: 15 * 1000,
  });
}

/**
 * The live version — mount ONCE per session (HomeClient). Owns the single
 * realtime subscription that keeps both badge counts fresh across devices.
 */
export function useUnreadSummary(userId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["unreadSummary", userId],
    queryFn: fetchUnreadSummary,
    enabled: !!userId,
    staleTime: 15 * 1000,
    // The realtime notifications subscription + the message-inbox broadcast
    // below keep this fresh in real time. This poll is only a self-heal for a
    // missed realtime event (channel drop, long background); 5 min is enough
    // for that without adding a per-client request/minute at scale.
    refetchInterval: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabaseBrowser();
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
    };
    // One uniquely-named channel (mirrors mobile's `unread-summary:<id>`),
    // torn down on unmount so we never double-subscribe.
    const channel = supabase
      .channel(`unread-summary:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        invalidate
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => {
          invalidate();
          void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
        }
      )
      .subscribe();
    const removeMessageSync = subscribeBroadcast(
      `sync:message-inbox:${userId}`,
      "invalidate",
      invalidate,
      invalidate,
    );

    return () => {
      void supabase.removeChannel(channel);
      removeMessageSync();
    };
  }, [userId, queryClient]);

  return query;
}
