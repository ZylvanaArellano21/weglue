import * as Linking from 'expo-linking';

// ─── Help / Support email ─────────────────────────────────────────────────────

export const SUPPORT_EMAIL = 'zylvana.arellano.campos@gmail.com';

// Opens the device's email composer addressed to support. Returns false when
// no mail app is available (e.g. Mail deleted on iOS, no email client on
// Android) so the caller can show a copyable fallback instead of crashing.
export async function openSupportEmail(): Promise<boolean> {
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('We Glue Support')}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
