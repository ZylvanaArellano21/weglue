/**
 * Notification permission flow.
 *
 * Store-policy rules implemented here:
 *  • The OS prompt is NEVER fired at first launch or mid-onboarding. It only
 *    runs after the user acts on the We Glue explanation card/toggle (a
 *    "meaningful moment": opening Notifications, or enabling in Settings).
 *  • After a denial we never re-prompt automatically — Android 13+ and iOS
 *    both make repeat prompts a no-op or a policy problem. We remember that
 *    we asked and offer "Open Settings" instead.
 *  • Works identically for iOS (APNs) and Android 13+ runtime permission;
 *    pre-13 Android reports granted without a prompt.
 */
import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ASKED_KEY = 'weglue-notifications-asked-v1';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function getPermissionState(): Promise<PermissionState> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return 'granted';
  }
  return settings.canAskAgain ? 'undetermined' : 'denied';
}

export async function hasAskedBefore(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ASKED_KEY)) === 'true';
  } catch {
    return false;
  }
}

/**
 * Fire the real OS prompt. Call ONLY from an explicit user action on the
 * We Glue explanation UI. Returns the resulting state.
 */
export async function requestPermissionFromUserAction(): Promise<PermissionState> {
  try {
    await AsyncStorage.setItem(ASKED_KEY, 'true');
  } catch {
    // Remembering is best-effort; the OS enforces its own single-prompt rule.
  }
  const result = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  if (result.granted || result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return 'granted';
  }
  return result.canAskAgain ? 'undetermined' : 'denied';
}

/** Path out of a permanent denial: the app's page in system settings. */
export async function openNotificationSettings(): Promise<void> {
  try {
    if (Platform.OS === 'ios') {
      await Linking.openURL('app-settings:');
    } else {
      await Linking.openSettings();
    }
  } catch {
    // Settings can't open — nothing further we can do from here.
  }
}
