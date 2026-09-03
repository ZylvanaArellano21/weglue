import { Linking, Platform } from 'react-native';

/**
 * The ONE source of truth for "open the store" anywhere in the app.
 *
 * Region-neutral on purpose: the native App Store / Play Store app resolves
 * these to the viewer's own storefront. When the backend `app_releases` row
 * carries an exact listing URL (e.g. Apple's `trackViewUrl`), prefer that.
 */
export const APP_STORE_URL = 'https://apps.apple.com/app/we-glue/id6786491344';
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.weglue.app';

/** Store URL for the current platform, preferring a backend-provided one. */
export function resolveStoreUrl(fromBackend?: string | null): string {
  if (fromBackend && /^https?:\/\//i.test(fromBackend.trim())) {
    return fromBackend.trim();
  }
  return Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
}

/**
 * Opens the current platform's public store listing. Resolves `false` if the
 * link could not be opened, so the caller can surface a fallback.
 */
export async function openStoreListing(fromBackend?: string | null): Promise<boolean> {
  try {
    await Linking.openURL(resolveStoreUrl(fromBackend));
    return true;
  } catch {
    return false;
  }
}
