import type { Router } from 'expo-router';
import { useSidebarStore } from '../store/sidebarStore';

// ─── Sidebar Item Types ───────────────────────────────────────────────────────

export type SidebarItemKey =
  | 'profile'
  | 'savedEvents'
  | 'interests'
  | 'accountCenter'
  | 'notifications'
  | 'privacyCenter'
  | 'update'
  | 'help'
  | 'terms'
  | 'logout';

export interface SidebarItem {
  key: SidebarItemKey;
  label: string;
  icon: string; // Ionicons name
  onPress: () => void;
  destructive?: boolean;
}

export interface SidebarActionHandlers {
  // Help opens the device mail composer (with a copyable fallback) and Log Out
  // shows a confirmation modal first — both owned by SidebarOverlay, which
  // hosts the modals. Navigation-only items stay here.
  onHelp: () => void;
  onLogout: () => void;
}

// ─── The one way an internal sidebar destination is opened ────────────────────
//
// Closes the overlay and pushes onto the normal opaque root stack, so the
// destination owns the whole window (no transparent-modal container wrapping
// it), while `openDestination` arms the return so Back reopens the drawer over
// the same underlying screen. Every internal destination goes through here —
// there are no per-screen Back handlers.
//
export function openSidebarDestination(
  router: Router,
  fromPathname: string,
  href: Parameters<Router['push']>[0],
): void {
  useSidebarStore.getState().openDestination(fromPathname);
  router.push(href);
}

// ─── Build sidebar items with navigation callbacks ────────────────────────────

export function buildSidebarItems(
  router: Router,
  fromPathname: string,
  handlers: SidebarActionHandlers,
): SidebarItem[] {
  const go = (href: Parameters<Router['push']>[0]) => () =>
    openSidebarDestination(router, fromPathname, href);

  return [
    {
      key: 'profile',
      label: 'Your Profile',
      icon: 'person-outline',
      onPress: go('/profile/own'),
    },
    {
      key: 'savedEvents',
      label: 'Saved Events',
      icon: 'bookmark-outline',
      onPress: go('/saved-events'),
    },
    {
      key: 'interests',
      label: 'Interests',
      icon: 'heart-outline',
      // Existing edit flow: interests survey → activities survey → results.
      // Back before Save returns here (the drawer), like any other destination;
      // completing Save and tapping "See my matches" clears the pending return
      // so Home Events is the final stop.
      onPress: go({
        pathname: '/profile/edit-interests',
        params: { continueTo: 'activities' },
      } as any),
    },
    {
      key: 'accountCenter',
      label: 'Account Center',
      icon: 'settings-outline',
      onPress: go('/account-center'),
    },
    {
      key: 'notifications',
      label: 'Notifications',
      icon: 'notifications-outline',
      onPress: go('/account-center/notifications'),
    },
    {
      key: 'privacyCenter',
      label: 'Privacy Center',
      icon: 'shield-outline',
      onPress: go('/privacy-center'),
    },
    {
      key: 'update',
      label: 'Update',
      icon: 'download-outline',
      onPress: go('/account-center/update'),
    },
    {
      key: 'help',
      label: 'Help',
      icon: 'help-circle-outline',
      // External-app exception: launches the device mail composer, never an
      // internal screen, so it neither closes the drawer nor pushes a route.
      onPress: handlers.onHelp,
    },
    {
      key: 'terms',
      label: 'Terms & Conditions',
      icon: 'document-text-outline',
      onPress: go('/home/terms'),
    },
    {
      key: 'logout',
      label: 'Log Out',
      icon: 'log-out-outline',
      destructive: true,
      onPress: handlers.onLogout,
    },
  ];
}
