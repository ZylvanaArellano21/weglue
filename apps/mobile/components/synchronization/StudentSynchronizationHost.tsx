import { useCallback, useEffect, useRef } from 'react';
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
// A navigation-triggered invalidation is belt-and-suspenders against a stale
// cached query resurfacing (staleTime + refetchOnMount already cover a
// genuinely stale one). Coalesce it so rapid tab-switching doesn't re-invalidate
// ~29 query roots on every hop — parity with STUDENT_NAV_INVALIDATE_MS in
// apps/web/app/providers.tsx, which already had this correction.
const STUDENT_NAV_INVALIDATE_MS = 10_000;

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
        // A RECEIVED broadcast is the one signal that permissions may have
        // genuinely changed — keep the clearing form.
        recover,
        // (Re)subscribing is NOT that signal: it fires on the initial mount and
        // again on every socket reconnect (a token-refresh re-auth, a network
        // blip, a return to the foreground). Recover a possibly-missed broadcast
        // with a BACKGROUND invalidation instead — same convergence, but cached
        // screens and the image cache stay put. Using `recover` here is what
        // made every reconnect wipe every open screen back to a loader (Bug 6),
        // for the same reason navigation and foregrounding already stopped
        // doing it above.
        refresh,
      );
    };

    void subscribe();
    return () => {
      cancelled = true;
      removeContentSync?.();
    };
  }, [recover, refresh, userId]);

  const firstPathRef = useRef(true);
  const lastNavInvalidateRef = useRef(0);
  useEffect(() => {
    // An inactive persisted query can otherwise become visible before its next
    // normal stale-time window. Navigation always revalidates lifecycle state —
    // it just no longer discards what it is revalidating.
    //
    // The first run is skipped: this host mounts once per authenticated
    // session with a freshly restored (or empty) query client, so on that pass
    // there is no cached query to revalidate — only the queries the screen
    // just started. Marking them stale here is not a stale-data guard, it is a
    // guaranteed double fetch of every student surface on first mount.
    if (firstPathRef.current) {
      firstPathRef.current = false;
      return;
    }
    // Coalesce bursts of navigation — parity with the web twin
    // (STUDENT_NAV_INVALIDATE_MS in apps/web/app/providers.tsx). A query that
    // genuinely went stale still refetches on remount (60s staleTime +
    // refetchOnMount); a real permission change still arrives unthrottled
    // through the opaque broadcast and the foreground-recovery path below. So
    // rapidly switching tabs no longer fires a 29-root invalidation per hop.
    if (Date.now() - lastNavInvalidateRef.current < STUDENT_NAV_INVALIDATE_MS) return;
    lastNavInvalidateRef.current = Date.now();
    refresh();
  }, [pathname, refresh]);

  /**
   * Fix 9 — a delivered push notification's banner makes iOS briefly report
   * `active -> inactive -> active` without the app ever truly backgrounding
   * (`background` is skipped). `shouldRecoverOnMobileForeground` only checks
   * the new status, so it fired `refresh()` — invalidating ~29 content query
   * roots app-wide — on that same banner blip. Since every message/photo/
   * event send generates a notification, this made ordinary activity from
   * ANY other student invalidate the whole app's content, which read as a
   * full reload. A real return from the background always passes through
   * `background` first; a banner blip never does, so track that transition
   * locally rather than trusting the current status alone.
   */
  const lastAppStateRef = useRef<string>(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (shouldRecoverOnMobileForeground(status) && lastAppStateRef.current === 'background') {
        refresh();
      }
      lastAppStateRef.current = status;
    });
    return () => subscription.remove();
  }, [refresh]);

  return null;
}
