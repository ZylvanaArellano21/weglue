/**
 * Migration 105 — conversation-scoped foreground-banner delivery for large
 * conversations.
 *
 * DMs and small conversations deliver their `new_message` banner on the
 * per-user topic `sync:message-inbox:<uid>` (owned by useUnreadSummary). When
 * the backend switches a conversation to conv-scoped delivery it sets
 * `conversations.banner_broadcast_active = true` and bumps `banner_epoch`; from
 * then on the trigger sends ONE `new_message` to
 * `sync:message-inbox-conv:<conversation_id>:<banner_epoch>` and Supabase fans
 * it out to connected members. This hook holds that subscription for every such
 * conversation the viewer is in.
 *
 * The client never learns the threshold `T` — it subscribes purely from the
 * `banner_broadcast_active` / `banner_epoch` columns returned by getMyChats.
 * A 90 s server-side grace window keeps delivery on the always-valid per-user
 * topic until the client has had time to (re)subscribe here, so a transition
 * never drops a banner.
 *
 * Mount once, next to useUnreadSummary (PushNotificationsHost).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildMessageBanner, type NewMessageBroadcastPayload } from '@weglue/shared';
import { subscribeBroadcastEvents } from '../lib/realtime';
import { publishNotificationInsert } from '../lib/notifications/bannerBus';
import { getMyChats } from '../services/chatService';
import { getMutedChannelIds } from '../services/channelService';

// Stagger conversation-channel joins after the critical channels (notifications,
// per-user inbox) so a reconnect with many large chats does not hit the
// free-tier realtime-auth throughput ceiling in one burst.
const JOIN_STAGGER_MS = 180;

export function useConversationBannerChannels(userId: string | undefined) {
  const queryClient = useQueryClient();

  const { data: chats } = useQuery({
    queryKey: ['myChats', userId],
    queryFn: () => getMyChats(userId!),
    enabled: !!userId,
    staleTime: 15 * 1000,
  });

  const { data: mutedChannelIds } = useQuery({
    queryKey: ['mutedChannelIds', userId],
    queryFn: () => getMutedChannelIds(userId!),
    enabled: !!userId,
    staleTime: 60 * 1000,
  });

  // Conversations the backend has switched to conv-scoped banner delivery.
  const active = useMemo(
    () =>
      (chats ?? [])
        .filter((c) => c.banner_broadcast_active && c.banner_epoch != null)
        .map((c) => ({ id: c.id, epoch: c.banner_epoch as number })),
    [chats],
  );
  // Key changes only when the (conversation, epoch) set changes — a mute toggle
  // must NOT tear channels down, so mute sets are read live via refs.
  const activeKey = useMemo(
    () => active.map((a) => `${a.id}:${a.epoch}`).sort().join(','),
    [active],
  );

  const mutedConvRef = useRef<Set<string>>(new Set());
  mutedConvRef.current = useMemo(
    () => new Set((chats ?? []).filter((c) => c.muted).map((c) => c.id)),
    [chats],
  );
  const mutedChanRef = useRef<Set<string>>(new Set());
  mutedChanRef.current = useMemo(() => new Set(mutedChannelIds ?? []), [mutedChannelIds]);

  useEffect(() => {
    if (!userId || active.length === 0) return;
    const cleanups: Array<() => void> = [];

    active.forEach((conv, i) => {
      const timer = setTimeout(() => {
        const invalidate = () => {
          queryClient.invalidateQueries({ queryKey: ['unreadSummary', userId] });
          queryClient.invalidateQueries({ queryKey: ['myChats', userId] });
        };
        const unsub = subscribeBroadcastEvents(
          `sync:message-inbox-conv:${conv.id}:${conv.epoch}`,
          {
            invalidate,
            new_message: (payload: NewMessageBroadcastPayload) => {
              invalidate();
              const banner = buildMessageBanner(payload, userId, {
                mutedConversationIds: mutedConvRef.current,
                mutedChannelIds: mutedChanRef.current,
              });
              if (banner) publishNotificationInsert(banner);
            },
          },
        );
        cleanups.push(unsub);
      }, i * JOIN_STAGGER_MS);
      cleanups.push(() => clearTimeout(timer));
    });

    return () => cleanups.forEach((c) => c());
    // mute refs deliberately excluded — they are read live inside the handler.
  }, [userId, activeKey, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps
}
