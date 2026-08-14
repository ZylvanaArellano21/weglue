/**
 * Tiny pub/sub bridging the ONE existing `notifications:<userId>` realtime
 * subscription (owned by useRealtimeNotifications, mounted once in
 * app/providers.tsx's SessionRealtimeHub) to the foreground banner UI,
 * without opening a second subscription to the same topic. Mirrors
 * apps/mobile/lib/notifications/bannerBus.ts exactly.
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
