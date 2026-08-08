import { describe, expect, it, vi, beforeEach } from 'vitest';

// Minimal PostgREST-shaped stub. Each test sets what the read and the write
// resolve to; the builder methods are chainable like supabase-js.
const readResult = { data: null as unknown, error: null as unknown };
const writeResult = { error: null as unknown };
const upsert = vi.fn(() => Promise.resolve(writeResult));
const del = vi.fn(() => ({
  eq: () => ({ eq: () => Promise.resolve(writeResult) }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve(readResult) }),
        }),
      }),
      upsert,
      delete: del,
    }),
  },
}));

import { toggleSaveEvent } from '../eventService';

beforeEach(() => {
  readResult.data = null;
  readResult.error = null;
  writeResult.error = null;
  upsert.mockClear();
});

describe('toggleSaveEvent never reports a save that did not happen', () => {
  // The reported bug showed "Event saved!" and a filled bookmark while the
  // write had been rejected, because neither result was error-checked.
  it('throws when the insert is rejected instead of returning true', async () => {
    writeResult.error = { message: 'new row violates row-level security policy' };

    await expect(toggleSaveEvent('user-1', 'event-1')).rejects.toMatchObject({
      message: expect.stringContaining('row-level security'),
    });
  });

  it('throws when the delete is rejected instead of returning false', async () => {
    readResult.data = { id: 'saved-1' };
    writeResult.error = { message: 'permission denied' };

    await expect(toggleSaveEvent('user-1', 'event-1')).rejects.toMatchObject({
      message: 'permission denied',
    });
  });

  it('throws when the existing-row read fails, rather than double-saving', async () => {
    readResult.error = { message: 'network' };

    await expect(toggleSaveEvent('user-1', 'event-1')).rejects.toMatchObject({
      message: 'network',
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts so a double tap cannot trip UNIQUE(user_id, event_id)', async () => {
    await expect(toggleSaveEvent('user-1', 'event-1')).resolves.toBe(true);

    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', event_id: 'event-1' },
      { onConflict: 'user_id,event_id' },
    );
  });

  it('returns false after removing an existing save', async () => {
    readResult.data = { id: 'saved-1' };

    await expect(toggleSaveEvent('user-1', 'event-1')).resolves.toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});
