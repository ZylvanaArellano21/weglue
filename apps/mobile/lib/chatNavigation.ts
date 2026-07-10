import { router } from 'expo-router';
import { getOrCreateDirectChat, getClubChatTarget } from '../services/chatService';

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
  /** When known, group chats push straight into this channel thread. */
  defaultChannelId?: string | null;
}

/**
 * Opens a chat by conversation id.
 * Group chats with a known channel: ONE push straight into the thread — the
 * old push-then-replace redirect rendered an intermediate screen and slid two
 * chat screens side by side (the double-chat flicker).
 * Direct chats / unknown channel: the conversation screen resolves it.
 */
export function openChat(chatId: string, preview?: ChatPreviewParams): void {
  const isGroup = preview?.type === 'club_group' || preview?.type === 'officer_chat';
  const channelId = isGroup
    ? getLastVisitedChannel(chatId) ?? preview?.defaultChannelId ?? null
    : null;

  if (isGroup && channelId) {
    router.push({
      pathname: `/(tabs)/messages/${chatId}/${channelId}`,
      params: {
        pname: preview?.name ?? '',
        pavatar: preview?.avatarUrl ?? '',
      },
    } as any);
    return;
  }

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
 * Opens the club_group conversation for a given club — resolves the exact
 * conversation + channel first so exactly one screen is pushed (back returns
 * straight to the club profile) and the correct chat renders immediately.
 */
export async function openClubChat(clubId: string): Promise<void> {
  await openClubConversation(clubId, 'club_group');
}

/**
 * Opens the officer_chat conversation for a given club.
 */
export async function openOfficerChat(clubId: string): Promise<void> {
  await openClubConversation(clubId, 'officer_chat');
}

async function openClubConversation(
  clubId: string,
  type: 'club_group' | 'officer_chat',
): Promise<void> {
  const target = await getClubChatTarget(clubId, type);
  if (!target) return;

  const channelId = getLastVisitedChannel(target.conversationId) ?? target.channelId;

  if (channelId) {
    router.push({
      pathname: `/(tabs)/messages/${target.conversationId}/${channelId}`,
      params: {
        pname: target.name ?? '',
        pavatar: target.avatarUrl ?? '',
      },
    } as any);
    return;
  }

  router.push({
    pathname: `/(tabs)/messages/${target.conversationId}`,
    params: {
      ptype: type,
      pclub: clubId,
      pname: target.name ?? '',
      pavatar: target.avatarUrl ?? '',
    },
  } as any);
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
