import { describe, expect, it } from 'vitest';
import { threadComments, type ThreadableComment } from '@weglue/shared';

const c = (
  id: string,
  username: string,
  parent_comment_id: string | null,
  created_at: string,
): ThreadableComment => ({ id, created_at, parent_comment_id, author: { username } });

describe('threadComments — one visual level (migration 128)', () => {
  it('keeps top-level comments in input order with empty replies', () => {
    const out = threadComments([
      c('a', 'ann', null, '2026-01-01T00:00:00Z'),
      c('b', 'bob', null, '2026-01-01T00:01:00Z'),
    ]);
    expect(out.map((t) => t.root.id)).toEqual(['a', 'b']);
    expect(out.every((t) => t.replies.length === 0)).toBe(true);
  });

  it('nests a direct reply under its parent with replyingTo = parent author', () => {
    const out = threadComments([
      c('a', 'ann', null, '2026-01-01T00:00:00Z'),
      c('r1', 'bob', 'a', '2026-01-01T00:02:00Z'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].replies.map((r) => [r.id, r.replyingTo])).toEqual([['r1', 'ann']]);
  });

  it('flattens a reply-to-a-reply to the SAME level, carrying the immediate parent name', () => {
    const out = threadComments([
      c('a', 'ann', null, '2026-01-01T00:00:00Z'),
      c('r1', 'bob', 'a', '2026-01-01T00:02:00Z'),
      c('r2', 'cid', 'r1', '2026-01-01T00:03:00Z'), // reply to bob's reply
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].root.id).toBe('a');
    // r2 is still a first-level reply of thread "a" — never deeper.
    expect(out[0].replies.map((r) => [r.id, r.replyingTo])).toEqual([
      ['r1', 'ann'],
      ['r2', 'bob'],
    ]);
  });

  it('orders replies within a thread chronologically regardless of input order', () => {
    const out = threadComments([
      c('a', 'ann', null, '2026-01-01T00:00:00Z'),
      c('r2', 'cid', 'a', '2026-01-01T00:05:00Z'),
      c('r1', 'bob', 'a', '2026-01-01T00:02:00Z'),
    ]);
    expect(out[0].replies.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('treats an orphaned reply (parent absent / SET NULL) as its own top-level comment', () => {
    const out = threadComments([
      c('a', 'ann', null, '2026-01-01T00:00:00Z'),
      c('r1', 'bob', 'missing-parent', '2026-01-01T00:02:00Z'),
    ]);
    expect(out.map((t) => t.root.id)).toEqual(['a', 'r1']);
    expect(out.every((t) => t.replies.length === 0)).toBe(true);
  });

  it('does not loop on a cyclic parent chain', () => {
    // Not reachable through the API (a reply cannot pre-date its parent) but the
    // grouping must still terminate.
    const cyclic = [
      c('x', 'xand', 'y', '2026-01-01T00:00:00Z'),
      c('y', 'yara', 'x', '2026-01-01T00:01:00Z'),
    ];
    expect(() => threadComments(cyclic)).not.toThrow();
  });
});
