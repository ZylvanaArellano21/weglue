/**
 * Notification settings — follows the Privacy Center screen pattern exactly
 * (ProfileScreenHeader + toggle rows on the profile theme).
 *
 * Toggles map 1:1 to notification_preferences columns; enforcement happens
 * SERVER-side in enqueue_push, so these settings apply to every device.
 * In-app notifications are always retained — these control push only.
 */
import {
  View,
  Text,
  Switch,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  AppState,
} from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@weglue/shared';
import { ProfileScreenHeader } from '../../components/profile/ProfileScreenHeader';
import { profileColors, profileFonts } from '../../components/profile/profileTheme';
import {
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from '../../hooks/useNotificationPreferences';
import {
  getPermissionState,
  openNotificationSettings,
  requestPermissionFromUserAction,
  type PermissionState,
} from '../../lib/notifications/permissions';
import { onPermissionDecision, reconcilePermissionChange } from '../../lib/notifications/permissionSync';
import { registerPushTokenIfPermitted } from '../../lib/notifications/registerPush';
import type { NotificationPreferences } from '../../services/notificationService';

const CATEGORY_ROWS: {
  key: keyof NotificationPreferences;
  label: string;
  description: string;
}[] = [
  {
    key: 'push_messages',
    label: 'Messages',
    description: 'Direct messages, group chats and club chat activity.',
  },
  {
    key: 'push_events',
    label: 'Events & reminders',
    description: 'Reminders for events you joined, RSVP deadlines and changes.',
  },
  {
    key: 'push_clubs',
    label: 'Club posts & announcements',
    description: 'New posts, events and announcements from your clubs.',
  },
  {
    key: 'push_social',
    label: 'Social activity',
    description: 'New followers, likes and comments.',
  },
  {
    key: 'push_social_proof',
    label: 'Community highlights',
    description: 'When new students join We Glue or your clubs.',
  },
];

export default function NotificationSettingsScreen() {
  const { session } = useAuthStore();
  const userId = session?.user.id;
  const router = useRouter();

  const { data: prefs, isLoading } = useNotificationPreferences(userId);
  const update = useUpdateNotificationPreference(userId);

  const [permission, setPermission] = useState<PermissionState | null>(null);

  const refreshPermission = useCallback(async () => {
    const state = await getPermissionState();
    setPermission(state);
    // Correction 2: a change made in the OS Settings app while backgrounded
    // (Allow → Don't Allow or back) must cascade to every preference column
    // too — but only on a REAL transition, never on a no-op re-check, or a
    // user's manual per-category choice would get silently wiped every time
    // this screen regains focus.
    if (userId) void reconcilePermissionChange(userId, state);
  }, [userId]);

  // Track OS-level permission, including "changed in Settings while
  // backgrounded" — the row re-reads on every foreground.
  useEffect(() => {
    void refreshPermission();
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') void refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  const handlePermissionAction = async () => {
    if (permission === 'undetermined') {
      const result = await requestPermissionFromUserAction();
      setPermission(result);
      if (userId) void onPermissionDecision(userId, result);
      if (result === 'granted') void registerPushTokenIfPermitted();
    } else {
      await openNotificationSettings();
    }
  };

  if (isLoading || !prefs) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color={profileColors.teal} />
      </SafeAreaView>
    );
  }

  const pushDisabled = !prefs.push_enabled || permission !== 'granted';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ProfileScreenHeader title="Notifications" onBack={() => router.back()} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Device permission state + the single compliant action for it. */}
        {permission !== 'granted' && (
          <View style={styles.permissionCard}>
            <Text style={styles.permissionTitle}>
              {permission === 'denied'
                ? 'Notifications are off for this device'
                : 'Notifications are not set up yet'}
            </Text>
            <Text style={styles.permissionBody}>
              {permission === 'denied'
                ? 'Turn them on in your device Settings to get messages and event reminders.'
                : 'Turn them on to get messages and event reminders on this phone.'}
            </Text>
            <TouchableOpacity
              onPress={() => void handlePermissionAction()}
              activeOpacity={0.85}
              style={styles.permissionButton}
            >
              <Text style={styles.permissionButtonText}>
                {permission === 'denied' ? 'Open Settings' : 'Turn on notifications'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowLabel}>Push notifications</Text>
            <Text style={styles.rowDescription}>
              Master switch for every push category below. In-app notifications
              always stay available.
            </Text>
          </View>
          <Switch
            // Correction 2: the UI can never claim push is enabled while
            // device permission blocks it — forced off, and non-interactive,
            // whenever permission isn't granted. The permission card above
            // is the one path back to Allow/Open Settings; this switch is not
            // a second way to ask.
            value={prefs.push_enabled && permission === 'granted'}
            disabled={permission !== 'granted'}
            onValueChange={(value) => update.mutate({ push_enabled: value })}
            trackColor={{ false: profileColors.border, true: profileColors.teal }}
            thumbColor={profileColors.white}
            ios_backgroundColor={profileColors.border}
          />
        </View>

        <View style={styles.divider} />

        {CATEGORY_ROWS.map((row) => (
          <View key={row.key} style={[styles.row, pushDisabled && styles.rowDisabled]}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowDescription}>{row.description}</Text>
            </View>
            <Switch
              value={prefs[row.key] && permission === 'granted'}
              disabled={pushDisabled}
              onValueChange={(value) => update.mutate({ [row.key]: value })}
              trackColor={{ false: profileColors.border, true: profileColors.teal }}
              thumbColor={profileColors.white}
              ios_backgroundColor={profileColors.border}
            />
          </View>
        ))}

        <Text style={styles.footnote}>
          Settings apply to all your devices. Community highlights stay in the
          app without push unless you turn them on.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: profileColors.bg },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: profileColors.bg,
  },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  permissionCard: {
    backgroundColor: profileColors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: profileColors.border,
    padding: 16,
    marginTop: 8,
    marginBottom: 16,
  },
  permissionTitle: {
    fontFamily: profileFonts.bold,
    fontSize: 15,
    color: profileColors.textDark,
  },
  permissionBody: {
    fontFamily: profileFonts.regular,
    fontSize: 13,
    color: profileColors.textMuted,
    marginTop: 4,
    lineHeight: 18,
  },
  permissionButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: profileColors.teal,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  permissionButtonText: {
    fontFamily: profileFonts.semiBold,
    fontSize: 13,
    color: profileColors.white,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  rowDisabled: { opacity: 0.45 },
  rowText: { flex: 1 },
  rowLabel: {
    fontFamily: profileFonts.semiBold,
    fontSize: 15,
    color: profileColors.textDark,
  },
  rowDescription: {
    fontFamily: profileFonts.regular,
    fontSize: 12.5,
    color: profileColors.textMuted,
    marginTop: 2,
    lineHeight: 17,
  },
  divider: { height: 1, backgroundColor: profileColors.border, marginVertical: 4 },
  footnote: {
    fontFamily: profileFonts.regular,
    fontSize: 12,
    color: profileColors.textMuted,
    marginTop: 18,
    lineHeight: 17,
  },
});
