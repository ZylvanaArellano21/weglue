import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import {
  STUDENT_CONTENT_QUERY_ROOTS,
  invalidateStudentContentQueries,
  clearPermissionSensitiveStudentContent,
  shouldRecoverOnMobileForeground,
} from '../studentSynchronization';

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
    const removeQueries = vi.fn();
    const queryClient = { removeQueries } as unknown as QueryClient;

    clearPermissionSensitiveStudentContent(queryClient);

    expect(removeQueries.mock.calls.map(([arg]) => arg.queryKey)).toContainEqual(['eventDetail']);
    expect(removeQueries.mock.calls.map(([arg]) => arg.queryKey)).toContainEqual(['savedEventsUpcoming']);
    expect(removeQueries.mock.calls.map(([arg]) => arg.queryKey)).toContainEqual(['eventAttendees']);
    expect(removeQueries.mock.calls.map(([arg]) => arg.queryKey)).toContainEqual(['myChats']);
  });
});
