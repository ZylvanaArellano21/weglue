/**
 * Notification permission flow.
 *
 * Store-policy rules implemented here:
 *  • The OS prompt is NEVER fired at first launch or mid-onboarding. It only
 *    runs after the user acts on the We Glue explanation card/toggle (a
 *    "meaningful moment": opening Notifications, enabling in Settings), OR
 *    the one sanctioned automatic call site: useFirstLoginPushPermission,
 *    fired exactly once, the moment a brand-new account's FIRST explicit
 *    `signInWithPassword()` success lands it on Home for the first time.
 *    (apps/mobile/app/auth/confirmed.tsx deliberately signs back out and
 *    hands off to /auth/login after verifying an email, instead of landing
 *    the user in the tabs itself — so the OS box can only ever appear
 *    immediately after that explicit Log In, never during signup, email
 *    verification, or on the Login/confirmation screens themselves.)
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
const FIRST_LOGIN_ASKED_KEY_PREFIX = 'weglue-first-login-permission-asked:';

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

/**
 * Defense-in-depth guard for useFirstLoginPushPermission, keyed per account.
 *
 * consume_push_permission_prompt() (migration 081) is the authoritative,
 * server-persisted guard, but a device killed between the OS dialog
 * resolving and that network call completing would otherwise see the server
 * flag still `true` on the next cold start and fire again. This local flag
 * closes that window — set the instant the request fires, checked before
 * firing. Harmless even if it never needed to matter: requestPermissionsAsync
 * is itself a silent no-op once the OS has already recorded a decision.
 */
export async function hasAskedFirstLoginBefore(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FIRST_LOGIN_ASKED_KEY_PREFIX + userId)) === 'true';
  } catch {
    return false;
  }
}

export async function markFirstLoginAsked(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(FIRST_LOGIN_ASKED_KEY_PREFIX + userId, 'true');
  } catch {
    // Best-effort — the server flag is still the authoritative guard.
  }
}
