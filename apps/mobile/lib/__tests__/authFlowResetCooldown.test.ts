import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// authFlow — password-reset cooldown (Task 3)
// ============================================================================
//
// The mobile reset flow gained the same claim-first cooldown the verification
// flow already had, so a double tap / a quick return to the screen can't put a
// second reset email in flight or walk into GoTrue's per-identity mailer
// throttle. A throttle KEEPS the cooldown; any other failure releases it.
// ============================================================================

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  resetResult: { error: null as unknown },
  resetPasswordForEmail: vi.fn(() => Promise.resolve(h.resetResult)),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(h.store.get(k) ?? null),
    setItem: (k: string, v: string) => { h.store.set(k, v); return Promise.resolve(); },
    removeItem: (k: string) => { h.store.delete(k); return Promise.resolve(); },
  },
}));
vi.mock('../supabase', () => ({
  supabase: { auth: { resetPasswordForEmail: h.resetPasswordForEmail } },
}));

import { sendPasswordResetEmail, getResetCooldownRemaining } from '../authFlow';

beforeEach(() => {
  h.store.clear();
  h.resetResult.error = null;
  h.resetPasswordForEmail.mockClear();
});

describe('sendPasswordResetEmail', () => {
  it('sends once and opens a ~60s cooldown', async () => {
    await expect(sendPasswordResetEmail('Student@school.edu')).resolves.toEqual({ ok: true });
    expect(h.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    const left = await getResetCooldownRemaining('student@school.edu');
    expect(left).toBeGreaterThan(55);
    expect(left).toBeLessThanOrEqual(60);
  });

  it('refuses a second send while the cooldown is active, returning the remaining seconds', async () => {
    await sendPasswordResetEmail('a@b.edu');
    const second = await sendPasswordResetEmail('a@b.edu');
    expect(second).toMatchObject({ ok: false });
    expect('cooldown' in second && second.cooldown).toBeGreaterThan(0);
    expect(h.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });

  it('cooldown is per-email', async () => {
    await sendPasswordResetEmail('a@b.edu');
    expect(await getResetCooldownRemaining('other@b.edu')).toBe(0);
  });

  it('a non-throttle failure releases the cooldown so the user can retry', async () => {
    h.resetResult.error = { message: 'network error', code: 'unexpected_failure' };
    const r = await sendPasswordResetEmail('a@b.edu');
    expect(r).toMatchObject({ ok: false });
    expect(await getResetCooldownRemaining('a@b.edu')).toBe(0);
  });

  it('a throttle failure KEEPS the cooldown', async () => {
    h.resetResult.error = { message: 'For security purposes, you can only request this after 42 seconds', status: 429 };
    await sendPasswordResetEmail('a@b.edu');
    expect(await getResetCooldownRemaining('a@b.edu')).toBeGreaterThan(0);
  });

  it('rejects an empty email without touching the network', async () => {
    expect(await sendPasswordResetEmail('   ')).toMatchObject({ ok: false });
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
