/**
 * The single app-wide notification host (rendered once, inside the query
 * provider): push wiring (handler, tap routing, tokens) plus the live unread
 * summary that feeds every badge and the app-icon count. Renders nothing.
 */
import { useAuthStore } from '@weglue/shared';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useUnreadSummary } from '../../hooks/useUnreadSummary';

export function PushNotificationsHost() {
  const { session } = useAuthStore();
  usePushNotifications();
  useUnreadSummary(session?.user.id);
  return null;
}
