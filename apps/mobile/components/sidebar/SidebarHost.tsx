/**
 * SidebarHost — the single mount point for the sidebar overlay.
 *
 * Mounted once at the root, as a sibling of the navigator (never a parent of
 * it). It owns two things:
 *
 *  1. WHEN the drawer is visible — one centralized piece of state, so two
 *     sidebars can never open, and a stale drawer can never survive a logout,
 *     an account deletion or a deep link into another screen.
 *
 *  2. Back-returns-to-the-sidebar. Opening a destination records the pathname
 *     the drawer was open over. We reopen it only once the user has actually
 *     left that route and then come back to it — which is exactly a Back (or an
 *     iOS swipe-back) out of the destination. The underlying screen was never
 *     unmounted, so the tab, the Posts/Events selection and the scroll position
 *     are still whatever they were.
 */
import { useEffect, useRef } from 'react';
import { usePathname } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { useSidebarStore } from '../../store/sidebarStore';
import { SidebarOverlay } from './SidebarOverlay';

export function SidebarHost() {
  const pathname = usePathname();
  const session = useAuthStore((s) => s.session);

  const isOpen = useSidebarStore((s) => s.isOpen);
  const reopenOverPathname = useSidebarStore((s) => s.reopenOverPathname);
  const reopen = useSidebarStore((s) => s.reopen);
  const reset = useSidebarStore((s) => s.reset);

  // Did we actually navigate AWAY from the origin yet? Without this the reopen
  // check would fire on the very render that arms it (the push has not committed
  // yet, so the pathname is still the origin) and the drawer would never close.
  const hasLeftOrigin = useRef(false);

  useEffect(() => {
    if (!reopenOverPathname) {
      hasLeftOrigin.current = false;
      return;
    }
    if (pathname !== reopenOverPathname) {
      hasLeftOrigin.current = true;
      return;
    }
    if (hasLeftOrigin.current) {
      hasLeftOrigin.current = false;
      reopen();
    }
  }, [pathname, reopenOverPathname, reopen]);

  // The authenticated tree is gone (logout, account deletion, an invalidated
  // session): drop every trace of sidebar state so it can never reappear over
  // Welcome or leak into the next account on this device. The shared teardown
  // also resets the store — this is the belt-and-braces path for sessions that
  // end without going through it (e.g. a refresh-token failure).
  useEffect(() => {
    if (!session) reset();
  }, [session, reset]);

  if (!session || !isOpen) return null;
  return <SidebarOverlay />;
}
