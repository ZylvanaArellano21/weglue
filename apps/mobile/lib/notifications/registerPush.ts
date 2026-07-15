/**
 * Per-device Expo push token lifecycle.
 *
 *  • Registration runs only AFTER permission is granted (never triggers the
 *    OS prompt itself) and only for a signed-in user.
 *  • The token is upserted server-side keyed on the token string
 *    (register_push_token), so a device that switches accounts moves its
 *    token to the new user — one token can never notify two accounts.
 *  • Logout calls deactivateCurrentPushToken() BEFORE the session is cleared
 *    (the RPC needs auth). Account deletion cascades server-side.
 *  • Dev builds register as environment='development' so test pushes never
 *    mix with production analytics.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from '../supabase';
import { getPermissionState } from './permissions';

let lastRegisteredToken: string | null = null;

export async function registerPushTokenIfPermitted(): Promise<string | null> {
  try {
    // Simulators/emulators have no push transport; skip quietly.
    if (!Device.isDevice) return null;
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
    if ((await getPermissionState()) !== 'granted') return null;

    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    if (!projectId) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS,
      p_environment: __DEV__ ? 'development' : 'production',
      p_device_name: `${Device.brand ?? ''} ${Device.modelName ?? ''}`.trim() || null,
    });
    if (error) throw error;

    lastRegisteredToken = token;
    return token;
  } catch (e) {
    // Token registration must never break app startup; a later foreground
    // or login re-attempts it.
    console.warn('[push] token registration failed:', e);
    return null;
  }
}

/** Stop pushes to THIS device for the current account. Call before sign-out. */
export async function deactivateCurrentPushToken(): Promise<void> {
  try {
    let token = lastRegisteredToken;
    if (!token && Device.isDevice) {
      const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId;
      if (projectId && (await getPermissionState()) === 'granted') {
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data ?? null;
      }
    }
    if (!token) return;
    await supabase.rpc('deactivate_push_token', { p_token: token });
    lastRegisteredToken = null;
  } catch {
    // Best-effort: receipts will invalidate the token if it goes stale.
  }
}
