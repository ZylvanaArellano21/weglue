import { Linking, Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { resolveAttachmentUrl } from './chatAttachments';

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

// Club-profile share / QR target. `?source=qr` lets the web club route tell a
// scanned-QR visit (bounce to the store when the app isn't installed) apart
// from ordinary web navigation. An installed app opens the club profile
// directly via the universal / app link; a signed-in phone-web user still
// sees the profile normally. Same string for the QR, Copy link and Share.
export function getClubShareUrl(clubId: string): string {
  return `https://weglue.app/club/${clubId}?source=qr`;
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

/** Open the native share sheet for a plain link/text (event & post external
 * "More"): AirDrop, Notes, Drive and every installed app. */
export async function shareLinkExternally(text: string): Promise<void> {
  try {
    await Share.share({ message: text });
  } catch {
    // dismissed
  }
}

/**
 * External sharing of a PRIVATE chat photo/video: resolve a short-lived signed
 * URL, download it to a temp cache file, and hand the ACTUAL FILE to the OS
 * share sheet (expo-sharing → Instagram, Messages, WhatsApp, AirDrop, Quick
 * Share, Drive, …). Never shares the signed URL as text. Temp file is removed
 * after a delay so the receiving app has finished reading it.
 */
export async function shareMediaFileExternally(opts: {
  sourcePath: string;
  kind: 'image' | 'video';
  mime?: string | null;
  name?: string | null;
}): Promise<{ ok: boolean; reason?: 'unavailable' | 'failed' }> {
  const signed = await resolveAttachmentUrl(opts.sourcePath);
  if (!signed) return { ok: false, reason: 'unavailable' };

  const ext = opts.name?.includes('.')
    ? opts.name.split('.').pop()
    : opts.kind === 'video'
      ? 'mp4'
      : 'jpg';
  const target = `${FileSystem.cacheDirectory}weglue-share-${Date.now()}.${ext}`;
  const mimeType = opts.mime ?? (opts.kind === 'video' ? 'video/mp4' : 'image/jpeg');

  try {
    let localUri = signed;
    if (signed.startsWith('http')) {
      const dl = await FileSystem.downloadAsync(signed, target);
      localUri = dl.uri;
    }

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(localUri, { mimeType, dialogTitle: 'Share' });
    } else {
      // Fallback: iOS RN Share accepts a file url.
      await Share.share(Platform.OS === 'ios' ? { url: localUri } : { message: localUri });
    }

    // Delayed cleanup: the OS/receiving app may still be reading the file when
    // shareAsync resolves on Android.
    setTimeout(() => {
      void FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
    }, 60_000);
    return { ok: true };
  } catch {
    void FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
    return { ok: false, reason: 'failed' };
  }
}
