import { describe, expect, it, vi, beforeEach } from 'vitest';

// Fix 4 — "one invitation controller" dedup contract. push()/replace() are
// stubbed so we can assert exactly how many times (and with what path) the
// controller tried to navigate, without a real router.
const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => push(...args),
    replace: (...args: unknown[]) => replace(...args),
  },
}));

const setPendingInvite = vi.fn((_token: string) => Promise.resolve());
const getPendingInvite = vi.fn(() => Promise.resolve<string | null>(null));
vi.mock('../pendingInvite', () => ({
  setPendingInvite: (token: string) => setPendingInvite(token),
  getPendingInvite: () => getPendingInvite(),
  parseInviteToken: (url: string | null | undefined) => {
    if (typeof url !== 'string') return null;
    const match = url.match(/\/invite\/([A-Za-z0-9._-]+)/);
    return match ? match[1] : null;
  },
}));

import { captureInviteToken, captureInviteUrl, resumePendingInvite } from '../inviteController';

describe('inviteController — one controller, one redemption, one navigation', () => {
  beforeEach(() => {
    push.mockClear();
    replace.mockClear();
    setPendingInvite.mockClear();
    getPendingInvite.mockClear();
  });

  it('persists the token and navigates once for an authenticated, onboarded user', async () => {
    await captureInviteToken('tok-1', { hasSession: true, isOnboarded: true });
    expect(setPendingInvite).toHaveBeenCalledWith('tok-1');
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/invite/tok-1');
  });

  it('persists only (no navigation) when the user is not yet authenticated/onboarded', async () => {
    await captureInviteToken('tok-2', { hasSession: false, isOnboarded: false });
    expect(setPendingInvite).toHaveBeenCalledWith('tok-2');
    expect(push).not.toHaveBeenCalled();
  });

  it('a second delivery of the SAME token while the first is still in flight is ignored', async () => {
    // Never-resolving persistence write simulates "still processing".
    let resolveFirst: () => void = () => {};
    setPendingInvite.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveFirst = resolve; }),
    );
    const first = captureInviteToken('tok-3', { hasSession: true, isOnboarded: true });
    const second = captureInviteToken('tok-3', { hasSession: true, isOnboarded: true });
    resolveFirst();
    await Promise.all([first, second]);

    // setPendingInvite called once (the second call short-circuited before
    // reaching it), and navigation happened exactly once.
    expect(setPendingInvite).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('captureInviteUrl ignores non-invite URLs entirely', async () => {
    await captureInviteUrl('https://weglue.app/event/abc', { hasSession: true, isOnboarded: true });
    expect(setPendingInvite).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('captureInviteUrl extracts the token and delegates to the same capture path', async () => {
    await captureInviteUrl('https://weglue.app/invite/tok-4', { hasSession: true, isOnboarded: true });
    expect(setPendingInvite).toHaveBeenCalledWith('tok-4');
    expect(push).toHaveBeenCalledWith('/invite/tok-4');
  });

  it('resumePendingInvite reports false with no stored token', async () => {
    getPendingInvite.mockResolvedValueOnce(null);
    const hadPending = await resumePendingInvite();
    expect(hadPending).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('resumePendingInvite routes to the stored token and reports true', async () => {
    getPendingInvite.mockResolvedValueOnce('tok-resume');
    const hadPending = await resumePendingInvite();
    expect(hadPending).toBe(true);
    expect(replace).toHaveBeenCalledWith('/invite/tok-resume');
  });
});
