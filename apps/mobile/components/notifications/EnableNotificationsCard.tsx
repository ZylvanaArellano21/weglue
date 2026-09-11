/**
 * The We Glue pre-permission explanation — the OS prompt NEVER fires without
 * the user tapping "Turn on" here first (store-policy rule: no first-launch
 * or mid-onboarding interruption).
 *
 * Two variants, same underlying permission logic:
 *  - 'inbox' (default): shown at the top of the Notifications inbox (the
 *    meaningful moment: the user is literally looking for notifications)
 *    while permission is undetermined. Dismissal is session-only ("Not now"
 *    hides it until the app is relaunched) — unchanged from before.
 *  - 'home': shown above the Posts/Events selector on Home. Dismissal is
 *    persisted (reminderDismissal.ts): hidden for 7 days, reappears if
 *    notifications are still off, capped at 3 dismissals total.
 *
 * Both variants: after a permanent denial they swap to an Open Settings
 * path and never nag again; re-checks permission on every app-foreground so
 * enabling notifications elsewhere (Settings) hides the card immediately.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@weglue/shared';
import {
  getPermissionState,
  hasAskedBefore,
  openNotificationSettings,
  requestPermissionFromUserAction,
  type PermissionState,
} from '../../lib/notifications/permissions';
import { onPermissionDecision } from '../../lib/notifications/permissionSync';
import { registerPushTokenIfPermitted } from '../../lib/notifications/registerPush';
import { recordDismissal, shouldShowReminder } from '../../lib/notifications/reminderDismissal';

type Variant = 'inbox' | 'home';

export function EnableNotificationsCard({ variant = 'inbox' }: { variant?: Variant } = {}) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const [state, setState] = useState<PermissionState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // 'home' starts hidden until the persisted cadence check resolves, so it
  // never flashes on screen before we know whether this account is still
  // within its 7-day/3-dismissal window. 'inbox' never used this cadence.
  const [reminderAllowed, setReminderAllowed] = useState(variant !== 'home');
  const [showSettingsPath, setShowSettingsPath] = useState(false);

  const checkPermission = useCallback(async () => {
    const permission = await getPermissionState();
    setState(permission);
    // After an explicit earlier denial we only ever show the Settings path,
    // and never nag with the native prompt again.
    if (permission === 'denied' && (await hasAskedBefore())) {
      setShowSettingsPath(true);
    }
  }, []);

  useEffect(() => {
    void checkPermission();
  }, [checkPermission]);

  useEffect(() => {
    if (variant !== 'home' || !userId) return;
    void shouldShowReminder(userId).then(setReminderAllowed);
  }, [variant, userId]);

  // If the user grants permission elsewhere (Settings app) while this card
  // is on screen, the next foreground catches it and hides the card.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') void checkPermission();
    });
    return () => sub.remove();
  }, [checkPermission]);

  const handleEnable = useCallback(async () => {
    const result = await requestPermissionFromUserAction();
    setState(result);
    if (userId) void onPermissionDecision(userId, result);
    if (result === 'granted') {
      void registerPushTokenIfPermitted();
    } else if (result === 'denied') {
      setShowSettingsPath(true);
    }
  }, [userId]);

  const handleDismiss = () => {
    setDismissed(true);
    if (variant === 'home' && userId) {
      void recordDismissal(userId);
    }
  };

  if (dismissed || !reminderAllowed || state === null || state === 'granted') return null;

  const title = variant === 'home' ? "Don't miss what's happening" : 'Turn on notifications';
  const subtitle = showSettingsPath
    ? 'Notifications are off. Enable them in Settings to hear about messages and events.'
    : variant === 'home'
      ? 'Get notifications for messages, events, replies, reminders, and more.'
      : 'Know right away about messages, event reminders and your clubs.';
  const ctaLabel = showSettingsPath ? 'Open Settings' : variant === 'home' ? 'Turn on notifications' : 'Turn on';

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 4,
        padding: 14,
        borderRadius: 14,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E5E7EB',
      }}
    >
      {/* Header row: icon + text share the full card width; the dismiss control
          sits in the top-right corner. The CTA drops to its own row below so
          the copy never gets squeezed into a narrow column on small phones or
          split-view tablets. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            backgroundColor: 'rgba(15, 166, 166, 0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="notifications-outline" size={20} color="#0FA6A6" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' }}>
            {title}
          </Text>
          <Text
            style={{
              fontSize: 12,
              color: '#6B7280',
              fontFamily: 'Inter_400Regular',
              marginTop: 2,
              lineHeight: 17,
            }}
          >
            {subtitle}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleDismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notifications prompt"
          style={{ marginTop: -2, marginRight: -2, padding: 2 }}
        >
          <Ionicons name="close" size={16} color="#9CA3AF" />
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        onPress={() => (showSettingsPath ? void openNotificationSettings() : void handleEnable())}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        style={{
          alignSelf: 'flex-start',
          marginTop: 12,
          backgroundColor: '#0FA6A6',
          borderRadius: 18,
          paddingHorizontal: 16,
          minHeight: 36,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>
          {ctaLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
