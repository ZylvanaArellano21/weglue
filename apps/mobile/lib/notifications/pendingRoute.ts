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

/**
 * Set by app/_layout.tsx exactly when it observes a real signed-out ->
 * signed-in transition during THIS process's lifetime (never merely because
 * an already-persisted session was found at cold launch). This is process-
 * lifetime state, not persisted: it resets to false on every fresh launch, so
 * an ordinary cold launch can never masquerade as a genuine sign-in just
 * because a session already exists.
 *
 * Deliberately NOT derived from any single Supabase auth event name (e.g.
 * SIGNED_IN) — Supabase can emit that event while merely confirming an
 * already-restored session, not only on a real login. See _layout.tsx's
 * observeSessionForSignInDetection for the actual transition detection.
 */
let hasGenuineSignInThisSession = false;

export function markGenuineSignIn(): void {
  hasGenuineSignInThisSession = true;
}

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
 * caller's job via notificationId + RLS). Returns null WITHOUT touching
 * storage unless a genuine sign-in has happened this session — an ordinary
 * cold launch with an already-authenticated persisted session must never
 * consume (and thereby discard) a route that is still waiting for its real
 * recipient to actually sign in, possibly on a later launch. */
export async function consumePendingRoute(): Promise<{
  route: ValidatedRoute;
  notificationId: string | null;
} | null> {
  if (!hasGenuineSignInThisSession) return null;
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
