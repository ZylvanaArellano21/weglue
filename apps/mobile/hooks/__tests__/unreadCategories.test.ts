import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// messageBadgeCounts is pure, but its module also wires the live query + the
// icon-badge effect. Stub the native/runtime edges so the contract can be
// tested in plain Node (same approach as messagesSuggestions.test.ts).
vi.mock('expo-notifications', () => ({ setBadgeCountAsync: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn(), useQueryClient: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('../../lib/realtime', () => ({
  createSafeChannel: vi.fn(),
  removeSafeChannel: vi.fn(),
  subscribeBroadcast: vi.fn(),
}));

import { messageBadgeCounts, type UnreadSummary } from '../useUnreadSummary';

const source = (relativePath: string) =>
  readFileSync(decodeURIComponent(new URL(relativePath, import.meta.url).pathname), 'utf8');

const summary = (over: Partial<UnreadSummary> = {}): UnreadSummary => ({
  unread_notifications: 0,
  unread_threads: 0,
  unread_direct_messages: 0,
  unread_group_messages: 0,
  ...over,
});

describe('Message-tab unread categorization', () => {
  it('splits Single and Groups and always totals their sum', () => {
    // The four worked examples from the correction brief.
    expect(messageBadgeCounts(summary({ unread_direct_messages: 3, unread_group_messages: 2 })))
      .toEqual({ single: 3, groups: 2, total: 5 });
    expect(messageBadgeCounts(summary({ unread_direct_messages: 0, unread_group_messages: 4 })))
      .toEqual({ single: 0, groups: 4, total: 4 });
    expect(messageBadgeCounts(summary({ unread_direct_messages: 6, unread_group_messages: 0 })))
      .toEqual({ single: 6, groups: 0, total: 6 });
    expect(messageBadgeCounts(summary())).toEqual({ single: 0, groups: 0, total: 0 });
  });

  it('is derived only from the two category keys, never from unread_threads', () => {
    // unread_threads counts THREADS and still drives the app-icon badge, so it
    // must never leak into the in-app message totals.
    expect(messageBadgeCounts(summary({ unread_threads: 99 })).total).toBe(0);
  });

  it('treats a missing or partial payload as zero rather than NaN', () => {
    expect(messageBadgeCounts(undefined)).toEqual({ single: 0, groups: 0, total: 0 });
    expect(messageBadgeCounts({ unread_direct_messages: -5 } as unknown as UnreadSummary))
      .toEqual({ single: 0, groups: 0, total: 0 });
  });

  it('uses one canonical source for the tab badge and both category controls', () => {
    const tabs = source('../../app/(tabs)/_layout.tsx');
    const messagesIndex = source('../../app/(tabs)/messages/index.tsx');

    // Tab badge and both pills read messageBadgeCounts of the same RPC query,
    // so the tab number equals Single + Groups by construction.
    expect(tabs).toContain('messageBadgeCounts(unreadSummary).total');
    expect(tabs).not.toContain('unread_threads');
    expect(messagesIndex).toContain('messageBadgeCounts(unreadSummary)');
    expect(messagesIndex).toContain('singleUnread={singleUnread}');
    expect(messagesIndex).toContain('groupUnread={groupUnread}');
  });

  it('keeps the app-icon badge on the untouched thread count', () => {
    const hook = source('../useUnreadSummary.ts');
    expect(hook).toContain('query.data.unread_notifications + query.data.unread_threads');
  });
});
