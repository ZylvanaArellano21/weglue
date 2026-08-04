import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import { searchEventAudienceMembers } from '../eventService';

describe('mobile selected-event audience search', () => {
  beforeEach(() => rpc.mockReset());

  it('delegates to the canonical club-member RPC with a trimmed partial query', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 'member', username: 'sam', full_name: 'Sam Member', avatar_url: null }],
      error: null,
    });

    await expect(searchEventAudienceMembers('club-1', ' sam ')).resolves.toEqual([
      { id: 'member', username: 'sam', full_name: 'Sam Member', avatar_url: null },
    ]);
    expect(rpc).toHaveBeenCalledWith('search_event_audience_members', {
      p_club_id: 'club-1',
      p_query: 'sam',
      p_limit: 50,
    });
  });

  it('surfaces the RPC rejection so the picker can show an error instead of accepting a stale result', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('only_club_officers_can_select_event_members') });
    await expect(searchEventAudienceMembers('club-1', 'sam')).rejects.toThrow('only_club_officers_can_select_event_members');
  });
});
