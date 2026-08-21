/**
 * The single app-wide notification host (rendered once, inside the query
 * provider): push wiring (handler, tap routing, tokens), the live unread
 * summary that feeds every badge and the app-icon count, and the foreground
 * notification banner overlay, layered above the navigator the same way
 * SidebarHost/LeaveClubHost are.
 *
 * The banner overlay only renders while OS notification permission is NOT
 * granted — in that state native presentation is impossible (foreground or
 * background), so it is the sole presentation for that population. Once
 * permission is granted, the real native OS banner (wired in
 * usePushNotifications.ts) is the only thing shown, foreground or
 * backgrounded alike.
 */
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuthStore } from '@weglue/shared';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useUnreadSummary } from '../../hooks/useUnreadSummary';
import { useRealtimeMessageBanners } from '../../hooks/useRealtimeMessageBanners';
import { useBlockSynchronization } from '../../hooks/useBlocking';
import { getPermissionState } from '../../lib/notifications/permissions';
import { ForegroundNotificationBanner } from './ForegroundNotificationBanner';

export function PushNotificationsHost() {
  const { session } = useAuthStore();
  usePushNotifications();
  useUnreadSummary(session?.user.id);
  // Push-only types (dm_message/group_message/club_chat_message) never
  // reach the notifications-table-driven banner feed below — this is their
  // own realtime source (see useRealtimeMessageBanners for why it can't
  // reuse the existing per-conversation thread sync).
  useRealtimeMessageBanners(session?.user.id);
  // Must live inside the query provider — this is exactly why it moved here
  // rather than being called from RootLayout's own body, which executes
  // outside the PersistQueryClientProvider it needs.
  useBlockSynchronization(session?.user.id);

  const [permissionGranted, setPermissionGranted] = useState(true);
  useEffect(() => {
    const check = () => void getPermissionState().then((state) => setPermissionGranted(state === 'granted'));
    check();
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active' && Platform.OS !== 'web') check();
    });
    return () => sub.remove();
  }, []);

  if (permissionGranted) return null;
  return <ForegroundNotificationBanner />;
}
