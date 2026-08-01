import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Administrator restriction — mobile routing decision (iOS + Android)
// ============================================================================
//
// The DATABASE half is proven by supabase/scripts/test_058_admin_restrictions.sql.
// This file pins the CLIENT half, and specifically the three properties that
// would be easiest to get quietly wrong:
//
//   1. the shell is chosen BEFORE the student tree, for both restriction kinds;
//   2. the client is never told WHICH kind it is beyond "suspended" vs the
//      generic "restricted" — no internal reason, no "platform_blocked";
//   3. it FAILS OPEN, so a network blip cannot lock out a healthy student.
// ============================================================================

const rpc = vi.fn();
vi.mock('../supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import {
  resolveAccessRoute,
  isRestrictedRoute,
  restrictionCopy,
  formatSuspensionEnd,
  type AccessStatePayload,
} from '../accessState';
import { getMyAccessState, looksLikeRestriction } from '../../services/accessService';

const payload = (over: Partial<AccessStatePayload> = {}): AccessStatePayload => ({
  state: 'active',
  suspended_until: null,
  support_email: 'info@weglue.app',
  ...over,
});

beforeEach(() => rpc.mockReset());

describe('routing decision', () => {
  it('routes an active account to the student tree', () => {
    expect(resolveAccessRoute(payload())).toBe('student');
  });

  it('routes a suspended account to the suspended shell', () => {
    expect(resolveAccessRoute(payload({ state: 'suspended' }))).toBe('suspended');
  });

  it('routes a restricted account to the restricted shell', () => {
    expect(resolveAccessRoute(payload({ state: 'restricted' }))).toBe('restricted');
  });

  it('FAILS OPEN for a missing payload — a blip must not lock anyone out', () => {
    // Safe because the server is the real control: migration 058 denies a
    // restricted account whatever this function returns.
    expect(resolveAccessRoute(null)).toBe('student');
    expect(resolveAccessRoute(undefined)).toBe('student');
  });

  it('classifies both restricted kinds as restricted, and student as not', () => {
    expect(isRestrictedRoute('suspended')).toBe(true);
    expect(isRestrictedRoute('restricted')).toBe(true);
    expect(isRestrictedRoute('student')).toBe(false);
  });
});

describe('copy can never disclose an internal reason or the severity', () => {
  it('never contains the words a leak would need', () => {
    for (const state of ['suspended', 'restricted'] as const) {
      const c = restrictionCopy(payload({ state }));
      const all = `${c.title} ${c.body}`.toLowerCase();
      for (const leak of ['platform_blocked', 'platform blocked', 'reason', 'administrator', 'moderator']) {
        expect(`${state}:${all.includes(leak)}`).toBe(`${state}:false`);
      }
    }
  });

  it('reassures that nothing was deleted — the most common support question', () => {
    const c = restrictionCopy(payload({ state: 'restricted' }));
    expect(c.body.toLowerCase()).toContain('have not been deleted');
  });

  it('only a SUSPENSION carries an end date; a restriction never does', () => {
    const iso = new Date(Date.now() + 86_400_000).toISOString();
    expect(restrictionCopy(payload({ state: 'suspended', suspended_until: iso })).until).toBe(iso);
    // A generic restriction is indefinite by definition, so surfacing a date
    // would be both wrong and a hint about the underlying classification.
    expect(restrictionCopy(payload({ state: 'restricted', suspended_until: iso })).until).toBeNull();
  });
});

describe('suspension end formatting', () => {
  it('returns null for a missing or unparseable date rather than "Invalid Date"', () => {
    expect(formatSuspensionEnd(null)).toBeNull();
    expect(formatSuspensionEnd('not-a-date')).toBeNull();
  });

  it('formats a real timestamp', () => {
    expect(formatSuspensionEnd(new Date('2026-09-01T12:00:00Z').toISOString())).toBeTruthy();
  });
});

describe('accessService', () => {
  it('calls my_access_state with NO parameters — it cannot probe another account', async () => {
    rpc.mockResolvedValue({ data: { state: 'suspended', suspended_until: null, support_email: 'x@y.z' }, error: null });
    await expect(getMyAccessState()).resolves.toMatchObject({ state: 'suspended' });
    expect(rpc).toHaveBeenCalledWith('my_access_state');
    expect(rpc.mock.calls[0]).toHaveLength(1);
  });

  it('defaults a missing payload to active rather than inventing a restriction', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(getMyAccessState()).resolves.toMatchObject({
      state: 'active',
      support_email: 'info@weglue.app',
    });
  });

  it('propagates transport errors so the caller can decide to fail open', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('offline') });
    await expect(getMyAccessState()).rejects.toThrow('offline');
  });

  it('recognises a server refusal so a denial can trigger an immediate recheck', () => {
    expect(looksLikeRestriction({ code: '42501' })).toBe(true);
    expect(looksLikeRestriction({ message: 'account_restricted' })).toBe(true);
    expect(looksLikeRestriction({ code: '23505' })).toBe(false);
    expect(looksLikeRestriction(null)).toBe(false);
  });
});
