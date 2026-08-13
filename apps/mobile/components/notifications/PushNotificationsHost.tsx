/**
 * The single app-wide notification host (rendered once, inside the query
 * provider): push wiring (handler, tap routing, tokens), the live unread
 * summary that feeds every badge and the app-icon count, and the foreground
 * notification banner overlay (correction 3) — the sole visible presentation
 * while the app is active, layered above the navigator the same way
 * SidebarHost/LeaveClubHost are.
 */
import { useAuthStore } from '@weglue/shared';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useUnreadSummary } from '../../hooks/useUnreadSummary';
import { useRealtimeMessageBanners } from '../../hooks/useRealtimeMessageBanners';
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
  return <ForegroundNotificationBanner />;
}
