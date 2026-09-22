import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';

const state = vi.hoisted(() => ({
  responses: {} as Record<string, { data?: unknown; error?: unknown }>,
  calls: [] as string[],
}));

vi.mock('expo-image-manipulator', () => ({}));
vi.mock('../../lib/timezone', () => ({ todayInAppTz: () => '2026-09-20' }));
vi.mock('../../lib/eventDisplay', () => ({ isEventPastAt: () => false }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const query: Record<string, any> = {};
      for (const method of ['select', 'eq', 'in', 'order', 'range', 'gt', 'not', 'maybeSingle', 'single']) {
        query[method] = () => query;
      }
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        state.calls.push(table);
        return Promise.resolve(state.responses[table] ?? { data: [] }).then(resolve, reject);
      };
      return query;
    },
  },
}));

import { getHomePostsFeed, getPostById, getPostsByIds, getUserPostsFeed, getPostComments } from '../postService';
import { getHomeEventsFeed, getEventDetail, getEventAttendees } from '../eventService';

const post = {
  id: 'p1', image_url: 'photo.jpg', caption: null, created_at: '2026-09-20T12:00:00Z',
  author_id: 'a1', club_id: null, author_kind: 'user',
  profiles: { id: 'a1', username: 'author', avatar_url: null }, clubs: null,
};
const event = {
  id: 'e1', club_id: 'c1', title: 'Event', description: null, cover_image_url: null,
  event_date: '2026-09-21', start_time: '12:00', end_time: '13:00',
  event_end_at: '2026-09-21T13:00:00Z', location: null, building: null, room: null,
  created_by: 'a1', visibility: 'everyone', specific_user_ids: [],
  clubs: { id: 'c1', name: 'Club', avatar_url: null }, event_interests: [], event_activities: [],
};

beforeEach(() => {
  state.calls.length = 0;
  state.responses = { profiles: { data: { university: 'Campus' } } };
});

describe('primary feed failure contract', () => {
  it('keeps successful zero rows distinct from backend errors', async () => {
    state.responses.posts = { data: [] };
    state.responses.events = { data: [] };
    await expect(getHomePostsFeed('u1')).resolves.toEqual([]);
    await expect(getHomeEventsFeed('u1')).resolves.toEqual({ sections: [], hasMore: false });

    const failure = { code: '42501', message: 'permission denied', status: 403 };
    state.responses.posts = { data: null, error: failure };
    state.responses.events = { data: null, error: failure };
    await expect(getHomePostsFeed('u1')).rejects.toBe(failure);
    await expect(getHomeEventsFeed('u1')).rejects.toBe(failure);
  });

  it('renders data again after a temporary failure is retried', async () => {
    const failure = { status: 503, message: 'temporary' };
    state.responses.posts = { data: null, error: failure };
    await expect(getHomePostsFeed('u1')).rejects.toBe(failure);
    state.responses.posts = { data: [post] };
    await expect(getHomePostsFeed('u1')).resolves.toMatchObject([{ id: 'p1' }]);

    state.responses.events = { data: null, error: failure };
    await expect(getHomeEventsFeed('u1')).rejects.toBe(failure);
    state.responses.events = { data: [event] };
    const loaded = await getHomeEventsFeed('u1');
    expect(loaded.sections.flatMap((section) => section.data)).toMatchObject([{ id: 'e1' }]);
  });

  it('rejects when campus scope fails instead of querying posts without it', async () => {
    const failure = { status: 403, message: 'denied' };
    state.responses.profiles = { data: null, error: failure };
    await expect(getHomePostsFeed('u1')).rejects.toBe(failure);
    expect(state.calls).not.toContain('posts');
  });

  it('rejects failed post and event detail/list reads instead of returning missing content', async () => {
    const failure = { status: 503, message: 'temporary' };
    state.responses.posts = { data: null, error: failure };
    state.responses.post_comments = { data: null, error: failure };
    state.responses.events = { data: null, error: failure };
    state.responses.event_rsvps = { data: null, error: failure };
    await expect(getPostById('p1', 'u1')).rejects.toBe(failure);
    await expect(getUserPostsFeed('a1', 'u1')).rejects.toBe(failure);
    await expect(getPostsByIds('u1', ['p1'])).rejects.toBe(failure);
    await expect(getPostComments('p1')).rejects.toBe(failure);
    await expect(getEventDetail('e1', 'u1')).rejects.toBe(failure);
    await expect(getEventAttendees('e1', 'u1')).rejects.toBe(failure);
  });

  it('preserves loaded pages when a later page fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ['events', 'u1'];
    state.responses.events = { data: Array.from({ length: 20 }, (_, i) => ({ ...event, id: `e${i}` })) };
    const options = {
      queryKey: key,
      queryFn: ({ pageParam }: { pageParam: number }) => getHomeEventsFeed('u1', pageParam),
      initialPageParam: 0,
      getNextPageParam: (lastPage: Awaited<ReturnType<typeof getHomeEventsFeed>>, pages: unknown[]) => lastPage.hasMore ? pages.length : undefined,
    };
    const observer = new InfiniteQueryObserver(client, options);
    await observer.refetch();
    const firstPage = client.getQueryData<{ pages: unknown[] }>(key);
    expect(firstPage?.pages).toHaveLength(1);
    state.responses.events = { data: null, error: { status: 503 } };
    const failedPage = await observer.fetchNextPage();
    expect(failedPage.isFetchNextPageError).toBe(true);
    expect(client.getQueryData<{ pages: unknown[] }>(key)?.pages[0]).toEqual(firstPage?.pages[0]);
    client.clear();
  });
});
