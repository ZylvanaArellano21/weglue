/**
 * Logged-out push taps: stored routes must re-validate on consumption, expire,
 * and be one-shot — AsyncStorage contents are as untrusted as the push.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn(async (k: string) => void store.delete(k)),
  },
}));

import { consumePendingRoute, storePendingRoute } from '../pendingRoute';

const UUID = '123e4567-e89b-42d3-a456-426614174000';
const KEY = 'weglue-pending-notification-route-v1';

beforeEach(() => store.clear());

describe('pendingRoute', () => {
  it('stores a valid route and consumes it exactly once', async () => {
    await storePendingRoute({ screen: 'event', eventId: UUID }, 'notif-1');
    const first = await consumePendingRoute();
    expect(first?.route.pathname).toBe('/home/event-detail');
    expect(first?.notificationId).toBe('notif-1');
    expect(await consumePendingRoute()).toBeNull(); // one-shot
  });

  it('refuses to store a route that fails the allowlist', async () => {
    await storePendingRoute({ screen: 'evil', anything: UUID }, null);
    expect(store.size).toBe(0);
  });

  it('drops stale routes', async () => {
    await storePendingRoute({ screen: 'post', postId: UUID }, null);
    const raw = JSON.parse(store.get(KEY)!);
    raw.storedAt = Date.now() - 31 * 60 * 1000;
    store.set(KEY, JSON.stringify(raw));
    expect(await consumePendingRoute()).toBeNull();
  });

  it('re-validates tampered storage on consumption', async () => {
    await storePendingRoute({ screen: 'post', postId: UUID }, null);
    const raw = JSON.parse(store.get(KEY)!);
    raw.route.pathname = '/account-center';
    raw.route.screen = 'evil';
    store.set(KEY, JSON.stringify(raw));
    expect(await consumePendingRoute()).toBeNull();
  });
});
