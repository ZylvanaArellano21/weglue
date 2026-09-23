import { useEffect, useRef } from 'react';
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
  const refreshRef = useRef(refreshAccess);

  useEffect(() => {
    refreshRef.current = refreshAccess;
  }, [refreshAccess]);

  useEffect(() => {
    if (!enabled || !userId) return;
    let hasSubscribed = false;
    return subscribeBroadcast(
      `sync:access:${userId}`,
      'invalidate',
      () => void refreshRef.current(),
      () => {
        // The root startup gate already performs the canonical first check.
        // Only a later SUBSCRIBED transition represents a reconnect that may
        // have missed an invalidation while the socket was unavailable.
        if (hasSubscribed) void refreshRef.current();
        hasSubscribed = true;
      },
    );
  }, [enabled, userId]);
}
