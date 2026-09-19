import { Linking, Platform, Share } from 'react-native';
import ShareLib, { Social as ShareSocial } from 'react-native-share';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { resolveAttachmentUrl } from './chatAttachments';
import { supabase } from './supabase';
import { getEventShareUrl, getPostShareUrl } from '@weglue/shared';

// ─── External-share permission gate (migration 143) ────────────────────────
// A post/event's canonical URL never becomes anonymously public just because
// someone knows it or presses Share — it requires the authorized owner
// (personal post: its author; club post/event: a club officer) to have
// explicitly enabled external sharing. The enable_external_share RPC enforces
// that authorization server-side and returns false (never throws) for anyone
// else, so a non-owner tapping Share on someone else's not-yet-enabled
// content can never enable it on that owner's behalf — it just doesn't
// proceed. Once enabled by the real owner, this returns true for anyone
// (resharing), since the state itself is now public, not per-caller.
export async function enableExternalShare(
  entityType: 'post' | 'event',
  entityId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('enable_external_share', {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  return !error && data === true;
}

// ─── Share funnel analytics (migration 145) ─────────────────────────────────
// Anonymous, aggregate-only counters — no user identity is ever recorded, and
// there is no direct table write: everything goes through the narrow
// log_share_funnel_event SECURITY DEFINER RPC, which validates every field
// and dedupes retries/rerenders of the same step server-side. Fire-and-forget
// — a failed/rejected call must never interrupt or delay a share.
export type ShareFunnelEvent =
  | 'share_initiated'
  | 'instagram_story_selected'
  | 'preview_opened'
  | 'open_in_app_clicked'
  | 'store_clicked';

export type ShareFunnelSource = 'instagram_story' | 'copy_link' | 'messages' | 'whatsapp' | 'more' | 'direct_unknown';

export function trackShareFunnelEvent(
  eventName: ShareFunnelEvent,
  entityType: 'post' | 'event' | null,
  entityId: string | null,
  source: ShareFunnelSource | null,
  shareSessionId: string | null,
): void {
  void supabase
    .rpc('log_share_funnel_event', {
      p_share_session_id: shareSessionId,
      p_event_name: eventName,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_source: source,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    })
    .then(() => {}, () => {});
}

// Universal-link pattern already wired into app.json (Android intentFilters)
// and apps/web AASA (iOS). getEventShareUrl/getPostShareUrl now come from
// @weglue/shared (packages/shared/src/sharing/canonicalLink.ts) so mobile and
// web never drift on the URL shape. Re-exported here so existing importers of
// this module don't need to change.
export { getEventShareUrl, getPostShareUrl };

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
//
// This remains the fallback used by shareInstagramStory() below when no
// Meta App ID is configured yet — kept as its own export because it's also
// reused as-is for that fallback path.
export async function shareToInstagram(url: string): Promise<{ copied: boolean }> {
  const copied = await copyLinkToClipboard(url);
  await tryOpenUrl('instagram://app');
  return { copied };
}

// ─── Instagram Story sharing ────────────────────────────────────────────────
// Real preload-into-composer handoff, via react-native-share's documented
// mechanism (Share.shareSingle + Social.INSTAGRAM_STORIES), which wraps:
//   iOS     — instagram-stories:// + UIPasteboard sticker/background keys
//   Android — an ACTION_SEND-family intent targeting com.instagram.android
// Both are Meta's own supported paths for handing an image into "Add to
// Story" already loaded — no screenshot, no manual save, no re-creating the
// post/event. There is no equivalent for text/link-only sharing and no
// equivalent on web; Instagram Stories composition is native-app-only.
//
// Meta has required a registered Facebook/Meta App ID for this exact API
// since January 2023 (`appId` is a mandatory field, not optional). Until one
// is configured (EXPO_PUBLIC_META_APP_ID), this degrades to the existing
// copy-link-and-open-app flow above rather than blocking the rest of the
// share feature on that one-time setup step.
//
// There is no publish-confirmation signal from Instagram in either path —
// `ok`/`usedNativeHandoff` only ever mean "the handoff was attempted/opened
// successfully," never "a Story was published." Callers (and analytics) must
// not claim more than that.

const META_APP_ID: string | undefined = process.env.EXPO_PUBLIC_META_APP_ID || undefined;

// We Glue brand tokens already used across the share sheet UI (see
// ShareSheet.tsx styles) — Instagram uses these only as letterbox fill color
// if the rendered asset doesn't cover the full 1080x1920 Story frame.
const STORY_BACKGROUND_TOP = '#0FA6A6';
const STORY_BACKGROUND_BOTTOM = '#FEFCF0';

/** `'video'` is accepted so callers don't need a signature change once video
 *  Story sharing is implemented — it currently always resolves to
 *  `unsupported_media` and never attempts anything. Not implemented now. */
export type StoryMediaKind = 'image' | 'video';

export interface InstagramStoryShareInput {
  /** Local file:// URI of the already-rendered We Glue-styled Story asset
   *  (produced by the Story image renderer — a separate concern from this
   *  function, which only performs the handoff to Instagram). */
  mediaUri: string;
  kind?: StoryMediaKind;
  /** Canonical https://weglue.app/post|event/{id} URL — becomes the Story's
   *  tappable link back to the exact We Glue content. */
  linkUrl: string;
}

export interface InstagramStoryShareResult {
  ok: boolean;
  /** True when the real native preload (image + link) was attempted; false
   *  when this fell back to copy-link because no Meta App ID is configured
   *  yet, or because video was requested (not implemented). */
  usedNativeHandoff: boolean;
  reason?: 'not_installed' | 'unsupported_media' | 'no_meta_app_id' | 'failed';
}

export async function shareInstagramStory(
  input: InstagramStoryShareInput,
): Promise<InstagramStoryShareResult> {
  if (input.kind === 'video') {
    return { ok: false, usedNativeHandoff: false, reason: 'unsupported_media' };
  }

  if (!META_APP_ID) {
    const { copied } = await shareToInstagram(input.linkUrl);
    return { ok: copied, usedNativeHandoff: false, reason: copied ? 'no_meta_app_id' : 'failed' };
  }

  try {
    await ShareLib.shareSingle({
      social: ShareSocial.InstagramStories,
      appId: META_APP_ID,
      backgroundImage: input.mediaUri,
      backgroundTopColor: STORY_BACKGROUND_TOP,
      backgroundBottomColor: STORY_BACKGROUND_BOTTOM,
      attributionURL: input.linkUrl,
      linkUrl: input.linkUrl,
    });
    return { ok: true, usedNativeHandoff: true };
  } catch {
    // Most common cause: Instagram isn't installed. Never throw/crash.
    return { ok: false, usedNativeHandoff: true, reason: 'not_installed' };
  }
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
