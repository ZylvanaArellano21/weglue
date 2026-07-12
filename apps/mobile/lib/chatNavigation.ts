import { router } from 'expo-router';
import { getOrCreateDirectChat, getClubChatTarget } from '../services/chatService';
import { reopenClubChat } from '../services/messagingService';

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
 * Club Members/Officers conversations land on the full-screen conversation hub
 * (Bug 1) — the user picks Main chat or a hashtag there. Direct chats / custom
 * groups render their single thread. One push in all cases, so Back returns
 * exactly to the previous screen (Bug 16).
 */
export function openChat(chatId: string, preview?: ChatPreviewParams): void {
  router.push({
    pathname: `/chat/${chatId}`,
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
  router.push(`/chat/${conversationId}` as any);
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
  // Restore participation server-side FIRST (Bug 8): if the user previously
  // left this club chat, reopen_club_chat re-adds their participant row and
  // clears hidden_at (validating current club role), so the conversation and
  // its full history return to the Group section of the Message tab and they
  // land in the real thread instead of the non-member preview. Idempotent and
  // never duplicates a participant. A role failure (e.g. not a member) is
  // swallowed so the non-member preview still renders.
  try {
    await reopenClubChat(clubId, type);
  } catch {
    // Not authorized to participate — fall through to plain navigation.
  }

  const target = await getClubChatTarget(clubId, type);
  if (!target) return;

  // Land on the conversation hub (Bug 1). Back returns straight to the club
  // profile because this is a single push.
  router.push({
    pathname: `/chat/${target.conversationId}`,
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
    pathname: `/chat/${chatId}/${channelId}` as any,
    params: { jumpToMessageId: messageId },
  });
}
