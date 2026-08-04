import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import {
  STUDENT_CONTENT_QUERY_ROOTS,
  invalidateStudentContentQueries,
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
});
