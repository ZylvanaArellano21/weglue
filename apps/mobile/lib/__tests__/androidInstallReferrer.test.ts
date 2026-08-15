import { describe, expect, it, vi, beforeEach } from 'vitest';

// Feature 1 — Android Play Install Referrer survival. Native module and
// storage are mocked; the goal is proving the JS-side contract: iOS no-op,
// one-shot per install, malformed/missing referrer never crashes, and a
// found token funnels through the SAME controller a deep link uses.

let platformOS = 'android';
vi.mock('react-native', () => ({
  Platform: { get OS() { return platformOS; } },
  NativeModules: {} as Record<string, unknown>,
}));

const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { storage.set(key, value); return Promise.resolve(); }),
  },
}));

const captureInviteToken = vi.fn((_token: string, _opts: { hasSession: boolean; isOnboarded: boolean }) => Promise.resolve());
vi.mock('../inviteController', () => ({
  captureInviteToken: (token: string, opts: { hasSession: boolean; isOnboarded: boolean }) => captureInviteToken(token, opts),
}));

import { parseInviteTokenFromReferrer, checkAndroidInstallReferrerOnce } from '../androidInstallReferrer';
import { NativeModules } from 'react-native';

describe('parseInviteTokenFromReferrer', () => {
  it('extracts the token from a well-formed referrer string', () => {
    expect(parseInviteTokenFromReferrer('invite_token=abc123')).toBe('abc123');
  });
  it('extracts the token when other query params are present', () => {
    expect(parseInviteTokenFromReferrer('utm_source=google-play&invite_token=abc123&utm_medium=x')).toBe('abc123');
  });
  it('returns null for a referrer with no invite_token', () => {
    expect(parseInviteTokenFromReferrer('utm_source=google-play')).toBeNull();
  });
  it('returns null for null/undefined/empty input without throwing', () => {
    expect(parseInviteTokenFromReferrer(null)).toBeNull();
    expect(parseInviteTokenFromReferrer(undefined)).toBeNull();
    expect(parseInviteTokenFromReferrer('')).toBeNull();
  });
  it('returns null (never throws) for a malformed referrer string', () => {
    expect(() => parseInviteTokenFromReferrer('%%%not-a-query-string%%%')).not.toThrow();
  });
});

describe('checkAndroidInstallReferrerOnce', () => {
  beforeEach(() => {
    platformOS = 'android';
    storage.clear();
    captureInviteToken.mockClear();
    delete (NativeModules as Record<string, unknown>).PlayInstallReferrer;
  });

  it('is a no-op on iOS', async () => {
    platformOS = 'ios';
    (NativeModules as Record<string, unknown>).PlayInstallReferrer = {
      getInstallReferrer: vi.fn(() => Promise.resolve('invite_token=tok')),
    };
    await checkAndroidInstallReferrerOnce({ hasSession: false, isOnboarded: false });
    expect(captureInviteToken).not.toHaveBeenCalled();
  });

  it('is a no-op when the native module is not present (e.g. dev client built before this plugin)', async () => {
    await checkAndroidInstallReferrerOnce({ hasSession: false, isOnboarded: false });
    expect(captureInviteToken).not.toHaveBeenCalled();
  });

  it('captures a found token through the shared invitation controller', async () => {
    (NativeModules as Record<string, unknown>).PlayInstallReferrer = {
      getInstallReferrer: vi.fn(() => Promise.resolve('invite_token=tok-android')),
    };
    await checkAndroidInstallReferrerOnce({ hasSession: false, isOnboarded: false });
    expect(captureInviteToken).toHaveBeenCalledWith('tok-android', { hasSession: false, isOnboarded: false });
  });

  it('does not call captureInviteToken when the referrer has no invite token (normal Home flow)', async () => {
    (NativeModules as Record<string, unknown>).PlayInstallReferrer = {
      getInstallReferrer: vi.fn(() => Promise.resolve('utm_source=google-play')),
    };
    await checkAndroidInstallReferrerOnce({ hasSession: false, isOnboarded: false });
    expect(captureInviteToken).not.toHaveBeenCalled();
  });

  it('only checks the native module once — a second call in the same install is a no-op', async () => {
    const getInstallReferrer = vi.fn(() => Promise.resolve('invite_token=tok'));
    (NativeModules as Record<string, unknown>).PlayInstallReferrer = { getInstallReferrer };
    await checkAndroidInstallReferrerOnce({ hasSession: false, isOnboarded: false });
    await checkAndroidInstallReferrerOnce({ hasSession: false, isOnboarded: false });
    expect(getInstallReferrer).toHaveBeenCalledTimes(1);
  });

  it('never throws when the native call itself rejects', async () => {
    (NativeModules as Record<string, unknown>).PlayInstallReferrer = {
      getInstallReferrer: vi.fn(() => Promise.reject(new Error('boom'))),
    };
    await expect(checkAndroidInstallReferrerOnce({ hasSession: false, isOnboarded: false })).resolves.toBeUndefined();
    expect(captureInviteToken).not.toHaveBeenCalled();
  });
});
