import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { subscribeBroadcast } from '../../lib/realtime';
import {
  invalidateStudentContentQueries,
  refreshPermissionSensitiveStudentContent,
  shouldRecoverOnMobileForeground,
} from '../../lib/studentSynchronization';

/**
 * One mounted, student-only convergence point for Day 10E content lifecycle
 * invalidations. Broadcasts are opaque: this host only invalidates RLS-backed
 * queries, never adopts received data as state.
 */
export function StudentSynchronizationHost({ userId }: { userId?: string }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  /**
   * The opaque campus broadcast is the one signal that permissions may have
   * genuinely changed, so it keeps the CLEARING form: a narrowed audience or a
   * removal must not leave the previous payload visible.
   */
  const recover = useCallback(
    () => refreshPermissionSensitiveStudentContent(queryClient),
    [queryClient],
  );

  /**
   * Bugs 6 and 8 — navigating and foregrounding REFRESH, they do not wipe.
   *
   * Navigation and app-foreground used to run the same clearing path as the
   * broadcast above. `clearPermissionSensitiveStudentContent` resets every
   * student query root to `pending` AND empties the on-disk attachment cache,
   * so on this app that meant:
   *
   *   • every screen returned to — a conversation, a channel, a profile, a
   *     club — dropped its cached payload and showed a loader again, which is
   *     the "repeated loading every single time" in Bug 6;
   *   • every background→foreground reloaded the entire app's data;
   *   • avatars and other images had to be downloaded again after each
   *     navigation, which is why profile pictures vanished or arrived late.
   *
   * A screen transition is not evidence that anything changed. Invalidation
   * gives the same convergence — every active query refetches under current RLS
   * and anything the database no longer returns disappears as soon as that
   * lands — while cached content stays on screen and the image cache survives.
   */
  const refresh = useCallback(
    () => invalidateStudentContentQueries(queryClient),
    [queryClient],
  );

  useEffect(() => {
    let removeContentSync: (() => void) | null = null;
    let cancelled = false;

    const subscribe = async () => {
      if (!userId) return;
      const { data: universityId, error } = await supabase.rpc('my_sync_university_id');
      if (cancelled || error || typeof universityId !== 'string') return;
      removeContentSync = subscribeBroadcast(
        `sync:university:${universityId}`,
        'invalidate',
        recover,
        recover,
      );
    };

    void subscribe();
    return () => {
      cancelled = true;
      removeContentSync?.();
    };
  }, [recover, userId]);

  useEffect(() => {
    // An inactive persisted query can otherwise become visible before its next
    // normal stale-time window. Navigation always revalidates lifecycle state —
    // it just no longer discards what it is revalidating.
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (shouldRecoverOnMobileForeground(status)) refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return null;
}
