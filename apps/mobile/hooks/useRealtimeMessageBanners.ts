/**
 * Correction 3 fix (found during live QA): dm_message/group_message/
 * club_chat_message are push-only registry types (046) — they never insert
 * a `notifications` row, so useRealtimeNotifications' INSERT feed
 * (bannerBus) never sees them. Before this hook existed, that was masked by
 * the native OS banner showing delivered pushes while foregrounded — but
 * usePushNotifications.ts now unconditionally suppresses that native banner
 * while active (the custom banner is meant to be the sole presentation),
 * which left incoming messages completely silent for a foregrounded user
 * with no OS permission yet (exactly the population Fix 1/3 exist for).
 *
 * Fixes it with its own realtime feed — messages INSERT, RLS-scoped (same
 * "participants can read active" policy the chat screen relies on) — rather
 * than reusing the existing chat-thread sync (`sync:message:<conversationId>`,
 * migration 067), which is an opaque per-conversation refetch ping with no
 * content and no app-wide "all my conversations" topic. This is therefore a
 * genuinely new topic, not a second subscription to one that already exists.
 */
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { createSafeChannel, removeSafeChannel } from '../lib/realtime';
import { publishNotificationInsert } from '../lib/notifications/bannerBus';

const PREVIEW_BY_TYPE: Record<string, string> = {
  image: '📷 Photo',
  video: '🎬 Video',
  file: '📎 File',
  poll: '📊 Started a poll',
  shared_event: '📅 Shared an event',
  shared_post: '🖼️ Shared a post',
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
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `sender_id=neq.${userId}`,
        callback: (payload) => {
          const row = payload.new as MessageRow | null;
          if (!row || row.deleted_at) return;

          void (async () => {
            const [{ data: conv }, { data: sender }] = await Promise.all([
              supabase.from('conversations').select('type').eq('id', row.conversation_id).maybeSingle(),
              supabase.from('profiles').select('username, full_name').eq('id', row.sender_id).maybeSingle(),
            ]);
            if (!conv) return; // not a conversation this user can see (RLS already filtered the row itself)

            const senderName =
              (sender && (sender.full_name?.trim() || sender.username)) || 'Someone';
            const preview =
              (row.message_type && PREVIEW_BY_TYPE[row.message_type]) ||
              (row.content ?? 'New message').slice(0, 140);

            const type =
              conv.type === 'direct' ? 'dm_message' : conv.type === 'group' ? 'group_message' : 'club_chat_message';

            publishNotificationInsert({
              id: row.id,
              type,
              message: `${senderName}: ${preview}`,
              actor_id: row.sender_id,
              user_id: userId,
              route: {
                screen: 'chat',
                chatId: row.conversation_id,
                ...(row.channel_id ? { channelId: row.channel_id } : {}),
              },
            });
          })();
        },
      },
    ]);

    return () => removeSafeChannel(channel);
  }, [userId]);
}
