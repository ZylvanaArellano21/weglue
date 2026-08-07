import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn(), useQueryClient: vi.fn() }));
vi.mock('../supabase-browser', () => ({ getSupabaseBrowser: vi.fn() }));
vi.mock('../realtime', () => ({ subscribeBroadcast: vi.fn() }));

import { messageBadgeCounts, type UnreadSummary } from '../hooks/useUnreadSummary';

const source = (relativePath: string) =>
  readFileSync(decodeURIComponent(new URL(relativePath, import.meta.url).pathname), 'utf8');

const client = () => source('../../components/messages/MessagesClient.tsx');

const summary = (over: Partial<UnreadSummary> = {}): UnreadSummary => ({
  unread_notifications: 0,
  unread_threads: 0,
  unread_direct_messages: 0,
  unread_group_messages: 0,
  ...over,
});

describe('Message-tab unread categorization (web)', () => {
  it('splits Single and Groups and always totals their sum', () => {
    expect(messageBadgeCounts(summary({ unread_direct_messages: 3, unread_group_messages: 2 })))
      .toEqual({ single: 3, groups: 2, total: 5 });
    expect(messageBadgeCounts(summary({ unread_direct_messages: 0, unread_group_messages: 4 })))
      .toEqual({ single: 0, groups: 4, total: 4 });
    expect(messageBadgeCounts(summary({ unread_direct_messages: 6, unread_group_messages: 0 })))
      .toEqual({ single: 6, groups: 0, total: 6 });
    expect(messageBadgeCounts(summary())).toEqual({ single: 0, groups: 0, total: 0 });
  });

  it('never derives the message badge from the thread count', () => {
    expect(messageBadgeCounts(summary({ unread_threads: 99 })).total).toBe(0);
    expect(messageBadgeCounts(undefined)).toEqual({ single: 0, groups: 0, total: 0 });
  });

  it('drives the header badge and both category controls from that one helper', () => {
    const header = source('../../components/home/AppHeader.tsx');
    expect(header).toContain('messageBadgeCounts(summary).total');
    expect(header).not.toContain('unread_threads');

    const file = client();
    expect(file).toContain('messageBadgeCounts(summary)');
    expect(file).toContain('badge={singleUnread}');
    expect(file).toContain('badge={groupsUnread}');
    // The compact shared red badge, not a new pill or banner.
    expect(file).toContain('<CountBadge count={badge}');
  });
});

describe('Message-tab layout, search field and composer flow (web)', () => {
  it('bounds the shell height so only the conversation list scrolls', () => {
    const file = client();
    // Fixed-height application shell from `md` up…
    expect(file).toContain('md:h-[100dvh]');
    expect(file).toContain('md:overflow-hidden');
    // …and no leftover viewport MIN-heights that let the document grow.
    expect(file).not.toContain('min-h-[calc(100vh-88px)] grid-cols-1');
    expect(file).not.toContain('minHeight: "calc(100vh - 88px)"');
    // The list itself is the single scroll region.
    expect(file).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-5');
    // Header controls sit outside it and never scroll away.
    expect(file).toContain('shrink-0 px-5 pb-3 pt-5');
  });

  it('uses the shared magnifying-glass icon instead of a text glyph', () => {
    const file = client();
    // The Chats-column field and both composer fields use the real icon.
    expect(file.match(/<SearchIcon size=\{17\} \/>/g) ?? []).toHaveLength(2);
    expect(file).toContain('placeholder="Search"');
    // The ⌕ glyph is gone from the conversation-search field specifically.
    expect(file).not.toContain('-translate-y-1/2 text-gray-800">⌕</span>');
  });

  it('opens New message from the plus button in BOTH filters', () => {
    const file = client();
    expect(file).toContain('onNew={() => setComposerMode("new-message")}');
    // The old filter-dependent branch skipped New message entirely in Groups.
    expect(file).not.toContain('setComposerMode(filter === "single" ? "new-message" : "new-group")');
  });

  it('reaches New group chat through New message and can come back', () => {
    const file = client();
    expect(file).toContain('onGroupChat={() => setComposerMode("new-group")}');
    expect(file).toContain('onBack={() => setComposerMode("new-message")}');
    expect(file).toContain('>Group chat<');
    // Next stays disabled until the existing minimum selection is satisfied.
    expect(file).toContain('disabled={!selected.length}');
    expect(file).toContain('>Next<');
  });

  it('enables the empty-Single Suggested section (composerMode is a string, not a flag)', () => {
    const file = client();
    // `!composerMode` was permanently false because the idle value is "none",
    // so the Chats column could never render its Suggested section.
    expect(file).toContain('composerMode === "none" && !conversationId && !isDraft');
    expect(file).not.toContain('&& !composerMode &&');
  });

  it('shows Suggested in both composer views and reports failures honestly', () => {
    const file = client();
    // One shared component, so search rows and suggested rows stay compatible.
    expect(file).toContain('function SuggestedPeople(');
    expect(file.match(/<SuggestedPeople/g) ?? []).toHaveLength(3);
    expect(file).toContain('Couldn’t load suggestions.');
  });

  it('requests the ten-person product floor', async () => {
    const service = source('../messages/service.ts');
    expect(service).toContain('export const MESSAGE_SUGGESTION_LIMIT = 10;');
    expect(service).toContain('p_limit: MESSAGE_SUGGESTION_LIMIT');
    expect(service).not.toContain('p_limit: 6');
  });
});
