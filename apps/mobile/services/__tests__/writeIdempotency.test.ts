import { describe, expect, it, vi, beforeEach } from 'vitest';

// ============================================================================
// client_tag write idempotency — addComment / createEvent
// ============================================================================
//
// A retry of the same logical create (double-tap, or a lost response after the
// row actually committed) must resolve to the EXISTING row, not a duplicate and
// not an error. A 23505 from any other cause must still throw.
// ============================================================================

const h = vi.hoisted(() => ({
  // Per-test scripting for each table's insert + the follow-up select.
  commentInsert: { error: null as unknown },
  commentExisting: { data: null as unknown },
  eventInsert: { data: null as unknown, error: null as unknown },
  eventExisting: { data: null as unknown, error: null as unknown },
  officer: { data: { id: 'm1' } as unknown },
}));

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));
vi.mock('../../lib/timezone', () => ({ todayInAppTz: () => '2026-08-29' }));
vi.mock('../../lib/eventDisplay', () => ({ isEventPastAt: () => false }));

vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    if (table === 'post_comments') {
      return {
        insert: () => Promise.resolve(h.commentInsert),
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(h.commentExisting) }) }),
        }),
      };
    }
    if (table === 'club_members') {
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(h.officer) }) }) }),
        }),
      };
    }
    if (table === 'events') {
      return {
        insert: () => ({ select: () => ({ single: () => Promise.resolve(h.eventInsert) }) }),
        select: () => ({
          eq: () => ({ eq: () => ({ single: () => Promise.resolve(h.eventExisting) }) }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  };
  return { supabase: { from } };
});

import { addComment } from '../postService';
import { createEvent } from '../eventService';

const eventInput = {
  club_id: 'c1',
  title: 'X',
  event_date: '2026-09-01',
  start_time: '10:00',
  end_time: '11:00',
  visibility: 'everyone' as const,
};

beforeEach(() => {
  h.commentInsert.error = null;
  h.commentExisting.data = null;
  h.eventInsert.data = { id: 'evt-new' };
  h.eventInsert.error = null;
  h.eventExisting.data = null;
  h.eventExisting.error = null;
  h.officer.data = { id: 'm1' };
});

describe('addComment', () => {
  it('succeeds normally', async () => {
    await expect(addComment('p1', 'u1', 'hi', 'tag-1')).resolves.toBeUndefined();
  });

  it('treats the client_tag conflict as success when the row already exists', async () => {
    h.commentInsert.error = { code: '23505', message: 'unique constraint "uq_post_comments_user_client_tag"' };
    h.commentExisting.data = { id: 'cmt-1' };
    await expect(addComment('p1', 'u1', 'hi', 'tag-1')).resolves.toBeUndefined();
  });

  it('rethrows a 23505 from a different constraint', async () => {
    h.commentInsert.error = { code: '23505', message: 'unique constraint "post_comments_pkey"' };
    await expect(addComment('p1', 'u1', 'hi', 'tag-1')).rejects.toMatchObject({ code: '23505' });
  });

  it('rethrows the conflict if the expected row cannot be found', async () => {
    h.commentInsert.error = { code: '23505', message: 'client_tag' };
    h.commentExisting.data = null;
    await expect(addComment('p1', 'u1', 'hi', 'tag-1')).rejects.toMatchObject({ code: '23505' });
  });
});

describe('createEvent', () => {
  it('returns the new id normally', async () => {
    await expect(createEvent('u1', eventInput, 'tag-1')).resolves.toBe('evt-new');
  });

  it('returns the existing event id on a client_tag conflict', async () => {
    h.eventInsert.data = null;
    h.eventInsert.error = { code: '23505', message: 'unique constraint "uq_events_created_by_client_tag"' };
    h.eventExisting.data = { id: 'evt-existing' };
    await expect(createEvent('u1', eventInput, 'tag-1')).resolves.toBe('evt-existing');
  });

  it('rethrows a foreign 23505', async () => {
    h.eventInsert.data = null;
    h.eventInsert.error = { code: '23505', message: 'events_some_other_key' };
    await expect(createEvent('u1', eventInput, 'tag-1')).rejects.toMatchObject({ code: '23505' });
  });
});
