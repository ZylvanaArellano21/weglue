/**
 * Tracks which conversation/channel the user is LOOKING AT right now, so the
 * foreground push handler can silence banners for that exact thread (you
 * never get a system alert for the chat that's open on screen) while every
 * other thread still notifies normally.
 */
let activeConversationId: string | null = null;
let activeChannelId: string | null = null;

export function setActiveThread(conversationId: string | null, channelId: string | null = null): void {
  activeConversationId = conversationId;
  activeChannelId = channelId;
}

export function clearActiveThread(conversationId: string): void {
  // Only clear if this screen is still the active one (a push-navigation may
  // have replaced it before the old screen unmounted).
  if (activeConversationId === conversationId) {
    activeConversationId = null;
    activeChannelId = null;
  }
}

export function isViewingThread(conversationId?: unknown, channelId?: unknown): boolean {
  if (!activeConversationId || typeof conversationId !== 'string') return false;
  if (activeConversationId !== conversationId) return false;
  // Channel-scoped pushes only suppress when THAT channel is open; a push for
  // #events must still banner while Main chat is on screen.
  if (typeof channelId === 'string' && channelId.length > 0) {
    return activeChannelId === channelId;
  }
  return activeChannelId === null;
}
