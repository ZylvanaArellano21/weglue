/**
 * Tiny pub/sub feeding the foreground banner UI from the session's always-on
 * realtime subscriptions, without any banner-specific subscription of its own:
 *   • useRealtimeNotifications (`notifications:<uid>`, mounted in
 *     (tabs)/_layout.tsx) publishes every notification-table INSERT here;
 *   • useUnreadSummary (`sync:message-inbox:<uid>`, mounted in
 *     PushNotificationsHost) publishes a row built from each `new_message`
 *     broadcast payload for push-only message types.
 * ForegroundNotificationBanner is the sole subscriber.
 */
export type BannerNotificationRow = {
  id: string;
  type: string;
  message: string | null;
  actor_id: string | null;
  user_id: string;
  route: Record<string, unknown> | null;
};

type Listener = (row: BannerNotificationRow) => void;

const listeners = new Set<Listener>();

export function publishNotificationInsert(row: BannerNotificationRow): void {
  listeners.forEach((listener) => listener(row));
}

export function subscribeNotificationInsert(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
