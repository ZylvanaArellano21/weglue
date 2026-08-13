"use client";

/**
 * Correction 3 fix (found during live QA): dm_message/group_message/
 * club_chat_message are push-only registry types (046) — they never insert
 * a `notifications` row, so useRealtimeNotifications' INSERT feed
 * (bannerBus) never sees them, and web has no native-banner fallback at
 * all. Mirrors apps/mobile/hooks/useRealtimeMessageBanners.ts — its own
 * realtime feed (messages INSERT, RLS-scoped) rather than the existing
 * per-conversation thread sync (`sync:message:<conversationId>`, migration
 * 067), which is an opaque refetch ping with no content and no app-wide
 * "all my conversations" topic.
 */
import { useEffect } from "react";
import { getSupabaseBrowser } from "../supabase-browser";
import { createSafeChannel, removeSafeChannel } from "../realtime";
import { publishNotificationInsert, type BannerNotificationRow } from "../notifications/bannerBus";

const PREVIEW_BY_TYPE: Record<string, string> = {
  image: "📷 Photo",
  video: "🎬 Video",
  file: "📎 File",
  poll: "📊 Started a poll",
  shared_event: "📅 Shared an event",
  shared_post: "🖼️ Shared a post",
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  message_type: string | null;
  channel_id: string | null;
  deleted_at: string | null;
};

export function useRealtimeMessageBanners(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;

    const channel = createSafeChannel(`message-banners:${userId}`, [
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `sender_id=neq.${userId}`,
        callback: (payload: { new: MessageRow | null }) => {
          const row = payload.new;
          if (!row || row.deleted_at) return;

          void (async () => {
            const supabase = getSupabaseBrowser();
            const [{ data: conv }, { data: sender }] = await Promise.all([
              supabase.from("conversations").select("type").eq("id", row.conversation_id).maybeSingle(),
              supabase.from("profiles").select("username, full_name").eq("id", row.sender_id).maybeSingle(),
            ]);
            if (!conv) return; // RLS already filtered the row itself; this is just missing metadata

            const senderName =
              (sender && ((sender as any).full_name?.trim() || (sender as any).username)) || "Someone";
            const preview =
              (row.message_type && PREVIEW_BY_TYPE[row.message_type]) ||
              (row.content ?? "New message").slice(0, 140);

            const type =
              (conv as any).type === "direct"
                ? "dm_message"
                : (conv as any).type === "group"
                  ? "group_message"
                  : "club_chat_message";

            const bannerRow: BannerNotificationRow = {
              id: row.id,
              type,
              message: `${senderName}: ${preview}`,
              actor_id: row.sender_id,
              user_id: userId,
              route: {
                screen: "chat",
                chatId: row.conversation_id,
                ...(row.channel_id ? { channelId: row.channel_id } : {}),
              },
            };
            publishNotificationInsert(bannerRow);
          })();
        },
      },
    ]);

    return () => removeSafeChannel(channel);
  }, [userId]);
}
