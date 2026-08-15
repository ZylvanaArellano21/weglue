import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureInviteToken } from './inviteController';

// ─── Feature 1 — Android install-referrer survival ──────────────────────────
// Reads the Google Play Install Referrer (native module: plugins/
// withPlayInstallReferrer.js) exactly once per install, and — if it carries
// an invite token — hands it to the SAME single invitation controller a
// warm/cold deep link uses, so a Play-Store install and a link tap can never
// produce two different code paths or two redemptions.
//
// The referrer string We Glue's Play listing URL is built with is a plain
// "invite_token=<opaque token>" query string (no email, name, or other PII —
// the token itself carries no identity, same guarantee as the link/QR path).

const CHECKED_KEY = 'weglue-install-referrer-checked';

export function parseInviteTokenFromReferrer(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URLSearchParams(referrer).get('invite_token');
  } catch {
    return null;
  }
}

/**
 * Called once at app startup (root index screen). No-ops on iOS, on every
 * launch after the first (AsyncStorage guard), if the native module isn't
 * present (a dev client built before this plugin, or a non-Android-Studio
 * Expo Go session), or if the referrer carries no invite token — all of
 * which fall through to the normal Home flow, exactly as required.
 */
export async function checkAndroidInstallReferrerOnce(opts: {
  hasSession: boolean;
  isOnboarded: boolean;
}): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    const already = await AsyncStorage.getItem(CHECKED_KEY);
    if (already === '1') return;
    await AsyncStorage.setItem(CHECKED_KEY, '1');
  } catch {
    // Can't guarantee one-shot without the flag — skip rather than risk a
    // repeat native call on every launch.
    return;
  }

  const native = NativeModules.PlayInstallReferrer as { getInstallReferrer?: () => Promise<string | null> } | undefined;
  if (!native?.getInstallReferrer) return;

  try {
    const referrer = await native.getInstallReferrer();
    const token = parseInviteTokenFromReferrer(referrer);
    if (token) {
      await captureInviteToken(token, opts);
    }
  } catch {
    // A referrer-read failure must never affect normal app startup.
  }
}
