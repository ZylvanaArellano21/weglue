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

import { getSuggestedPeople, searchChats } from '../chatService';

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
    expect(rpc).toHaveBeenCalledWith('get_message_suggestions', { p_limit: 6 });
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
            avatar_url: 'stale-avatar',
            clubs: { name: 'Robotics', avatar_url: 'current-avatar' },
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
        avatar_url: 'current-avatar',
      }],
    });

    expect(rpc).toHaveBeenCalledWith('search_message_people', { p_query: 'robo', p_limit: 20 });
    expect(from).toHaveBeenCalledWith('conversation_participants');
    expect(eq).toHaveBeenCalledWith('user_id', 'viewer-1');
    expect(inTypes).toHaveBeenCalledWith('conversations.type', ['club_group', 'officer_chat', 'group']);
    expect(ilike).toHaveBeenCalledWith('conversations.name', '%robo%');
    expect(limit).toHaveBeenCalledWith(20);
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
