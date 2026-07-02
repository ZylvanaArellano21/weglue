import { router } from 'expo-router';
import { getOrCreateDirectChat, getClubGroupConversationId } from '../services/chatService';

/**
 * Opens a chat by conversation id.
 * For group chats (club_group): navigates to the channel picker.
 * For direct chats: navigates directly to the DM thread.
 *
 * Used by every entry point in the app — do not duplicate this logic per screen.
 */
export function openChat(chatId: string): void {
  router.push(`/(tabs)/messages/${chatId}`);
}

/**
 * Opens (or creates) a 1:1 DM with the given user.
 * Creates the conversation server-side if it doesn't exist yet.
 * Navigates directly into the DM thread — does NOT route through the chat list.
 *
 * Used by: profile pages, club member lists, attendee lists, anywhere a message icon appears.
 */
export async function openDirectChatWith(otherUserId: string): Promise<void> {
  const conversationId = await getOrCreateDirectChat(otherUserId);
  router.push(`/(tabs)/messages/${conversationId}`);
}

/**
 * Opens the club_group conversation for a given club.
 * Used by: club profile, club header, anywhere a group chat icon appears.
 */
export async function openClubChat(clubId: string): Promise<void> {
  const conversationId = await getClubGroupConversationId(clubId);
  if (!conversationId) return;
  router.push(`/(tabs)/messages/${conversationId}`);
}

/**
 * Jumps to a specific message within a channel thread.
 * Used by: poll history in group chat info, any future "jump to message" feature.
 */
export function jumpToMessage(chatId: string, channelId: string, messageId: string): void {
  router.push({
    pathname: `/(tabs)/messages/${chatId}/${channelId}`,
    params: { jumpToMessageId: messageId },
  });
}
