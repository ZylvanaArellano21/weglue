import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { usePathname } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { subscribeBroadcast } from '../../lib/realtime';
import { invalidateStudentContentQueries } from '../../lib/studentSynchronization';

/**
 * One mounted, student-only convergence point for Day 10E content lifecycle
 * invalidations. Broadcasts are opaque: this host only invalidates RLS-backed
 * queries, never adopts received data as state.
 */
export function StudentSynchronizationHost({ userId }: { userId?: string }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const recover = useCallback(
    () => invalidateStudentContentQueries(queryClient),
    [queryClient],
  );

  useEffect(() => {
    let removeContentSync: (() => void) | null = null;
    let cancelled = false;

    const subscribe = async () => {
      if (!userId) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('university_id')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled || error || !data?.university_id) return;
      removeContentSync = subscribeBroadcast(
        `sync:university:${data.university_id}`,
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
    // normal stale-time window. Navigation always revalidates lifecycle state.
    recover();
  }, [pathname, recover]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') recover();
    });
    return () => subscription.remove();
  }, [recover]);

  return null;
}
