import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const rpc = vi.fn();
const from = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

vi.mock('../../lib/displayName', () => ({
  MEMBER_FALLBACK: 'We Glue member',
  resolveDisplayName: (person: { full_name?: string | null; username?: string | null } | null) =>
    person?.full_name?.trim() || person?.username || null,
}));

vi.mock('../../lib/chatAttachments', () => ({
  CHAT_ATTACHMENTS_BUCKET: 'chat-attachments',
  clientUuid: () => 'attachment-id',
}));

import { MESSAGE_SUGGESTION_LIMIT, getSuggestedPeople, searchChats } from '../chatService';

const source = (relativePath: string) =>
  readFileSync(decodeURIComponent(new URL(relativePath, import.meta.url).pathname), 'utf8');

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe('Messages people search and suggestions', () => {
  it('uses the bounded server-side suggestions RPC and preserves the display fields', async () => {
    rpc.mockResolvedValue({
      data: [
        { user_id: 'person-1', username: 'marcus', full_name: 'Marcus Lee', avatar_url: null },
      ],
      error: null,
    });

    await expect(getSuggestedPeople('viewer-1')).resolves.toEqual([
      { user_id: 'person-1', username: 'marcus', full_name: 'Marcus Lee', avatar_url: null },
    ]);
    expect(rpc).toHaveBeenCalledWith('get_message_suggestions', { p_limit: 10 });
  });

  it('asks for the ten-person product floor everywhere Suggested is rendered', () => {
    // The RPC clamped itself to six before migration 076, so requesting six was
    // the reason no Suggested section could ever reach ten.
    expect(MESSAGE_SUGGESTION_LIMIT).toBe(10);

    const newMessage = source('../../app/chat/new-message.tsx');
    const newGroup = source('../../app/chat/new-group.tsx');
    const messagesIndex = source('../../app/(tabs)/messages/index.tsx');

    // All three contexts render Suggested without the user typing first.
    for (const [label, file] of [
      ['new message', newMessage],
      ['new group chat', newGroup],
    ] as const) {
      expect(file, label).toContain('useSuggestedPeople(isTyping ? undefined : userId)');
      expect(file, label).toContain('Suggested');
    }
    // The empty-Single list is no longer re-sliced down to six.
    expect(messagesIndex).toContain('suggestedPeople.slice(0, MESSAGE_SUGGESTION_LIMIT)');
    expect(messagesIndex).not.toContain('suggestedPeople.slice(0, 6)');
  });

  it('never lets a failed suggestions query render as an empty Suggested section', () => {
    for (const relativePath of [
      '../../app/chat/new-message.tsx',
      '../../app/chat/new-group.tsx',
      '../../app/(tabs)/messages/index.tsx',
    ]) {
      const file = source(relativePath);
      expect(file, relativePath).toContain('isError');
      expect(file, relativePath).toContain('Couldn’t load suggestions');
    }
  });

  it('uses the secure people-search RPC and limits chat search to the viewer’s own group conversations', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [
        {
          conversations: {
            id: 'club-chat-1',
            name: 'Stored club name',
            type: 'club_group',
            club_id: 'club-1',
            // Bug 5 — this is the chat's OWN picture, not a stale copy of the
            // club's. Once seeded at creation (079) the two are independent:
            // an officer may set a different image per chat and per channel,
            // and a later Club Profile change must not reach back into them.
            avatar_url: 'chat-picture',
            clubs: { name: 'Robotics', avatar_url: 'club-profile-picture' },
          },
        },
      ],
    });
    const ilike = vi.fn().mockReturnValue({ limit });
    const inTypes = vi.fn().mockReturnValue({ ilike });
    const eq = vi.fn().mockReturnValue({ in: inTypes });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });
    rpc.mockResolvedValue({
      data: [{ user_id: 'person-2', username: 'jordan', full_name: 'Jordan Kim', avatar_url: null }],
      error: null,
    });

    await expect(searchChats('viewer-1', '  robo  ')).resolves.toEqual({
      people: [{ user_id: 'person-2', username: 'jordan', full_name: 'Jordan Kim', avatar_url: null }],
      chats: [{
        id: 'club-chat-1',
        name: 'Robotics · Members',
        type: 'club_group',
        club_id: 'club-1',
        // The NAME still resolves live from the club ("Robotics · Members"),
        // because renaming a club must retitle its chats. Only the PICTURE is
        // an independent copy.
        avatar_url: 'chat-picture',
      }],
    });

    expect(rpc).toHaveBeenCalledWith('search_message_people', { p_query: 'robo', p_limit: 20 });
    expect(from).toHaveBeenCalledWith('conversation_participants');
    expect(eq).toHaveBeenCalledWith('user_id', 'viewer-1');
    expect(inTypes).toHaveBeenCalledWith('conversations.type', ['club_group', 'officer_chat', 'group']);
    expect(ilike).toHaveBeenCalledWith('conversations.name', '%robo%');
    expect(limit).toHaveBeenCalledWith(20);
  });

  /**
   * Bug 5 — a club chat falls back to the club picture ONLY when it has never
   * had one of its own.
   *
   * This is the pre-079 case: rows created before the picture was seeded still
   * carry NULL, and they must keep showing the club image rather than
   * collapsing to initials. It is the counterpart to the assertion above, and
   * together the two pin the precedence in both directions so neither can be
   * flipped back by accident.
   */
  it('falls back to the club picture only when the chat has none of its own', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [
        {
          conversations: {
            id: 'club-chat-2',
            name: 'Stored club name',
            type: 'officer_chat',
            club_id: 'club-1',
            avatar_url: null,
            clubs: { name: 'Robotics', avatar_url: 'club-profile-picture' },
          },
        },
      ],
    });
    const ilike = vi.fn().mockReturnValue({ limit });
    const inTypes = vi.fn().mockReturnValue({ ilike });
    const eq = vi.fn().mockReturnValue({ in: inTypes });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });
    rpc.mockResolvedValue({ data: [], error: null });

    const { chats } = await searchChats('viewer-1', 'robo');
    expect(chats).toEqual([
      {
        id: 'club-chat-2',
        name: 'Robotics · Officers',
        type: 'officer_chat',
        club_id: 'club-1',
        avatar_url: 'club-profile-picture',
      },
    ]);
  });

  it('does not issue a directory request for a blank search and propagates RPC errors', async () => {
    await expect(searchChats('viewer-1', '   ')).resolves.toEqual({ people: [], chats: [] });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();

    const error = new Error('restricted');
    rpc.mockResolvedValue({ data: null, error });
    await expect(getSuggestedPeople('viewer-1')).rejects.toBe(error);
  });

  it('only loads suggestions for an unsearched empty direct-message list and renders a real name plus username', () => {
    const messagesIndex = source('../../app/(tabs)/messages/index.tsx');
    const row = source('../../components/chat/ChatListItem.tsx');

    expect(messagesIndex).toContain(
      "filter === 'single' && directChats.length === 0 && !searching",
    );
    expect(messagesIndex).toContain('fullName={person.full_name}');
    expect(row).toContain('const name = fullName?.trim() || username');
    expect(row).toContain('@{username}');
  });
});
