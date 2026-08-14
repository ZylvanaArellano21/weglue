/**
 * The We Glue pre-permission explanation — the OS prompt NEVER fires without
 * the user tapping "Turn on" here first (store-policy rule: no first-launch
 * or mid-onboarding interruption).
 *
 * Shown at the top of the Notifications inbox (the meaningful moment: the
 * user is literally looking for notifications) while permission is
 * undetermined; after a permanent denial it swaps to an Open Settings path
 * and never nags again ("Not now" hides it for the session, the asked flag
 * keeps it from auto-reappearing forever).
 */
import { useCallback, useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
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

export function EnableNotificationsCard() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const [state, setState] = useState<PermissionState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showSettingsPath, setShowSettingsPath] = useState(false);

  useEffect(() => {
    void (async () => {
      const permission = await getPermissionState();
      setState(permission);
      // After an explicit earlier denial we only ever show the Settings path,
      // and only while the user is on this screen — no nagging.
      if (permission === 'denied' && (await hasAskedBefore())) {
        setShowSettingsPath(true);
      }
    })();
  }, []);

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

  if (dismissed || state === null || state === 'granted') return null;

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
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
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
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827', fontFamily: 'Inter_700Bold' }}>
          Turn on notifications
        </Text>
        <Text style={{ fontSize: 12, color: '#6B7280', fontFamily: 'Inter_400Regular', marginTop: 2 }}>
          {showSettingsPath
            ? 'Notifications are off. Enable them in Settings to hear about messages and events.'
            : 'Know right away about messages, event reminders and your clubs.'}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => (showSettingsPath ? void openNotificationSettings() : void handleEnable())}
        activeOpacity={0.85}
        style={{
          backgroundColor: '#0FA6A6',
          borderRadius: 18,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600', fontFamily: 'Inter_600SemiBold' }}>
          {showSettingsPath ? 'Open Settings' : 'Turn on'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => setDismissed(true)}
        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
        accessibilityLabel="Dismiss notifications prompt"
      >
        <Ionicons name="close" size={16} color="#9CA3AF" />
      </TouchableOpacity>
    </View>
  );
}
