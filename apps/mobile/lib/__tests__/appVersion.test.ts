import { describe, expect, it } from 'vitest';
import { isVersionNewer } from '../appVersion';

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
