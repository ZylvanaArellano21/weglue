import { describe, expect, it, vi, beforeEach } from 'vitest';

// ============================================================================
// setEventSaved / rsvpToEvent — explicit desired-state, NOT a toggle
// ============================================================================
//
// The contract: the caller passes the target end-state. Re-applying the same
// state is an idempotent no-op success, so a retry after an uncertain success
// can never reverse the user's bookmark or RSVP. Every write is error-checked —
// a rejected write must not report success.
// ============================================================================

const h = vi.hoisted(() => ({
  upsertResult: { error: null as unknown },
  deleteResult: { error: null as unknown },
  eventRow: { data: { event_end_at: '2999-01-01T00:00:00Z' } as unknown },
  upsert: vi.fn(() => Promise.resolve(h.upsertResult)),
  del: vi.fn(() => ({ eq: () => ({ eq: () => Promise.resolve(h.deleteResult) }) })),
}));

vi.mock('../../lib/timezone', () => ({ todayInAppTz: () => '2026-08-29' }));
vi.mock('../../lib/eventDisplay', () => ({ isEventPastAt: (d: string) => new Date(d) < new Date() }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'events') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(h.eventRow) }) }) };
      }
      // saved_events / event_rsvps
      return { upsert: h.upsert, delete: h.del };
    },
  },
}));

import { setEventSaved, rsvpToEvent } from '../eventService';

beforeEach(() => {
  h.upsertResult.error = null;
  h.deleteResult.error = null;
  h.eventRow.data = { event_end_at: '2999-01-01T00:00:00Z' };
  h.upsert.mockClear();
  h.del.mockClear();
});

describe('setEventSaved', () => {
  it('upserts when desired = true (re-save is a no-op, never a UNIQUE error)', async () => {
    await expect(setEventSaved('u1', 'e1', true)).resolves.toBeUndefined();
    expect(h.upsert).toHaveBeenCalledWith(
      { user_id: 'u1', event_id: 'e1' },
      { onConflict: 'user_id,event_id' },
    );
    expect(h.del).not.toHaveBeenCalled();
  });

  it('deletes when desired = false', async () => {
    await expect(setEventSaved('u1', 'e1', false)).resolves.toBeUndefined();
    expect(h.del).toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('throws when the upsert is rejected instead of reporting a save', async () => {
    h.upsertResult.error = { message: 'new row violates row-level security policy' };
    await expect(setEventSaved('u1', 'e1', true)).rejects.toMatchObject({
      message: expect.stringContaining('row-level security'),
    });
  });

  it('throws when the delete is rejected', async () => {
    h.deleteResult.error = { message: 'permission denied' };
    await expect(setEventSaved('u1', 'e1', false)).rejects.toMatchObject({ message: 'permission denied' });
  });
});

describe('rsvpToEvent', () => {
  it('upserts the exact status for going/cant', async () => {
    await rsvpToEvent('u1', 'e1', 'going');
    expect(h.upsert).toHaveBeenCalledWith(
      { event_id: 'e1', user_id: 'u1', status: 'going' },
      { onConflict: 'event_id,user_id' },
    );
  });

  it('deletes the row when desired = null (explicit clear, idempotent)', async () => {
    await rsvpToEvent('u1', 'e1', null);
    expect(h.del).toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('re-applying the same status does NOT toggle off — it upserts again', async () => {
    await rsvpToEvent('u1', 'e1', 'going');
    await rsvpToEvent('u1', 'e1', 'going');
    expect(h.upsert).toHaveBeenCalledTimes(2);
    expect(h.del).not.toHaveBeenCalled();
  });

  it('refuses to change attendance on an ended event', async () => {
    h.eventRow.data = { event_end_at: '2000-01-01T00:00:00Z' };
    await expect(rsvpToEvent('u1', 'e1', 'going')).rejects.toMatchObject({
      message: expect.stringContaining('ended'),
    });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('throws when the upsert is rejected', async () => {
    h.upsertResult.error = { message: 'denied' };
    await expect(rsvpToEvent('u1', 'e1', 'cant')).rejects.toMatchObject({ message: 'denied' });
  });
});
