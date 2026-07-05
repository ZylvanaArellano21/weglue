import { Linking, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

// Universal-link pattern already wired into app.json (Android intentFilters)
// and apps/web AASA (iOS). No public web preview page exists yet for these
// routes — opening the link without the app installed will currently 404 on
// weglue.app. That's a known follow-up (needs apps/web/app/event/[id] and
// post/[id] pages with OG tags), out of scope for this pass.
export function getEventShareUrl(eventId: string): string {
  return `https://weglue.app/event/${eventId}`;
}

export function getPostShareUrl(postId: string): string {
  return `https://weglue.app/post/${postId}`;
}

export async function copyLinkToClipboard(url: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(url);
    return true;
  } catch {
    return false;
  }
}

// Deliberately skip Linking.canOpenURL() — querying custom schemes requires
// whitelisting them (LSApplicationQueriesSchemes on iOS / <queries> on
// Android), which is a native config change requiring a new build. Trying
// openURL directly and catching failure avoids that native dependency.
async function tryOpenUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export async function shareToWhatsApp(text: string): Promise<boolean> {
  return tryOpenUrl(`whatsapp://send?text=${encodeURIComponent(text)}`);
}

export async function shareToMessages(text: string): Promise<boolean> {
  const separator = Platform.OS === 'ios' ? '&' : '?';
  return tryOpenUrl(`sms:${separator}body=${encodeURIComponent(text)}`);
}

// Instagram has no public URL scheme for prefilled link/text sharing, so the
// best available flow is: copy the link, then best-effort open the app so
// the user can paste it (e.g. into a Story or DM). Caller shows the copy
// confirmation toast regardless of whether the app-open succeeds.
export async function shareToInstagram(url: string): Promise<{ copied: boolean }> {
  const copied = await copyLinkToClipboard(url);
  await tryOpenUrl('instagram://app');
  return { copied };
}
