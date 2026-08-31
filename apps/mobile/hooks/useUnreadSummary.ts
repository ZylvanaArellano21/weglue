/**
 * The two badge counts (Notifications entry + Messages tab) from one RPC,
 * kept live by realtime and mirrored onto the app icon badge so the icon
 * number always matches the in-app state across devices.
 */
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildMessageBanner, type NewMessageBroadcastPayload } from '@weglue/shared';
import { supabase } from '../lib/supabase';
import { subscribeBroadcastEvents } from '../lib/realtime';
import { publishNotificationInsert } from '../lib/notifications/bannerBus';

export type UnreadConversationCount = {
  conversation_id: string;
  unread_count: number;
};

export type UnreadSummary = {
  unread_notifications: number;
  /** Unread THREAD count. Still the app-icon badge source — do not repurpose. */
  unread_threads: number;
  /** Unread MESSAGES in one-to-one conversations (the Single control). */
  unread_direct_messages: number;
  /** Unread MESSAGES in custom groups + club member/officer chats (Groups). */
  unread_group_messages: number;
  /**
   * Fix 10 — exactly which conversations have unread activity, so a chat-list
   * row can show its own badge instead of only the aggregate Single/Group
   * counts above. Same source RPC as everything else here — one summary,
   * three levels (global → Single/Group → per-conversation), always in sync.
   * Only entries with unread_count > 0 are present.
   */
  unread_conversations: UnreadConversationCount[];
};

/**
 * The single message-tab badge contract, shared with web
 * (apps/web/lib/hooks/useUnreadSummary.ts): the Messages tab icon is always
 * exactly Single + Groups because all three read these same two keys.
 */
export function messageBadgeCounts(summary: UnreadSummary | undefined): {
  single: number;
  groups: number;
  total: number;
} {
  const single = Math.max(0, summary?.unread_direct_messages ?? 0);
  const groups = Math.max(0, summary?.unread_group_messages ?? 0);
  return { single, groups, total: single + groups };
}

/**
 * Freshness knobs, shared by both hooks and pinned by a regression test.
 * The always-on `notifications` subscription (useRealtimeNotifications, which
 * invalidates `['unreadSummary']` on every INSERT/UPDATE) + the
 * `sync:message-inbox` broadcast are what keep this live; `UNREAD_SUMMARY_POLL_MS`
 * is only the self-heal for a missed realtime event (channel drop, long
 * background).
 */
export const UNREAD_SUMMARY_STALE_MS = 15 * 1000;
export const UNREAD_SUMMARY_POLL_MS = 5 * 60 * 1000;

export async function fetchUnreadSummary(): Promise<UnreadSummary> {
  const { data, error } = await supabase.rpc('get_unread_summary');
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

/**
 * Read-only view of the summary for badge render sites. The realtime
 * subscription + icon-badge mirroring live ONLY in useUnreadSummary (mounted
 * once by PushNotificationsHost) — a second subscription would violate the
 * unique-realtime-topic rule.
 */
export function useUnreadSummaryValue(userId: string | undefined) {
  return useQuery({
    queryKey: ['unreadSummary', userId],
    queryFn: fetchUnreadSummary,
    enabled: !!userId,
    staleTime: UNREAD_SUMMARY_STALE_MS,
  });
}

export function useUnreadSummary(userId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['unreadSummary', userId],
    queryFn: fetchUnreadSummary,
    enabled: !!userId,
    staleTime: UNREAD_SUMMARY_STALE_MS,
    refetchInterval: UNREAD_SUMMARY_POLL_MS,
  });

  // Realtime freshness comes from ONE server-authorized private broadcast on
  // `sync:message-inbox:<uid>`, carrying two events:
  //   • `invalidate`   — opaque deletion/read-sync ping (migrations 067/077/082)
  //   • `new_message`  — payload-carrying foreground-banner signal for an
  //                      incoming message (replaces the old broad `messages`
  //                      INSERT `postgres_changes` subscription)
  // The `notifications` INSERT/UPDATE rows are handled by the single
  // `useRealtimeNotifications` channel, which invalidates `['unreadSummary']`.
  // A message row is never used as a synchronization payload; the `new_message`
  // payload is presentation-only.
  useEffect(() => {
    if (!userId) return;
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['unreadSummary', userId] });
      // A conversation activating / bumping its banner epoch (migration 105)
      // fires this `invalidate` on the per-user topic — refetch the chat list
      // so useConversationBannerChannels picks up the new `banner_epoch`.
      queryClient.invalidateQueries({ queryKey: ['myChats', userId] });
    };
    return subscribeBroadcastEvents(
      `sync:message-inbox:${userId}`,
      {
        invalidate,
        new_message: (payload: NewMessageBroadcastPayload) => {
          invalidate();
          // The per-user `new_message` path is already server-filtered by
          // `muted_at` / `channel_mutes`; the conv-scoped path (which is not)
          // applies the mute filter in useConversationBannerChannels.
          const banner = buildMessageBanner(payload, userId);
          if (banner) publishNotificationInsert(banner);
        },
      },
      invalidate,
    );
  }, [userId, queryClient]);

  // App icon badge mirrors total unread; clears when everything is read.
  // Intentionally still THREAD-based: this is the same number the push worker
  // stamps on each notification via get_unread_summary_for, and 076 left that
  // key untouched so no delivered push changes meaning.
  useEffect(() => {
    if (!query.data) return;
    const total = query.data.unread_notifications + query.data.unread_threads;
    void Notifications.setBadgeCountAsync(total).catch(() => {});
  }, [query.data]);

  return query;
}
