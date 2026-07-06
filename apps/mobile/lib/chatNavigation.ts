import { router } from 'expo-router';
import { getOrCreateDirectChat, getClubGroupConversationId, getClubOfficerConversationId } from '../services/chatService';

// Module-level map persists across navigations within an app session.
// Tracks the last channel the user was in per conversation.
const lastVisitedChannelMap = new Map<string, string>();

export function recordChannelVisit(conversationId: string, channelId: string): void {
  lastVisitedChannelMap.set(conversationId, channelId);
}

export function getLastVisitedChannel(conversationId: string): string | undefined {
  return lastVisitedChannelMap.get(conversationId);
}

/** Basic conversation facts the chat list already knows. Passed as route
 * params so the chat screen renders its header and starts the channel/message
 * queries immediately instead of waiting for the details fetch. */
export interface ChatPreviewParams {
  type?: string;
  clubId?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

/**
 * Opens a chat by conversation id.
 * Group chats: auto-navigate to last-visited or default channel (bypasses channel picker).
 * Direct chats: navigates directly to the DM thread.
 */
export function openChat(chatId: string, preview?: ChatPreviewParams): void {
  router.push({
    pathname: `/(tabs)/messages/${chatId}`,
    params: {
      ptype: preview?.type ?? '',
      pclub: preview?.clubId ?? '',
      pname: preview?.name ?? '',
      pavatar: preview?.avatarUrl ?? '',
    },
  } as any);
}

/**
 * Opens (or creates) a 1:1 DM with the given user.
 * Creates the conversation server-side if it doesn't exist yet.
 */
export async function openDirectChatWith(otherUserId: string): Promise<void> {
  const conversationId = await getOrCreateDirectChat(otherUserId);
  router.push(`/(tabs)/messages/${conversationId}` as any);
}

/**
 * Opens the club_group conversation for a given club.
 */
export async function openClubChat(clubId: string): Promise<void> {
  const conversationId = await getClubGroupConversationId(clubId);
  if (!conversationId) return;
  router.push(`/(tabs)/messages/${conversationId}` as any);
}

/**
 * Opens the officer_chat conversation for a given club.
 */
export async function openOfficerChat(clubId: string): Promise<void> {
  const conversationId = await getClubOfficerConversationId(clubId);
  if (!conversationId) return;
  router.push(`/(tabs)/messages/${conversationId}` as any);
}

/**
 * Jumps to a specific message within a channel thread.
 */
export function jumpToMessage(chatId: string, channelId: string, messageId: string): void {
  router.push({
    pathname: `/(tabs)/messages/${chatId}/${channelId}` as any,
    params: { jumpToMessageId: messageId },
  });
}
