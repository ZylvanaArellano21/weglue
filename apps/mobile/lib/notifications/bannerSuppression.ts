/**
 * Correction 3's exact-destination suppression decision, extracted from
 * ForegroundNotificationBanner so it is independently testable. Mirrors the
 * four buckets: the active conversation, exact post, exact event, or the
 * directly relevant active Home surface (everything else, while Home is the
 * focused tab).
 */
import type { ValidatedRoute } from './routes';
import { isViewingThread } from './activeThread';
import { isViewingDestination } from './activeDestination';

export function isDestinationOpen(route: ValidatedRoute | null): boolean {
  if (!route) return isViewingDestination('home');
  if (route.screen === 'chat') {
    const chatId = typeof route.params?.chatId === 'string' ? route.params.chatId : undefined;
    return isViewingThread(chatId, route.channelId);
  }
  if (route.screen === 'post') {
    const postId = typeof route.params?.postId === 'string' ? route.params.postId : undefined;
    return isViewingDestination('post', postId);
  }
  if (route.screen === 'event') {
    const eventId = typeof route.params?.eventId === 'string' ? route.params.eventId : undefined;
    return isViewingDestination('event', eventId);
  }
  // club, profile, notifications, or anything without a dedicated detail
  // screen: the "directly relevant active Home surface" bucket.
  return isViewingDestination('home');
}
