"use client";

/**
 * Web port of apps/mobile/hooks/useConversationBannerChannels.ts — migration
 * 105 conversation-scoped foreground-banner delivery for large conversations.
 *
 * DMs / small conversations deliver their `new_message` banner on the per-user
 * topic `sync:message-inbox:<uid>` (useUnreadSummary). When the backend sets
 * `conversations.banner_broadcast_active = true` the trigger switches to ONE
 * `new_message` on `sync:message-inbox-conv:<id>:<banner_epoch>`; this hook
 * holds that subscription for every such conversation the viewer is in.
 *
 * The client never learns the threshold — it subscribes purely from the
 * `banner_broadcast_active` / `banner_epoch` columns on the conversation list.
 * Mount once, next to useUnreadSummary (providers.tsx).
 */
import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buildMessageBanner, type NewMessageBroadcastPayload } from "@weglue/shared";
import { subscribeBroadcastEvents } from "../realtime";
import { publishNotificationInsert } from "../notifications/bannerBus";
import { getMyConversations, getMutedChannelIds } from "../messages/service";

const JOIN_STAGGER_MS = 180;

export function useConversationBannerChannels(userId: string | undefined) {
  const queryClient = useQueryClient();

  const { data: conversations } = useQuery({
    queryKey: ["messages", "conversations", userId, 30],
    queryFn: () => getMyConversations(userId!, 30),
    enabled: !!userId,
    staleTime: 15_000,
  });

  const { data: mutedChannelIds } = useQuery({
    queryKey: ["mutedChannelIds", userId],
    queryFn: () => getMutedChannelIds(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const active = useMemo(
    () =>
      (conversations ?? [])
        .filter((c) => c.banner_broadcast_active && c.banner_epoch != null)
        .map((c) => ({ id: c.id, epoch: c.banner_epoch as number })),
    [conversations],
  );
  const activeKey = useMemo(() => active.map((a) => `${a.id}:${a.epoch}`).sort().join(","), [active]);

  const mutedConvRef = useRef<Set<string>>(new Set());
  mutedConvRef.current = useMemo(
    () => new Set((conversations ?? []).filter((c) => c.muted).map((c) => c.id)),
    [conversations],
  );
  const mutedChanRef = useRef<Set<string>>(new Set());
  mutedChanRef.current = useMemo(() => new Set(mutedChannelIds ?? []), [mutedChannelIds]);

  useEffect(() => {
    if (!userId || active.length === 0) return;
    const cleanups: Array<() => void> = [];

    active.forEach((conv, i) => {
      const timer = setTimeout(() => {
        const invalidate = () => {
          void queryClient.invalidateQueries({ queryKey: ["unreadSummary", userId] });
          void queryClient.invalidateQueries({ queryKey: ["messages", "conversations", userId] });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mute refs read live
  }, [userId, activeKey, queryClient]);
}
