import { useEffect, useRef } from 'react';
import { usePathname } from 'expo-router';
import { subscribeBroadcast } from '../lib/realtime';

/**
 * The account topic belongs only to its authenticated user. Its event contains
 * no access state; each receipt and successful reconnect runs my_access_state
 * again through the caller's canonical access check.
 */
export function useAccessSynchronization(
  userId: string | undefined,
  enabled: boolean,
  refreshAccess: () => Promise<void>,
): void {
  const pathname = usePathname();
  const refreshRef = useRef(refreshAccess);

  useEffect(() => {
    refreshRef.current = refreshAccess;
  }, [refreshAccess]);

  useEffect(() => {
    if (!enabled || !userId) return;
    return subscribeBroadcast(
      `sync:access:${userId}`,
      'invalidate',
      () => void refreshRef.current(),
      () => void refreshRef.current(),
    );
  }, [enabled, userId]);

  useEffect(() => {
    if (enabled && userId) void refreshRef.current();
  }, [enabled, pathname, userId]);
}
