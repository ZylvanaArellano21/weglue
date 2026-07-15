/**
 * The single app-wide push wiring (mounted once in the root layout).
 *
 *  • Foreground presentation: banners show unless the user is ALREADY looking
 *    at that exact thread/screen (no duplicate in-app + system alert).
 *  • Tap routing: background taps and cold-start taps both resolve through
 *    the route allowlist and land on the exact target with the Notifications
 *    inbox underneath (Back always returns to Notifications).
 *  • Logged-out taps: the validated route is parked and replayed only after
 *    the intended recipient signs in (verified via RLS on the notification
 *    row — an unreadable row means a different account, so it is dropped).
 *  • Token lifecycle: registers after permission+login, refreshes on app
 *    foreground (tokens rotate), and the tapped notification is marked read
 *    server-side once navigation begins.
 */
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@weglue/shared';
import { supabase } from '../lib/supabase';
import { ensureAndroidChannels } from '../lib/notifications/channels';
import { isViewingThread } from '../lib/notifications/activeThread';
import { registerPushTokenIfPermitted } from '../lib/notifications/registerPush';
import {
  navigateToNotificationTarget,
  validateNotificationRoute,
} from '../lib/notifications/routes';
import { consumePendingRoute, storePendingRoute } from '../lib/notifications/pendingRoute';

// Module-level: must exist before any notification arrives, even pre-render.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as Record<string, unknown> | undefined;
    const route = (data?.route ?? {}) as Record<string, unknown>;
    // Silence the banner for the thread that is open on screen right now.
    const suppress =
      route?.screen === 'chat' && isViewingThread(route.chatId, route.channelId);
    return {
      shouldShowBanner: !suppress,
      shouldShowList: !suppress,
      shouldPlaySound: !suppress,
      shouldSetBadge: true,
    };
  },
});

async function markNotificationRead(notificationId: unknown): Promise<void> {
  if (typeof notificationId !== 'string' || notificationId.length === 0) return;
  try {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .eq('read', false);
  } catch {
    // The inbox's mark-read paths will converge the state later.
  }
}

export function usePushNotifications(): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, isLoading } = useAuthStore();
  const userId = session?.user.id;

  // Survives re-renders: a cold-start response must be handled exactly once.
  const handledColdStart = useRef(false);

  const openFromPush = useRef<(data: Record<string, unknown> | undefined) => void>(() => {});
  openFromPush.current = (data: Record<string, unknown> | undefined) => {
    const route = validateNotificationRoute(data?.route);
    if (!route) return;
    const notificationId = typeof data?.notificationId === 'string' ? data.notificationId : null;

    const current = useAuthStore.getState().session;
    if (!current) {
      // Preserve securely; login replays it for the intended recipient only.
      void storePendingRoute(data?.route, notificationId);
      return;
    }
    navigateToNotificationTarget(router, route);
    void markNotificationRead(notificationId);
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['unreadSummary'] });
  };

  // Android channels + tap listeners + cold start (mount once).
  useEffect(() => {
    void ensureAndroidChannels();

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromPush.current(
        response.notification.request.content.data as Record<string, unknown> | undefined,
      );
    });

    return () => sub.remove();
  }, []);

  // Cold start: the tap that LAUNCHED the app. Wait for the auth guard to
  // settle so we never flash the wrong tab or navigate before the navigator
  // is ready to hold the Notifications underlay.
  useEffect(() => {
    if (isLoading || handledColdStart.current) return;
    handledColdStart.current = true;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      // Small defer: let the initial route (tabs/welcome) mount first.
      setTimeout(() => {
        openFromPush.current(
          response.notification.request.content.data as Record<string, unknown> | undefined,
        );
      }, 350);
    });
  }, [isLoading]);

  // Post-login replay of a logged-out tap, gated on the intended recipient.
  useEffect(() => {
    if (!userId) return;
    void (async () => {
      const pending = await consumePendingRoute();
      if (!pending) return;
      if (pending.notificationId) {
        const { data } = await supabase
          .from('notifications')
          .select('id')
          .eq('id', pending.notificationId)
          .maybeSingle();
        if (!data) return; // not this user's notification — drop it
      }
      navigateToNotificationTarget(router, pending.route);
      void markNotificationRead(pending.notificationId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Token registration: on login and whenever the app foregrounds (covers
  // permission granted in Settings while backgrounded, and token rotation).
  useEffect(() => {
    if (!userId) return;
    void registerPushTokenIfPermitted();
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active' && Platform.OS !== 'web') {
        void registerPushTokenIfPermitted();
      }
    });
    return () => sub.remove();
  }, [userId]);
}
