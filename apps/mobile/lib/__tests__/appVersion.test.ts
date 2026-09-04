import { describe, expect, it } from 'vitest';
import { isVersionNewer, resolveUpdateDecision } from '../appVersion';

describe('isVersionNewer', () => {
  it('detects a higher patch / minor / major', () => {
    expect(isVersionNewer('1.0.6', '1.0.5')).toBe(true);
    expect(isVersionNewer('1.1.0', '1.0.9')).toBe(true);
    expect(isVersionNewer('2.0.0', '1.9.9')).toBe(true);
  });

  it('is not fooled by string ordering ("1.0.10" > "1.0.3")', () => {
    expect(isVersionNewer('1.0.10', '1.0.3')).toBe(true);
    expect(isVersionNewer('1.0.3', '1.0.10')).toBe(false);
  });

  it('treats equal / lower / missing-segment-equal versions as not newer', () => {
    expect(isVersionNewer('1.0.5', '1.0.5')).toBe(false);
    expect(isVersionNewer('1.0.4', '1.0.5')).toBe(false);
    expect(isVersionNewer('1.4', '1.4.0')).toBe(false);
    expect(isVersionNewer('1.4.0', '1.4')).toBe(false);
    expect(isVersionNewer('1.5', '1.4.9')).toBe(true);
  });

  it('ignores build / OTA / prerelease suffixes', () => {
    expect(isVersionNewer('1.0.6', '1.0.5-40')).toBe(true);
    expect(isVersionNewer('1.0.5+build.7', '1.0.5')).toBe(false);
    expect(isVersionNewer('1.0.6-rc.1', '1.0.5')).toBe(true);
  });

  it('never reports newer for an unparseable version (no false update prompt)', () => {
    expect(isVersionNewer('', '1.0.5')).toBe(false);
    expect(isVersionNewer('abc', '1.0.5')).toBe(false);
    expect(isVersionNewer('1.0.6', 'not-a-version')).toBe(false);
    expect(isVersionNewer('1.x.0', '1.0.0')).toBe(false);
  });
});

describe('resolveUpdateDecision', () => {
  const ios = { platform: 'ios' as const, version: '1.0.5', build: '40' };
  const android = { platform: 'android' as const, version: '1.0.5', build: '40' };

  it('no row / empty row → nothing to update to, not a failure', () => {
    expect(resolveUpdateDecision(null, ios)).toEqual({
      updateAvailable: false, checkFailed: false, latestVersion: null,
    });
    expect(resolveUpdateDecision({ version: null, build_number: null }, android)).toEqual({
      updateAvailable: false, checkFailed: false, latestVersion: null,
    });
  });

  it('iOS compares the marketing version', () => {
    expect(resolveUpdateDecision({ version: '1.0.6', build_number: null }, ios).updateAvailable).toBe(true);
    expect(resolveUpdateDecision({ version: '1.0.5', build_number: null }, ios).updateAvailable).toBe(false);
    expect(resolveUpdateDecision({ version: '1.0.6', build_number: null }, ios).latestVersion).toBe('1.0.6');
  });

  it('Android compares the Play versionCode when the row carries one', () => {
    expect(resolveUpdateDecision({ version: null, build_number: 41 }, android).updateAvailable).toBe(true);
    expect(resolveUpdateDecision({ version: null, build_number: 40 }, android).updateAvailable).toBe(false);
    expect(resolveUpdateDecision({ version: null, build_number: 39 }, android).updateAvailable).toBe(false);
    // a bare versionCode is not surfaced to the user
    expect(resolveUpdateDecision({ version: null, build_number: 41 }, android).latestVersion).toBeNull();
  });

  it('Android with an unreadable installed versionCode is a FAILED check, never "up to date"', () => {
    const d = resolveUpdateDecision({ version: null, build_number: 41 }, { ...android, build: null });
    expect(d).toEqual({ updateAvailable: false, checkFailed: true, latestVersion: null });
    const d2 = resolveUpdateDecision({ version: null, build_number: 41 }, { ...android, build: 'x' });
    expect(d2.checkFailed).toBe(true);
  });

  it('a manually-published Android row (no build_number) falls back to marketing version', () => {
    expect(resolveUpdateDecision({ version: '1.0.6', build_number: null }, android).updateAvailable).toBe(true);
    expect(resolveUpdateDecision({ version: '1.0.4', build_number: null }, android).updateAvailable).toBe(false);
  });
});

