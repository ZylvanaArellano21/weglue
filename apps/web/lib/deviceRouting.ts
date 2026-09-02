/**
 * We Glue smart download routing.
 *
 * The public `/download` page is the single permanent destination encoded in
 * every printed / shared We Glue QR code. Opening that URL routes by device:
 *
 *   iPhone / iPad / iPod  -> Apple App Store
 *   Android phone/tablet  -> Google Play
 *   desktop / unknown     -> stay on the /download page (logo, one QR, buttons)
 *
 * The QR itself always encodes {@link DOWNLOAD_APP_URL} - never a store URL -
 * so the same physical code keeps performing device detection forever, even if
 * the store listings move.
 *
 * Two detectors, one intent:
 *   - {@link storeTargetFromUserAgent} runs in middleware with only the request
 *     User-Agent. It redirects the unambiguous phone cases instantly (no page
 *     flash, no JS) and returns null for anything a header cannot decide -
 *     desktop, bots, and modern iPadOS Safari (a "Macintosh" UA identical to
 *     a laptop).
 *   - {@link downloadTargetFromClient} runs on the page for the cases
 *     middleware passed through, and consults navigator.maxTouchPoints to tell
 *     an iPad from a Mac.
 */

// The real production Download App URL. Hard-coded on purpose: the QR must
// never encode a localhost / preview / staging origin and must stay stable
// across deploys. Mirrors the hard-coded INVITE_BASE_URL convention in
// lib/messages/service.ts.
export const DOWNLOAD_APP_URL = "https://weglue.app/download";

// Store listings for the /download smart-routing flow. The App Store link is
// pinned to the US storefront on purpose (Apple redirects other regions to
// their own storefront). Other surfaces (app/invite/[token]/page.tsx,
// components/shared/GetTheAppPrompt.tsx) keep their own separate literals and
// are intentionally not touched by this feature.
export const APP_STORE_URL =
  "https://apps.apple.com/us/app/we-glue/id6786491344";
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.weglue.app";

export type StoreTarget = "app-store" | "play-store";
export type DownloadTarget = StoreTarget | "download-page";

export function storeUrlFor(target: StoreTarget): string {
  return target === "app-store" ? APP_STORE_URL : PLAY_STORE_URL;
}

/**
 * Server-side device routing from the User-Agent header alone.
 *
 * Returns a store only when the UA is unambiguous. `null` means "cannot tell
 * from headers - let the /download page decide client-side": that covers every
 * desktop OS, crawlers, empty UAs, and deliberately iPadOS 13+ Safari, whose
 * default UA is byte-for-byte a macOS Safari UA.
 */
export function storeTargetFromUserAgent(
  userAgent: string | null | undefined,
): StoreTarget | null {
  if (!userAgent) return null;
  const ua = userAgent;

  // Android covers phones and tablets (both carry the "Android" token); both
  // go to Google Play, so no phone/tablet split is needed.
  if (/Android/i.test(ua)) return "play-store";

  // iOS devices that still identify themselves: iPhone / iPod always; iPad on
  // iPadOS <= 12 or with Safari "Request Desktop Website" off carries the
  // "iPad" token. Modern iPads on the default desktop-style UA are NOT matched
  // here and fall through to null -> handled on the client.
  if (/iP(?:hone|od|ad)/i.test(ua)) return "app-store";

  // "Macintosh", "Windows", "Linux", "CrOS", bots, "" -> undecidable.
  return null;
}

/**
 * Client-side device routing. Runs on the /download page for every request
 * middleware let through, and uses navigator.maxTouchPoints - the one signal
 * that separates a modern iPad (touch) from a Mac (no touch, including
 * Apple-Silicon MacBooks and every Safari/WebKit build).
 */
export function downloadTargetFromClient(nav: {
  userAgent: string;
  maxTouchPoints: number;
  platform?: string;
}): DownloadTarget {
  const ua = nav.userAgent ?? "";

  if (/Android/i.test(ua)) return "play-store";
  if (/iP(?:hone|od|ad)/i.test(ua)) return "app-store";

  // iPadOS 13+ default Safari: a "Macintosh" / "MacIntel" identity plus a real
  // touch screen. A Mac reports maxTouchPoints === 0 even in Safari, so this
  // never fires for desktop Safari/WebKit users.
  const looksMac =
    /Macintosh/i.test(ua) || nav.platform === "MacIntel" || /Mac OS X/i.test(ua);
  const hasMultiTouch =
    typeof nav.maxTouchPoints === "number" && nav.maxTouchPoints > 1;
  if (looksMac && hasMultiTouch) return "app-store";

  // Windows, Mac desktop, Linux, ChromeOS, or anything unrecognised.
  return "download-page";
}
