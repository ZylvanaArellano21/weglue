import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  responses: {} as Record<string, { data?: unknown; error?: unknown }>,
}));

vi.mock("@tanstack/react-query", async (load) => {
  const real = await load<typeof import("@tanstack/react-query")>();
  return { ...real, useInfiniteQuery: (options: unknown) => options };
});
vi.mock("../supabase-browser", () => ({
  getSupabaseBrowser: () => ({
    from(table: string) {
      const query: Record<string, any> = {};
      for (const method of ["select", "eq", "in", "order", "range", "gt", "not", "maybeSingle", "single"]) {
        query[method] = () => query;
      }
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(state.responses[table] ?? { data: [] }).then(resolve, reject);
      return query;
    },
  }),
}));

import { useHomePostsFeed } from "../hooks/useHomePostsFeed";
import { useHomeEventsFeed } from "../hooks/useHomeEventsFeed";

beforeEach(() => {
  state.responses = { profiles: { data: { university: "Campus" } } };
});

describe("web feed query functions", () => {
  it("resolve successful empty responses and reject the original backend error", async () => {
    const posts = useHomePostsFeed("u1") as unknown as { queryFn: (args: { pageParam: number }) => Promise<unknown> };
    const events = useHomeEventsFeed("u1") as unknown as { queryFn: (args: { pageParam: number }) => Promise<unknown> };
    state.responses.posts = { data: [] };
    state.responses.events = { data: [] };
    await expect(posts.queryFn({ pageParam: 0 })).resolves.toEqual([]);
    await expect(events.queryFn({ pageParam: 0 })).resolves.toEqual({ sections: [], hasMore: false });

    const failure = { code: "42501", status: 403, message: "permission denied" };
    state.responses.posts = { data: null, error: failure };
    state.responses.events = { data: null, error: failure };
    await expect(posts.queryFn({ pageParam: 0 })).rejects.toBe(failure);
    await expect(events.queryFn({ pageParam: 0 })).rejects.toBe(failure);
  });

  it("loads content after a temporary failed request without changing the query keys", async () => {
    const posts = useHomePostsFeed("u1") as unknown as {
      queryKey: unknown[]; queryFn: (args: { pageParam: number }) => Promise<any[]>;
    };
    const events = useHomeEventsFeed("u1") as unknown as {
      queryKey: unknown[]; queryFn: (args: { pageParam: number }) => Promise<{ sections: { data: any[] }[] }>;
    };
    expect(posts.queryKey).toEqual(["homePostsFeed", "u1"]);
    expect(events.queryKey).toEqual(["homeEventsFeed", "u1"]);
    const failure = { status: 503 };
    state.responses.posts = { error: failure };
    await expect(posts.queryFn({ pageParam: 0 })).rejects.toBe(failure);
    state.responses.posts = { data: [{
      id: "p1", image_url: "photo.jpg", caption: null, created_at: "2026-09-20T12:00:00Z",
      author_id: "a1", club_id: null, author_kind: "user",
      profiles: { id: "a1", username: "author", avatar_url: null }, clubs: null,
    }] };
    await expect(posts.queryFn({ pageParam: 0 })).resolves.toMatchObject([{ id: "p1" }]);

    state.responses.events = { error: failure };
    await expect(events.queryFn({ pageParam: 0 })).rejects.toBe(failure);
    state.responses.events = { data: [{
      id: "e1", club_id: "c1", title: "Event", description: null, cover_image_url: null,
      event_date: "2026-09-21", start_time: "12:00", end_time: "13:00",
      event_end_at: "2026-09-21T13:00:00Z", location: null, building: null, room: null,
      created_by: "a1", visibility: "everyone", specific_user_ids: [],
      clubs: { id: "c1", name: "Club", avatar_url: null }, event_interests: [], event_activities: [],
    }] };
    const loaded = await events.queryFn({ pageParam: 0 });
    expect(loaded.sections.flatMap((section) => section.data)).toMatchObject([{ id: "e1" }]);
  });
});