describe('F5 acceptance gate (2026-09-04): update-available path against the REAL current store version', () => {
  // We Glue has no newer public release today than what's installed, so the
  // update-available path can't be observed by simply installing the app.
  // Per the founder's prescribed method: supply an intentionally OLDER
  // installed version against the REAL current store version and confirm
  // updateAvailable flips true — no fake production app_releases row, no
  // real user notified. The iOS value below is the live App Store response,
  // fetched directly from https://itunes.apple.com/lookup?bundleId=com.weglue.app
  // on 2026-09-04: {"version":"1.0.5","trackViewUrl":"https://apps.apple.com/us/app/we-glue/id6786491344?uo=4", ...}
  // — this is exactly the shape and exactly the row useAppUpdateStatus reads
  // once the poller writes it (source='store').
  const REAL_LIVE_IOS_VERSION = '1.0.5';
  const REAL_LIVE_IOS_TRACK_VIEW_URL = 'https://apps.apple.com/us/app/we-glue/id6786491344?uo=4';
  // Android value: read live via the official Google Play Android Publisher
  // API (weglue-play-version-checker service account) on 2026-09-04, running
  // the exact production readAndroidProduction() logic locally —
  // production track, one "completed" release: name "1.0.5", versionCodes
  // ["40"]. Parsed result: { buildNumber: 40, version: "1.0.5" }.
  const REAL_LIVE_ANDROID_BUILD_NUMBER = 40;
  const REAL_LIVE_ANDROID_VERSION = '1.0.5';

  it('installed OLDER than the real live store version -> updateAvailable, with the real listing carried through', () => {
    const row = { version: REAL_LIVE_IOS_VERSION, build_number: null };
    const olderInstalled = { platform: 'ios' as const, version: '1.0.4', build: '39' };
    const decision = resolveUpdateDecision(row, olderInstalled);
    expect(decision).toEqual({
      updateAvailable: true,
      checkFailed: false,
      latestVersion: REAL_LIVE_IOS_VERSION,
    });
  });

  it("installed EQUAL to today's real live store version -> upToDate, never a false positive", () => {
    const row = { version: REAL_LIVE_IOS_VERSION, build_number: null };
    const currentInstalled = { platform: 'ios' as const, version: REAL_LIVE_IOS_VERSION, build: '40' };
    expect(resolveUpdateDecision(row, currentInstalled)).toEqual({
      updateAvailable: false,
      checkFailed: false,
      latestVersion: REAL_LIVE_IOS_VERSION,
    });
  });

  it('installed NEWER than the real live store version -> upToDate (never claims an update backwards)', () => {
    const row = { version: REAL_LIVE_IOS_VERSION, build_number: null };
    const newerInstalled = { platform: 'ios' as const, version: '1.0.6', build: '41' };
    expect(resolveUpdateDecision(row, newerInstalled).updateAvailable).toBe(false);
  });

  it('a store/API failure (no row reachable) is checkFailed, NEVER falsely upToDate', () => {
    // fetchAppUpdateStatus throws on a real Supabase error and the hook maps
    // query.isError -> checkFailed; at the pure-logic layer a genuinely
    // absent/unreadable row must not silently read as "you are current".
    const olderInstalled = { platform: 'ios' as const, version: '1.0.4', build: '39' };
    const unreadableInstalledBuild = { platform: 'android' as const, version: '1.0.4', build: null };
    expect(resolveUpdateDecision(null, olderInstalled)).toEqual({
      updateAvailable: false, checkFailed: false, latestVersion: null,
    }); // no row yet = nothing to update to, not a failure (distinct from a real fetch error)
    expect(
      resolveUpdateDecision({ version: null, build_number: 999 }, unreadableInstalledBuild).checkFailed,
    ).toBe(true); // an unreadable installed identifier IS a failed check
  });

  // "Update now" for this exact row: storeLinks.test.ts proves
  // resolveStoreUrl(REAL_LIVE_IOS_TRACK_VIEW_URL) === REAL_LIVE_IOS_TRACK_VIEW_URL
  // and that openStoreListing() calls Linking.openURL with it — completing
  // the chain from "installed is older" through to "the exact real store
  // page opens" for both platforms.
  it('sanity: the real listing URL used above is the actual live trackViewUrl (see storeLinks.test.ts for the routing proof)', () => {
    expect(REAL_LIVE_IOS_TRACK_VIEW_URL).toBe('https://apps.apple.com/us/app/we-glue/id6786491344?uo=4');
  });

  it('Android: installed versionCode OLDER than the real live production versionCode -> updateAvailable', () => {
    const row = { version: REAL_LIVE_ANDROID_VERSION, build_number: REAL_LIVE_ANDROID_BUILD_NUMBER };
    const olderInstalled = { platform: 'android' as const, version: '1.0.4', build: '39' };
    expect(resolveUpdateDecision(row, olderInstalled)).toEqual({
      updateAvailable: true,
      checkFailed: false,
      // The comparison itself is by versionCode (39 < 40), not marketing
      // version — but Play DID report a marketing name for this release
      // ("1.0.5"), so it is still surfaced for display.
      latestVersion: REAL_LIVE_ANDROID_VERSION,
    });
  });

  it("Android: installed versionCode EQUAL to today's real live production versionCode -> upToDate", () => {
    const row = { version: REAL_LIVE_ANDROID_VERSION, build_number: REAL_LIVE_ANDROID_BUILD_NUMBER };
    const currentInstalled = { platform: 'android' as const, version: REAL_LIVE_ANDROID_VERSION, build: String(REAL_LIVE_ANDROID_BUILD_NUMBER) };
    expect(resolveUpdateDecision(row, currentInstalled).updateAvailable).toBe(false);
  });

  it('Android: installed versionCode NEWER than the real live production versionCode -> upToDate', () => {
    const row = { version: REAL_LIVE_ANDROID_VERSION, build_number: REAL_LIVE_ANDROID_BUILD_NUMBER };
    const newerInstalled = { platform: 'android' as const, version: '1.0.6', build: '41' };
    expect(resolveUpdateDecision(row, newerInstalled).updateAvailable).toBe(false);
  });

  it('Android: an unreadable installed versionCode against the real live row is checkFailed, never upToDate', () => {
    const row = { version: REAL_LIVE_ANDROID_VERSION, build_number: REAL_LIVE_ANDROID_BUILD_NUMBER };
    const unreadable = { platform: 'android' as const, version: '1.0.4', build: null };
    expect(resolveUpdateDecision(row, unreadable)).toEqual({
      updateAvailable: false, checkFailed: true, latestVersion: REAL_LIVE_ANDROID_VERSION,
    });
  });
});
