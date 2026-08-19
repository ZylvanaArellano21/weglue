/**
 * The no-permission-only foreground notification fallback. Rendered only
 * while OS notification permission is NOT granted (see
 * PushNotificationsHost.tsx) — native presentation is impossible in that
 * state, foreground or background, so this is the sole presentation for
 * that population. Styled to resemble each platform's native banner chrome
 * rather than a generic in-app toast. Fed by the same realtime INSERT
 * stream useRealtimeNotifications already subscribes to (via bannerBus, no
 * second subscription). At most one banner per notification id, ever
 * (session-lived dedup Set survives a flaky-connection replay), and never
 * for the actor's own action or the exact destination already on screen.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import { subscribeNotificationInsert, type BannerNotificationRow } from '../../lib/notifications/bannerBus';
import { validateNotificationRoute, navigateToNotificationTarget } from '../../lib/notifications/routes';
import { isDestinationOpen } from '../../lib/notifications/bannerSuppression';
import { markNotificationRead } from '../../services/notificationService';

const AUTO_DISMISS_MS = 4500;
const SHOWN_IDS_CAP = 200; // bounded — this is a session-lived safety net, not a log

export function ForegroundNotificationBanner() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);

  const [current, setCurrent] = useState<BannerNotificationRow | null>(null);
  const shownIds = useRef<Set<string>>(new Set());
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    Animated.parallel([
      Animated.timing(translateY, { toValue: -80, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setCurrent(null));
  };

  useEffect(() => {
    const unsubscribe = subscribeNotificationInsert((row) => {
      // Never notify the actor about their own action — defensive; the
      // domain triggers already never insert this row shape.
      if (row.actor_id && row.actor_id === row.user_id) return;
      if (!userId || row.user_id !== userId) return;

      // Dedup by notification id: at most one banner per event, even under a
      // realtime reconnect replay.
      if (shownIds.current.has(row.id)) return;

      const route = validateNotificationRoute(row.route);
      if (isDestinationOpen(route)) return; // exact destination already open

      shownIds.current.add(row.id);
      if (shownIds.current.size > SHOWN_IDS_CAP) {
        const oldest = shownIds.current.values().next().value;
        if (oldest) shownIds.current.delete(oldest);
      }

      setCurrent(row);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 90, friction: 11 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();

      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(hide, AUTO_DISMISS_MS);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!current) return null;

  const handlePress = () => {
    const route = validateNotificationRoute(current.route);
    hide();
    if (route) navigateToNotificationTarget(router, route);
    void markNotificationRead(current.id).then(() => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
      queryClient.invalidateQueries({ queryKey: ['unreadSummary', userId] });
    });
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 54,
        left: 16,
        right: 16,
        zIndex: 9999,
        transform: [{ translateY }],
        opacity,
      }}
    >
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel={current.message ?? 'New notification'}
        style={
          Platform.OS === 'android'
            ? {
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: '#FFFFFF',
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: 0.2,
                shadowRadius: 6,
                elevation: 8,
              }
            : {
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 10,
                backgroundColor: '#FFFFFF',
                borderRadius: 16,
                paddingHorizontal: 12,
                paddingVertical: 10,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.18,
                shadowRadius: 10,
                elevation: 6,
              }
        }
      >
        <View
          style={{
            width: Platform.OS === 'android' ? 24 : 28,
            height: Platform.OS === 'android' ? 24 : 28,
            borderRadius: Platform.OS === 'android' ? 12 : 8,
            backgroundColor: '#0FA6A6',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: Platform.OS === 'android' ? 0 : 1,
          }}
        >
          <Ionicons name="notifications" size={Platform.OS === 'android' ? 14 : 15} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 12,
              fontWeight: Platform.OS === 'android' ? '500' : '600',
              color: Platform.OS === 'android' ? '#5F6368' : '#8E8E93',
              marginBottom: 2,
              fontFamily: Platform.OS === 'android' ? 'Inter_500Medium' : 'Inter_600SemiBold',
            }}
          >
            We Glue
          </Text>
          <Text
            numberOfLines={2}
            style={{
              fontSize: 14,
              color: Platform.OS === 'android' ? '#202124' : '#000000',
              fontFamily: 'Inter_400Regular',
            }}
          >
            {current.message ?? 'You have a new notification.'}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}
