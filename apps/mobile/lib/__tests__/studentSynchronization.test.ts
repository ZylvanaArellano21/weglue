import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { QueryClient } from '@tanstack/react-query';

// `studentSynchronization` now clears the local attachment cache too, and
// `chatAttachments` reaches expo-modules-core (which expects React Native's
// `__DEV__` global). Same stub the other mobile suites use.
const clearAttachmentCache = vi.fn();
vi.mock('../chatAttachments', () => ({
  clearAttachmentCache: () => clearAttachmentCache(),
}));

import {
  STUDENT_CONTENT_QUERY_ROOTS,
  invalidateStudentContentQueries,
  clearPermissionSensitiveStudentContent,
  shouldRecoverOnMobileForeground,
} from '../studentSynchronization';

describe('cached attachment bytes are dropped on an access change', () => {
  it('clears the local attachment cache, not only React Query state', () => {
    clearAttachmentCache.mockClear();
    const queryClient = { resetQueries: vi.fn(), setQueryData: vi.fn() } as unknown as QueryClient;

    clearPermissionSensitiveStudentContent(queryClient);

    // Every fetch is re-authorized by Storage, but a file already written to
    // the app cache would still render until it is removed.
    expect(clearAttachmentCache).toHaveBeenCalledTimes(1);
  });
});

describe('Day 10E mobile content synchronization', () => {
  it('invalidates every lifecycle-sensitive root without applying event data', () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries, setQueryData: vi.fn() } as unknown as QueryClient;

    invalidateStudentContentQueries(queryClient);

    expect(invalidateQueries).toHaveBeenCalledTimes(STUDENT_CONTENT_QUERY_ROOTS.length);
    expect(invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)).toEqual(
      STUDENT_CONTENT_QUERY_ROOTS.map((root) => [root]),
    );
    expect(queryClient.setQueryData).not.toHaveBeenCalled();
  });

  it('is idempotent for duplicate or delayed opaque broadcasts', () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    invalidateStudentContentQueries(queryClient);
    invalidateStudentContentQueries(queryClient);

    expect(invalidateQueries).toHaveBeenCalledTimes(STUDENT_CONTENT_QUERY_ROOTS.length * 2);
  });

  it('recovers only when the app returns to the foreground', () => {
    expect(shouldRecoverOnMobileForeground('active')).toBe(true);
    expect(shouldRecoverOnMobileForeground('background')).toBe(false);
    expect(shouldRecoverOnMobileForeground('inactive')).toBe(false);
  });

  it('removes permission-sensitive payloads before a selected-audience refetch', () => {
    const resetQueries = vi.fn();
    const removeQueries = vi.fn();
    const queryClient = { resetQueries, removeQueries } as unknown as QueryClient;

    clearPermissionSensitiveStudentContent(queryClient);

    expect(resetQueries.mock.calls.map(([arg]) => arg.queryKey)).toContainEqual(['eventDetail']);
    expect(resetQueries.mock.calls.map(([arg]) => arg.queryKey)).toContainEqual(['savedEventsUpcoming']);
    expect(resetQueries.mock.calls.map(([arg]) => arg.queryKey)).toContainEqual(['eventAttendees']);
    expect(resetQueries.mock.calls.map(([arg]) => arg.queryKey)).toContainEqual(['myChats']);
  });
});

/**
 * Bugs 6 and 8 — the property the navigation / foreground path depends on.
 *
 * `StudentSynchronizationHost` recovers from a screen transition and from
 * background→foreground with `invalidateStudentContentQueries`, and keeps the
 * clearing variant exclusively for the opaque campus broadcast.
 *
 * That split is only correct if invalidation is genuinely non-destructive. It
 * must mark every root stale — so each active query refetches under current RLS
 * — while leaving both the cached payloads and the on-disk attachment cache
 * intact. If it ever started discarding either, every screen returned to would
 * show a loader again and every avatar would have to be downloaded a second
 * time, which is exactly the behaviour these bugs describe.
 */
describe('navigation and foreground refresh without wiping', () => {
  it('marks every root stale but discards nothing', () => {
    clearAttachmentCache.mockClear();
    const invalidateQueries = vi.fn();
    const resetQueries = vi.fn();
    const removeQueries = vi.fn();
    const setQueryData = vi.fn();
    const queryClient = { invalidateQueries, resetQueries, removeQueries, setQueryData } as unknown as QueryClient;

    invalidateStudentContentQueries(queryClient);

    expect(invalidateQueries).toHaveBeenCalledTimes(STUDENT_CONTENT_QUERY_ROOTS.length);
    expect(resetQueries).not.toHaveBeenCalled();
    expect(removeQueries).not.toHaveBeenCalled();
    expect(setQueryData).not.toHaveBeenCalled();
    // The image cache is what makes avatars survive a navigation.
    expect(clearAttachmentCache).not.toHaveBeenCalled();
  });

  it('still empties the attachment cache on a genuine access change', () => {
    clearAttachmentCache.mockClear();
    const queryClient = { resetQueries: vi.fn() } as unknown as QueryClient;

    clearPermissionSensitiveStudentContent(queryClient);

    expect(clearAttachmentCache).toHaveBeenCalled();
  });

  it('foregrounding is still the only app state that triggers recovery', () => {
    expect(shouldRecoverOnMobileForeground('active')).toBe(true);
    expect(shouldRecoverOnMobileForeground('background')).toBe(false);
    expect(shouldRecoverOnMobileForeground('inactive')).toBe(false);
  });
});

/**
 * Parity with the web client, where this was already corrected.
 *
 * `removeQueries` DESTROYS a query that still has observers: the mounted screen
 * keeps a subscription to a cache entry that no longer exists, an in-flight
 * fetch resolves onto the discarded object, and the component is stranded in
 * `pending`/`idle` with nothing left to retry it — a permanent, silent loading
 * state rather than a stale-data guard. `resetQueries` discards the payload
 * (the privacy requirement is unchanged) AND refetches every active observer.
 */
describe('clearing must not strand mounted screens', () => {
  it('resets rather than removes', () => {
    const resetQueries = vi.fn();
    const removeQueries = vi.fn();
    const queryClient = { resetQueries, removeQueries } as unknown as QueryClient;

    clearPermissionSensitiveStudentContent(queryClient);

    expect(removeQueries).not.toHaveBeenCalled();
    expect(resetQueries).toHaveBeenCalled();
    expect(resetQueries.mock.calls.map(([arg]) => arg.queryKey)).toContainEqual(['messages']);
  });
});

/**
 * The campus broadcast channel re-subscribes on every socket reconnect (a
 * token-refresh re-auth, a network blip, a return to the foreground). Wiring
 * the clearing form to that reconnect callback blanked every open screen back
 * to a loader on every reconnect — the reconnect path must be a background
 * invalidation; only a RECEIVED broadcast may clear.
 */
describe('StudentSynchronizationHost reconnect wiring', () => {
  it('passes refresh (invalidate) — not recover (clear) — as the resubscribe callback', () => {
    const src = readFileSync(
      decodeURIComponent(new URL('../../components/synchronization/StudentSynchronizationHost.tsx', import.meta.url).pathname),
      'utf8',
    );
    const call = src.match(/subscribeBroadcast\(\s*`sync:university:\$\{universityId\}`,[\s\S]*?\);/);
    expect(call).not.toBeNull();
    // subscribeBroadcast(topic, event, onMessage, onSubscribed)
    const args = call![0]
      .replace(/\/\/[^\n]*/g, '')
      .split(/,\s*\n/)
      .map((s) => s.trim());
    expect(args[2]).toBe('recover');
    expect(args[3]).toContain('refresh');
  });
});
