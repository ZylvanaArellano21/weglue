/**
 * Microsoft OAuth flow safety: callback parsing never trusts the URL beyond
 * the authorization code, duplicate callbacks exchange exactly once, and
 * every failure path resolves to friendly copy — never raw provider errors.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  store,
  exchangeCodeForSession,
  signInWithOAuth,
  setSession,
  getSession,
  openAuthSessionAsync,
} = vi.hoisted(() => ({
  store: new Map<string, string>(),
  exchangeCodeForSession: vi.fn(),
  signInWithOAuth: vi.fn(),
  setSession: vi.fn(),
  getSession: vi.fn(),
  openAuthSessionAsync: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn(async (k: string) => void store.delete(k)),
    multiRemove: vi.fn(async (ks: string[]) => ks.forEach((k) => store.delete(k))),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { exchangeCodeForSession, signInWithOAuth },
  })),
}));

vi.mock('../supabase', () => ({
  supabase: { auth: { setSession, getSession } },
}));

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => openAuthSessionAsync(...args),
}));

import {
  MS_ERRORS,
  completeMicrosoftCallback,
  parseOAuthCallback,
  signInWithMicrosoft,
} from '../microsoftAuth';

function session(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'at',
    refresh_token: 'rt',
    user: {
      email: 'student@school.edu',
      email_confirmed_at: '2026-07-15T00:00:00Z',
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  setSession.mockResolvedValue({ error: null });
  getSession.mockResolvedValue({ data: { session: null } });
});

describe('parseOAuthCallback', () => {
  it('extracts the authorization code', () => {
    expect(parseOAuthCallback('weglue://auth/callback?code=abc123')).toEqual({
      kind: 'code',
      code: 'abc123',
    });
  });

  it('maps the before_user_created hook rejection to the eligibility copy', () => {
    const url =
      'weglue://auth/callback?error=server_error&error_description=' +
      encodeURIComponent(
        'Please use your university or college email address (.edu or equivalent) to sign up.',
      );
    expect(parseOAuthCallback(url)).toEqual({
      kind: 'provider_error',
      message: MS_ERRORS.notEligible,
    });
  });

  it('maps a missing provider email to the no-email copy', () => {
    const url =
      'weglue://auth/callback?error=server_error&error_description=' +
      encodeURIComponent('Error getting user email from external provider');
    expect(parseOAuthCallback(url)).toEqual({
      kind: 'provider_error',
      message: MS_ERRORS.noEmail,
    });
  });

  it('never surfaces unknown provider errors verbatim', () => {
    const url =
      'weglue://auth/callback?error=server_error&error_description=' +
      encodeURIComponent('pq: duplicate key value violates unique constraint');
    const parsed = parseOAuthCallback(url);
    expect(parsed.kind).toBe('provider_error');
    expect((parsed as { message: string }).message).toBe(MS_ERRORS.generic);
  });

  it('rejects URLs with neither code nor error', () => {
    expect(parseOAuthCallback('weglue://auth/callback')).toEqual({ kind: 'invalid' });
    expect(parseOAuthCallback('')).toEqual({ kind: 'invalid' });
    expect(parseOAuthCallback(undefined as unknown as string)).toEqual({ kind: 'invalid' });
  });

  it('ignores fragment content (tokens are never read from the URL)', () => {
    const parsed = parseOAuthCallback(
      'weglue://auth/callback?code=real#access_token=forged&refresh_token=forged',
    );
    expect(parsed).toEqual({ kind: 'code', code: 'real' });
  });
});

describe('completeMicrosoftCallback', () => {
  it('exchanges the code once and hands the session to the main client', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: session() }, error: null });

    const result = await completeMicrosoftCallback('weglue://auth/callback?code=one');

    expect(result).toEqual({ status: 'success' });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForSession).toHaveBeenCalledWith('one');
    expect(setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
  });

  it('deduplicates a duplicate callback for the same code (single exchange)', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: session() }, error: null });

    const [a, b] = await Promise.all([
      completeMicrosoftCallback('weglue://auth/callback?code=dup'),
      completeMicrosoftCallback('weglue://auth/callback?code=dup'),
    ]);

    expect(a).toEqual({ status: 'success' });
    expect(b).toEqual({ status: 'success' });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(setSession).toHaveBeenCalledTimes(1);
  });

  it('a replayed old callback succeeds only if its session still exists', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: session() }, error: null });
    await completeMicrosoftCallback('weglue://auth/callback?code=replay');

    getSession.mockResolvedValue({ data: { session: session() } });
    expect(await completeMicrosoftCallback('weglue://auth/callback?code=replay')).toEqual({
      status: 'success',
    });

    getSession.mockResolvedValue({ data: { session: null } });
    expect(await completeMicrosoftCallback('weglue://auth/callback?code=replay')).toEqual({
      status: 'error',
      message: MS_ERRORS.expired,
    });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('maps a failed exchange (used/expired/forged code) to retry copy', async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'invalid flow state, no valid flow state found' },
    });
    const result = await completeMicrosoftCallback('weglue://auth/callback?code=expired');
    expect(result).toEqual({ status: 'error', message: MS_ERRORS.expired });
    expect(setSession).not.toHaveBeenCalled();
  });

  it('refuses a session whose provider email is missing', async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: session({ email: undefined }) },
      error: null,
    });
    const result = await completeMicrosoftCallback('weglue://auth/callback?code=noemail');
    expect(result).toEqual({ status: 'error', message: MS_ERRORS.noEmail });
    expect(setSession).not.toHaveBeenCalled();
  });

  it('refuses a session whose email is not provider-verified', async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { session: session({ email_confirmed_at: null }) },
      error: null,
    });
    const result = await completeMicrosoftCallback('weglue://auth/callback?code=unverified');
    expect(result).toEqual({ status: 'error', message: MS_ERRORS.emailUnverified });
    expect(setSession).not.toHaveBeenCalled();
  });
});

describe('signInWithMicrosoft', () => {
  it('maps a disabled provider to the unavailable copy', async () => {
    signInWithOAuth.mockResolvedValue({
      data: { url: null },
      error: { message: 'Unsupported provider: provider is not enabled' },
    });
    expect(await signInWithMicrosoft()).toEqual({
      status: 'error',
      message: MS_ERRORS.unavailable,
    });
  });

  it('treats a closed browser sheet as a cancel, not an error', async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: 'https://auth' }, error: null });
    openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
    expect(await signInWithMicrosoft()).toEqual({ status: 'cancelled' });
  });

  it('rejects a second concurrent attempt as busy (double tap)', async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: 'https://auth' }, error: null });
    let resolveBrowser: (v: unknown) => void;
    openAuthSessionAsync.mockReturnValue(new Promise((r) => (resolveBrowser = r)));

    const first = signInWithMicrosoft();
    const second = await signInWithMicrosoft();
    expect(second).toEqual({ status: 'busy' });

    resolveBrowser!({ type: 'cancel' });
    expect(await first).toEqual({ status: 'cancelled' });
    expect(openAuthSessionAsync).toHaveBeenCalledTimes(1);
  });

  it('completes the flow end-to-end on a successful browser return', async () => {
    signInWithOAuth.mockResolvedValue({ data: { url: 'https://auth' }, error: null });
    openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'weglue://auth/callback?code=flow',
    });
    exchangeCodeForSession.mockResolvedValue({ data: { session: session() }, error: null });

    expect(await signInWithMicrosoft()).toEqual({ status: 'success' });
    expect(setSession).toHaveBeenCalledTimes(1);
  });
});
