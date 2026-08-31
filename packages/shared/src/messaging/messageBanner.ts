/**
 * Foreground message-banner mapping, shared by mobile and web.
 *
 * Previously each app had its own `useRealtimeMessageBanners` hook that opened a
 * broad `messages` INSERT postgres_changes subscription (`sender_id=neq.<uid>`,
 * which matches every other user's messages) and then did two follow-up reads
 * (`conversations` + `profiles`) per delivered row to build the banner. On the
 * free-plan Realtime service that broad subscription is the dominant per-change
 * RLS-evaluation cost at 50 active users.
 *
 * It is replaced by a server-authored private broadcast on the existing
 * `sync:message-inbox:<uid>` topic: a `messages` AFTER INSERT trigger resolves
 * the sender name and conversation type once and emits a `new_message` event
 * carrying everything the banner needs. This function turns that payload into
 * the banner row with no client reads. The payload is presentation-only — it is
 * never treated as authorization, and canonical message state is still fetched
 * through the app's normal RLS-governed queries.
 */

export type NewMessageBroadcastPayload = {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  /** `messages.message_type` — 'text' | 'image' | 'video' | 'file' | 'poll' | 'shared_event' | 'shared_post' | … */
  message_type: string | null;
  /** Server-truncated `messages.content` (<= 140 chars). Null for typed attachments. */
  preview: string | null;
  sender_name: string | null;
  /** `conversations.type` — 'direct' | 'group' | (anything else = a club chat). */
  conversation_type: string | null;
  channel_id?: string | null;
};

export type MessageBannerType = "dm_message" | "group_message" | "club_chat_message";

export type MessageBanner = {
  id: string;
  type: MessageBannerType;
  message: string;
  actor_id: string;
  user_id: string;
  route: Record<string, unknown>;
};

/** Emoji stand-ins for messages with no text body, matching the old hook. */
const PREVIEW_BY_TYPE: Record<string, string> = {
  image: "📷 Photo",
  video: "🎬 Video",
  file: "📎 File",
  poll: "📊 Started a poll",
  shared_event: "📅 Shared an event",
  shared_post: "🖼️ Shared a post",
};

export function messageBannerType(conversationType: string | null | undefined): MessageBannerType {
  if (conversationType === "direct") return "dm_message";
  if (conversationType === "group") return "group_message";
  return "club_chat_message";
}

export function messageBannerPreview(
  messageType: string | null | undefined,
  preview: string | null | undefined,
): string {
  return (
    (messageType && PREVIEW_BY_TYPE[messageType]) ||
    (preview ?? "New message").slice(0, 140)
  );
}

export type MessageBannerMuteContext = {
  /** Conversation ids the viewer has muted (`conversation_participants.muted_at`). */
  mutedConversationIds?: ReadonlySet<string> | null;
  /** Channel ids the viewer has muted (`channel_mutes`). */
  mutedChannelIds?: ReadonlySet<string> | null;
};

/**
 * Build the foreground banner row for an incoming message, or `null` when it
 * must not be shown:
 *   • missing identifiers,
 *   • the viewer is the sender (the per-user trigger already excludes the
 *     sender; a conversation-scoped broadcast reaches the sender's own client,
 *     so this is load-bearing there),
 *   • the viewer has muted the conversation or the channel — for a
 *     conversation-scoped broadcast the server sends one payload to every
 *     connected member, so mute enforcement is client-side here (the per-user
 *     path is still server-filtered by `muted_at` / `channel_mutes`).
 */
export function buildMessageBanner(
  payload: NewMessageBroadcastPayload | null | undefined,
  userId: string,
  mute?: MessageBannerMuteContext,
): MessageBanner | null {
  if (!payload || !payload.message_id || !payload.conversation_id || !payload.sender_id) return null;
  if (payload.sender_id === userId) return null;
  if (mute?.mutedConversationIds?.has(payload.conversation_id)) return null;
  if (payload.channel_id && mute?.mutedChannelIds?.has(payload.channel_id)) return null;

  const senderName = payload.sender_name?.trim() || "Someone";
  const preview = messageBannerPreview(payload.message_type, payload.preview);

  return {
    id: payload.message_id,
    type: messageBannerType(payload.conversation_type),
    message: `${senderName}: ${preview}`,
    actor_id: payload.sender_id,
    user_id: userId,
    route: {
      screen: "chat",
      chatId: payload.conversation_id,
      ...(payload.channel_id ? { channelId: payload.channel_id } : {}),
    },
  };
}
