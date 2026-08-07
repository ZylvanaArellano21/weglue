/**
 * The two badge counts (Notifications entry + Messages tab) from one RPC,
 * kept live by realtime and mirrored onto the app icon badge so the icon
 * number always matches the in-app state across devices.
 */
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { createSafeChannel, removeSafeChannel, subscribeBroadcast } from '../lib/realtime';

export type UnreadSummary = {
  unread_notifications: number;
  /** Unread THREAD count. Still the app-icon badge source — do not repurpose. */
  unread_threads: number;
  /** Unread MESSAGES in one-to-one conversations (the Single control). */
  unread_direct_messages: number;
  /** Unread MESSAGES in custom groups + club member/officer chats (Groups). */
  unread_group_messages: number;
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

async function fetchUnreadSummary(): Promise<UnreadSummary> {
  const { data, error } = await supabase.rpc('get_unread_summary');
  if (error) throw error;
  const summary = (data ?? {}) as Partial<UnreadSummary>;
  return {
    unread_notifications: Math.max(0, summary.unread_notifications ?? 0),
    unread_threads: Math.max(0, summary.unread_threads ?? 0),
    unread_direct_messages: Math.max(0, summary.unread_direct_messages ?? 0),
    unread_group_messages: Math.max(0, summary.unread_group_messages ?? 0),
  };
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
    staleTime: 15 * 1000,
  });
}

export function useUnreadSummary(userId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['unreadSummary', userId],
    queryFn: fetchUnreadSummary,
    enabled: !!userId,
    staleTime: 15 * 1000,
    refetchInterval: 60 * 1000,
  });

  // Realtime: notification INSERT/UPDATE (cross-device read sync) plus the
  // opaque, server-authorized message-inbox signal. Message rows themselves
  // are never used as a synchronization payload.
  useEffect(() => {
    if (!userId) return;
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['unreadSummary', userId] });
    };
    const channel = createSafeChannel(`unread-summary:${userId}`, [
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
        callback: invalidate,
      },
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
        callback: () => {
          invalidate();
          // A read elsewhere must update this device's inbox rows too.
          queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
        },
      },
    ]);
    const removeMessageSync = subscribeBroadcast(
      `sync:message-inbox:${userId}`,
      'invalidate',
      invalidate,
      invalidate,
    );
    return () => {
      removeSafeChannel(channel);
      removeMessageSync();
    };
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
