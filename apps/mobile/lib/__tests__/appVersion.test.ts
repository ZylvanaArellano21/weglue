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
