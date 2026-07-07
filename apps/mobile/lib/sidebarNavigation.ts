import type { Router } from 'expo-router';
import { supabase } from './supabase';

// ─── Sidebar Item Types ───────────────────────────────────────────────────────

export type SidebarItemKey =
  | 'profile'
  | 'savedEvents'
  | 'interests'
  | 'accountCenter'
  | 'privacyCenter'
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

// ─── Build sidebar items with navigation callbacks ────────────────────────────
//
// Call this inside a component that has access to expo-router's useRouter().
// Pass closeSidebar so each action closes the drawer before navigating.
//
export function buildSidebarItems(
  router: Router,
  closeSidebar: () => void,
): SidebarItem[] {
  function navigate(path: string) {
    closeSidebar();
    router.push(path as any);
  }

  return [
    {
      key: 'profile',
      label: 'Your Profile',
      icon: 'person-outline',
      onPress: () => navigate('/profile/own'),
    },
    {
      key: 'savedEvents',
      label: 'Saved Events',
      icon: 'bookmark-outline',
      onPress: () => navigate('/saved-events'),
    },
    {
      key: 'interests',
      label: 'Interests',
      icon: 'heart-outline',
      onPress: () => {
        closeSidebar();
        // Existing edit flow: interests survey → activities survey
        router.push({
          pathname: '/profile/edit-interests',
          params: { continueTo: 'activities' },
        } as any);
      },
    },
    {
      key: 'accountCenter',
      label: 'Account Center',
      icon: 'settings-outline',
      onPress: () => navigate('/account-center'),
    },
    {
      key: 'privacyCenter',
      label: 'Privacy Center',
      icon: 'shield-outline',
      onPress: () => navigate('/privacy-center'),
    },
    {
      key: 'help',
      label: 'Help',
      icon: 'help-circle-outline',
      onPress: () => navigate('/home/help'),
    },
    {
      key: 'terms',
      label: 'Terms of Service',
      icon: 'document-text-outline',
      onPress: () => navigate('/home/terms'),
    },
    {
      key: 'logout',
      label: 'Log Out',
      icon: 'log-out-outline',
      destructive: true,
      onPress: async () => {
        closeSidebar();
        await supabase.auth.signOut();
      },
    },
  ];
}
