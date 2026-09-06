/**
 * Notification route allowlist — the ONLY bridge between a notification's
 * `route` payload (from the DB / a push) and app navigation.
 *
 * Push payloads are untrusted input: a route must name one of the screens
 * below with a UUID param, or it is rejected. Raw paths are never accepted,
 * so a malicious/garbled payload can never navigate to arbitrary URLs or
 * external targets.
 */
import type { Router } from 'expo-router';

export type NotificationRoute = {
  screen: string;
  [key: string]: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteSpec = {
  /** Which payload key carries the target id (validated as a UUID). */
  param?: string;
  build: (params: Record<string, string>) => { pathname: string; params?: Record<string, string> };
};

// screen → how to open it. Params are re-validated even though the server
// builds these payloads — a push relay is still an untrusted channel.
const ROUTE_SPECS: Record<string, RouteSpec> = {
  post: {
    param: 'postId',
    build: (p) => ({ pathname: '/post/[postId]', params: { postId: p.postId } }),
  },
  event: {
    param: 'eventId',
    build: (p) => ({ pathname: '/home/event-detail', params: { eventId: p.eventId } }),
  },
  club: {
    param: 'clubId',
    build: (p) => ({ pathname: '/club/[clubId]', params: { clubId: p.clubId } }),
  },
  profile: {
    param: 'userId',
    build: (p) => ({ pathname: '/profile/[userId]', params: { userId: p.userId } }),
  },
  chat: {
    param: 'chatId',
    build: (p) => ({ pathname: '/chat/[chatId]', params: { chatId: p.chatId } }),
  },
  notifications: {
    build: () => ({ pathname: '/home/notifications' }),
  },
  notificationActors: {
    param: 'notificationId',
    build: (p) => ({ pathname: '/home/notification-actors', params: { notificationId: p.notificationId } }),
  },
  // A new public app version is available. Unlike every other type, this is
  // not a notification-content item, so it deliberately does NOT get the
  // Notifications-inbox underlay in navigateToNotificationTarget below — it
  // opens the Update screen directly, where "Update now" opens the store.
  update: {
    build: () => ({ pathname: '/account-center/update' }),
  },
};

export type ValidatedRoute = {
  screen: string;
  pathname: string;
  params?: Record<string, string>;
  /** For chat routes: the exact channel to open inside the conversation. */
  channelId?: string;
};

/** Returns a safe, navigable route or null — never throws on bad input. */
export function validateNotificationRoute(raw: unknown): ValidatedRoute | null {
  if (!raw || typeof raw !== 'object') return null;
  const route = raw as NotificationRoute;
  const spec = ROUTE_SPECS[String(route.screen)];
  if (!spec) return null;

  const params: Record<string, string> = {};
  if (spec.param) {
    const value = route[spec.param];
    if (typeof value !== 'string' || !UUID_RE.test(value)) return null;
    params[spec.param] = value;
  }

  const built = spec.build(params);
  const validated: ValidatedRoute = { screen: String(route.screen), ...built };

  // Exact-channel targeting for club chats: open the channel screen itself.
  if (route.screen === 'chat' && typeof route.channelId === 'string' && UUID_RE.test(route.channelId)) {
    validated.channelId = route.channelId;
    validated.pathname = '/chat/[chatId]/[channelId]';
    validated.params = { ...validated.params, channelId: route.channelId };
  }

  // Exact-message targeting for a message reply (migration 129): the chat
  // screen scrolls to and pulses jumpToMessageId.
  if (route.screen === 'chat' && typeof route.messageId === 'string' && UUID_RE.test(route.messageId)) {
    validated.params = { ...validated.params, jumpToMessageId: route.messageId };
  }
  return validated;
}

/**
 * Open a notification target from a PUSH tap. The Notifications inbox is
 * placed underneath the destination so Back always returns to Notifications
 * (same contract as tapping a row inside the inbox).
 */
export function navigateToNotificationTarget(router: Router, route: ValidatedRoute): void {
  if (route.screen === 'update') {
    // Land on the Update screen itself (not the store): it shows what's
    // available and its "Update now" button opens the correct App Store /
    // Play Store listing. No Notifications-inbox underlay — this is not an
    // inbox item (notification_types.in_app = false, migration 090).
    router.push('/account-center/update');
    return;
  }
  if (route.pathname === '/home/notifications') {
    router.push('/home/notifications');
    return;
  }
  router.push('/home/notifications');
  router.push({ pathname: route.pathname as never, params: route.params as never });
}
