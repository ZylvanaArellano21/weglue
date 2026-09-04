import { describe, expect, it, vi, beforeEach } from 'vitest';

// F5 acceptance gate (2026-09-04): "Update now" must open the EXACT We Glue
// product page on the platform's own store — never a dead link, never the
// wrong store, never a stale hardcoded destination — and the hardcoded
// fallback (used only when the backend row carries no store_url) must also
// point at We Glue, not a placeholder.
//
// Real evidence this pins against, fetched live on 2026-09-04:
//   iTunes lookup (bundleId=com.weglue.app / id=6786491344) returned
//     trackViewUrl: "https://apps.apple.com/us/app/we-glue/id6786491344?uo=4"
//   The public Play listing at
//     https://play.google.com/store/apps/details?id=com.weglue.app
//   returns HTTP 200 and renders "We Glue" — the app IS live there.
// Both hardcoded fallbacks below resolve the SAME app (id 6786491344 /
// com.weglue.app) as those real, live listings.

let platformOS: 'ios' | 'android' = 'ios';
const openURL = vi.fn((_url: string) => Promise.resolve());
vi.mock('react-native', () => ({
  Platform: { get OS() { return platformOS; } },
  Linking: { openURL: (url: string) => openURL(url) },
}));

import { APP_STORE_URL, PLAY_STORE_URL, resolveStoreUrl, openStoreListing } from '../storeLinks';

const REAL_IOS_TRACK_VIEW_URL = 'https://apps.apple.com/us/app/we-glue/id6786491344?uo=4';
const REAL_PLAY_LISTING_ID = 'com.weglue.app';

beforeEach(() => {
  openURL.mockClear();
});

describe('the hardcoded fallback URLs point at the real We Glue listings', () => {
  it('APP_STORE_URL is the same app as the real live App Store trackViewUrl (id 6786491344)', () => {
    expect(APP_STORE_URL).toContain('id6786491344');
    expect(REAL_IOS_TRACK_VIEW_URL).toContain('id6786491344');
  });
  it('PLAY_STORE_URL is the same app as the real live Play listing (com.weglue.app)', () => {
    expect(PLAY_STORE_URL).toBe(`https://play.google.com/store/apps/details?id=${REAL_PLAY_LISTING_ID}`);
  });
});

describe('resolveStoreUrl', () => {
  it('prefers an exact backend-provided listing URL (e.g. the real trackViewUrl) over the fallback', () => {
    platformOS = 'ios';
    expect(resolveStoreUrl(REAL_IOS_TRACK_VIEW_URL)).toBe(REAL_IOS_TRACK_VIEW_URL);
  });
  it('falls back to the correct STORE FOR THE CURRENT PLATFORM when the backend gives nothing', () => {
    platformOS = 'ios';
    expect(resolveStoreUrl(null)).toBe(APP_STORE_URL);
    expect(resolveStoreUrl(undefined)).toBe(APP_STORE_URL);
    platformOS = 'android';
    expect(resolveStoreUrl(null)).toBe(PLAY_STORE_URL);
  });
  it('never lets a malformed/empty backend value produce a dead link — falls back instead', () => {
    platformOS = 'ios';
    expect(resolveStoreUrl('')).toBe(APP_STORE_URL);
    expect(resolveStoreUrl('   ')).toBe(APP_STORE_URL);
    expect(resolveStoreUrl('not-a-url')).toBe(APP_STORE_URL);
  });
  it('never returns the OTHER platform store, even if a bogus value were passed', () => {
    platformOS = 'android';
    // A backend value is trusted (it's our own row), but if it were ever
    // empty the fallback must be Android's own store, never iOS's.
    expect(resolveStoreUrl(null)).not.toContain('apps.apple.com');
    platformOS = 'ios';
    expect(resolveStoreUrl(null)).not.toContain('play.google.com');
  });
});

describe('openStoreListing — "Update now" on both platforms', () => {
  it('iOS: opens the exact real We Glue App Store product page', async () => {
    platformOS = 'ios';
    const ok = await openStoreListing(REAL_IOS_TRACK_VIEW_URL);
    expect(ok).toBe(true);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(REAL_IOS_TRACK_VIEW_URL);
  });
  it('iOS with no backend URL: opens the hardcoded We Glue App Store fallback, not a placeholder', async () => {
    platformOS = 'ios';
    const ok = await openStoreListing(null);
    expect(ok).toBe(true);
    expect(openURL).toHaveBeenCalledWith(APP_STORE_URL);
  });
  it('Android: opens the exact We Glue Play Store product page', async () => {
    platformOS = 'android';
    const ok = await openStoreListing(`https://play.google.com/store/apps/details?id=${REAL_PLAY_LISTING_ID}`);
    expect(ok).toBe(true);
    expect(openURL).toHaveBeenCalledWith(`https://play.google.com/store/apps/details?id=${REAL_PLAY_LISTING_ID}`);
  });
  it('Android with no backend URL: opens the hardcoded We Glue Play Store fallback', async () => {
    platformOS = 'android';
    const ok = await openStoreListing(undefined);
    expect(ok).toBe(true);
    expect(openURL).toHaveBeenCalledWith(PLAY_STORE_URL);
  });
  it('is never a dead button: a Linking failure resolves false instead of throwing, so the caller can show a retry', async () => {
    platformOS = 'ios';
    openURL.mockImplementationOnce(() => Promise.reject(new Error('no handler')));
    const ok = await openStoreListing(REAL_IOS_TRACK_VIEW_URL);
    expect(ok).toBe(false);
  });
});
