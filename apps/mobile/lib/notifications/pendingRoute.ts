/**
 * Logged-out push taps: the tapped route is parked here (validated first),
 * survives the login flow, and is consumed exactly once after the SAME
 * intended recipient authenticates. A different account logging in discards
 * it — one user's notification can never open inside another's session.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { validateNotificationRoute, type ValidatedRoute } from './routes';

const KEY = 'weglue-pending-notification-route-v1';

type StoredPendingRoute = {
  route: ValidatedRoute;
  /** Inbox pushes carry the notification row id; after login the row is
   * fetched under RLS — readable ⇒ the signed-in user IS the recipient. */
  notificationId: string | null;
  storedAt: number;
};

const MAX_AGE_MS = 30 * 60 * 1000; // stale after 30 minutes

export async function storePendingRoute(rawRoute: unknown, notificationId: string | null): Promise<void> {
  const route = validateNotificationRoute(rawRoute);
  if (!route) return;
  try {
    const payload: StoredPendingRoute = { route, notificationId, storedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Losing the pending route only costs a manual tap after login.
  }
}

/** One-shot: returns the fresh pending route (recipient check is the
 * caller's job via notificationId + RLS). */
export async function consumePendingRoute(): Promise<{
  route: ValidatedRoute;
  notificationId: string | null;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(KEY);
    const stored = JSON.parse(raw) as StoredPendingRoute;
    if (Date.now() - stored.storedAt > MAX_AGE_MS) return null;
    // Re-validate: AsyncStorage contents are as untrusted as the push itself.
    const route = validateNotificationRoute({ ...stored.route, ...(stored.route.params ?? {}) });
    if (!route) return null;
    return { route, notificationId: stored.notificationId ?? null };
  } catch {
    return null;
  }
}
